import { buildInstallmentReference } from './cumbre2026';
import { roundCurrency } from './cumbreInstallments';
import { supabaseAdmin } from './supabaseAdmin';

const PENDING_INSTALLMENT_STATUSES = ['PENDING', 'FAILED'];

type BalanceInstallmentContext = {
  installment: any;
  booking: any;
  plan: any;
  created: boolean;
};

async function resolveProviderForBalance(bookingId: string, currency: string): Promise<string> {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');

  const { data, error } = await supabaseAdmin
    .from('cumbre_payments')
    .select('provider')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[cumbre.balance-installment] payment provider lookup error', error);
  }

  const provider = String(data?.provider || '').trim().toLowerCase();
  if (provider === 'stripe' || provider === 'wompi' || provider === 'manual') return provider;
  return currency === 'USD' ? 'stripe' : 'wompi';
}

function todayInBogota(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

async function loadPendingInstallment(bookingId: string): Promise<BalanceInstallmentContext | null> {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');

  const { data, error } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, plan_id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, paid_at, created_at, booking:cumbre_bookings(id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency), plan:cumbre_payment_plans(id, status, provider, currency, installment_count, provider_payment_method_id, provider_subscription_id)')
    .eq('booking_id', bookingId)
    .in('status', PENDING_INSTALLMENT_STATUSES)
    .order('installment_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[cumbre.balance-installment] pending lookup error', error);
    throw new Error('No se pudo consultar cuotas pendientes');
  }

  if (!data) return null;
  return {
    installment: data,
    booking: (data as any).booking || null,
    plan: (data as any).plan || null,
    created: false,
  };
}

export async function ensureBalanceInstallment(bookingId: string): Promise<BalanceInstallmentContext> {
  if (!supabaseAdmin) throw new Error('Supabase no configurado');

  const existing = await loadPendingInstallment(bookingId);
  if (existing) return existing;

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error('[cumbre.balance-installment] booking lookup error', bookingError);
    throw new Error('No se pudo consultar la reserva');
  }
  if (!booking) throw new Error('Reserva no encontrada');

  const currency = booking.currency === 'USD' ? 'USD' : 'COP';
  const remaining = roundCurrency(
    Math.max(Number(booking.total_amount || 0) - Number(booking.total_paid || 0), 0),
    currency,
  );
  if (remaining <= 0) throw new Error('No hay saldo pendiente');

  const { data: existingPlan, error: planLookupError } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planLookupError) {
    console.error('[cumbre.balance-installment] plan lookup error', planLookupError);
    throw new Error('No se pudo consultar el plan de pago');
  }

  const dueDate = todayInBogota();
  let plan = existingPlan;
  const balanceProvider = await resolveProviderForBalance(bookingId, currency);

  if (!plan) {
    const { data: createdPlan, error: createPlanError } = await supabaseAdmin
      .from('cumbre_payment_plans')
      .insert({
        booking_id: bookingId,
        status: 'ACTIVE',
        frequency: 'DEPOSIT',
        start_date: dueDate,
        end_date: dueDate,
        total_amount: remaining,
        currency,
        installment_count: 1,
        installment_amount: remaining,
        amount_paid: 0,
        provider: balanceProvider,
        auto_debit: false,
        next_due_date: dueDate,
      })
      .select('*')
      .single();

    if (createPlanError || !createdPlan) {
      console.error('[cumbre.balance-installment] plan create error', createPlanError);
      throw new Error('No se pudo crear el plan para el saldo pendiente');
    }

    plan = createdPlan;
  } else {
    const isAuto = (plan.provider === 'wompi' && plan.provider_payment_method_id)
      || (plan.provider === 'stripe' && plan.provider_subscription_id);
    if (isAuto) throw new Error('Cobro automático activo');

    const currentAmountPaid = Number(plan.amount_paid || 0);
    const nextTotal = Math.max(Number(plan.total_amount || 0), currentAmountPaid + remaining);
    const { data: updatedPlan, error: updatePlanError } = await supabaseAdmin
      .from('cumbre_payment_plans')
      .update({
        status: 'ACTIVE',
        total_amount: nextTotal,
        currency,
        installment_amount: remaining,
        provider: plan.provider || balanceProvider,
        auto_debit: false,
        next_due_date: dueDate,
      })
      .eq('id', plan.id)
      .select('*')
      .single();

    if (updatePlanError || !updatedPlan) {
      console.error('[cumbre.balance-installment] plan update error', updatePlanError);
      throw new Error('No se pudo actualizar el plan para el saldo pendiente');
    }

    plan = updatedPlan;
  }

  const { data: lastInstallment, error: lastInstallmentError } = await supabaseAdmin
    .from('cumbre_installments')
    .select('installment_index')
    .eq('plan_id', plan.id)
    .order('installment_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastInstallmentError) {
    console.error('[cumbre.balance-installment] last installment lookup error', lastInstallmentError);
    throw new Error('No se pudo preparar la cuota pendiente');
  }

  const installmentIndex = Math.max(Number(lastInstallment?.installment_index || 0) + 1, 1);
  const reference = buildInstallmentReference({
    bookingId,
    planId: plan.id,
    installmentIndex,
  });

  const { data: installment, error: installmentError } = await supabaseAdmin
    .from('cumbre_installments')
    .insert({
      plan_id: plan.id,
      booking_id: bookingId,
      installment_index: installmentIndex,
      due_date: dueDate,
      amount: remaining,
      currency,
      status: 'PENDING',
      provider_reference: reference,
    })
    .select('id, booking_id, plan_id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, paid_at, created_at, booking:cumbre_bookings(id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency), plan:cumbre_payment_plans(id, status, provider, currency, installment_count, provider_payment_method_id, provider_subscription_id)')
    .single();

  if (installmentError || !installment) {
    console.error('[cumbre.balance-installment] installment create error', installmentError);
    throw new Error('No se pudo crear la cuota para el saldo pendiente');
  }

  await supabaseAdmin
    .from('cumbre_payment_plans')
    .update({
      installment_count: Math.max(Number(plan.installment_count || 0), installmentIndex),
      next_due_date: dueDate,
    })
    .eq('id', plan.id);

  return {
    installment,
    booking: (installment as any).booking || booking,
    plan: (installment as any).plan || plan,
    created: true,
  };
}
