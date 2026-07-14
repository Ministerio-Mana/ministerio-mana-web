import { supabaseAdmin } from './supabaseAdmin';
import { statusFromPaid, depositThreshold, generateAccessToken, hashToken, type Currency } from './cumbre2026';
import { logSecurityEvent } from './securityEvents';
import { sendCumbreEmail } from './cumbreMailer';
import { roundCurrency } from './cumbreInstallments';

function ensureSupabase() {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }
  return supabaseAdmin;
}

export type BookingRecord = {
  id: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_document_type?: string | null;
  contact_document_number?: string | null;
  contact_country?: string | null;
  contact_city?: string | null;
  contact_church?: string | null;
  country_group: string;
  currency: string;
  total_amount: number;
  total_paid: number;
  status: string;
  deposit_threshold: number;
  token_hash: string;
};

export type PaymentPlanRecord = {
  id: string;
  booking_id: string;
  status: string;
  frequency: string;
  start_date: string;
  end_date: string;
  total_amount: number;
  currency: string;
  installment_count: number;
  installment_amount: number;
  amount_paid: number;
  provider: string;
  auto_debit: boolean;
  provider_customer_id: string | null;
  provider_payment_method_id: string | null;
  provider_subscription_id: string | null;
  next_due_date: string | null;
  last_attempt_at: string | null;
};

export type PaymentRecord = {
  id: string;
  booking_id: string;
  provider: string;
  provider_tx_id: string | null;
  reference: string | null;
  amount: number;
  currency: string;
  status: string;
  plan_id?: string | null;
  installment_id?: string | null;
  raw_event?: Record<string, unknown> | null;
  created_at: string;
};

export type InstallmentRecord = {
  id: string;
  plan_id: string;
  booking_id: string;
  installment_index: number;
  due_date: string;
  amount: number;
  currency: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  provider_reference: string | null;
  provider_tx_id: string | null;
  paid_at: string | null;
};

export type InstallmentReminderRecord = {
  id: string;
  installment_id: string;
  reminder_key: string;
  channel: string;
  sent_at: string;
  payload: Record<string, unknown> | null;
  error: string | null;
};

export type InstallmentLinkRecord = {
  id: string;
  installment_id: string;
  token_hash: string;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
};

export const ACTIVE_PENDING_PAYMENT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'REQUIRES_ACTION',
  'APPROVAL_PENDING',
] as const;

const DEFAULT_PENDING_PAYMENT_LOCK_MINUTES = 120;

function getPendingPaymentLockMinutes(): number {
  const raw = Number(
    import.meta.env?.CUMBRE_PENDING_PAYMENT_LOCK_MINUTES
      ?? process.env?.CUMBRE_PENDING_PAYMENT_LOCK_MINUTES
      ?? DEFAULT_PENDING_PAYMENT_LOCK_MINUTES,
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PENDING_PAYMENT_LOCK_MINUTES;
  return Math.min(Math.floor(raw), 24 * 60);
}

function getPendingPaymentCutoffIso(): string {
  return new Date(Date.now() - getPendingPaymentLockMinutes() * 60 * 1000).toISOString();
}

export async function getBookingById(id: string): Promise<BookingRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.booking] load error', error);
    return null;
  }
  return data as BookingRecord | null;
}

export async function countPayments(bookingId: string): Promise<number> {
  const supabase = ensureSupabase();
  const { count, error } = await supabase
    .from('cumbre_payments')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId);
  if (error) {
    console.error('[cumbre.payments] count error', error);
    return 0;
  }
  return count ?? 0;
}

export async function getApprovedPaymentsTotal(bookingId: string): Promise<number> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payments')
    .select('amount')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');
  if (error) {
    console.error('[cumbre.payments] approved sum error', error);
    return 0;
  }
  return (data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export async function listActivePendingPayments(params: {
  bookingId: string;
  installmentId?: string | null;
  reference?: string | null;
}): Promise<PaymentRecord[]> {
  const supabase = ensureSupabase();
  let query = supabase
    .from('cumbre_payments')
    .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, plan_id, installment_id, raw_event, created_at')
    .eq('booking_id', params.bookingId)
    .in('status', [...ACTIVE_PENDING_PAYMENT_STATUSES])
    .gte('created_at', getPendingPaymentCutoffIso())
    .order('created_at', { ascending: false })
    .limit(50);

  if (params.installmentId) {
    query = query.eq('installment_id', params.installmentId);
  }

  if (params.reference) {
    query = query.eq('reference', params.reference);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[cumbre.payments] pending list error', error);
    return [];
  }
  return (data || []) as PaymentRecord[];
}

export async function hasApprovedPaymentByReference(params: {
  provider: string;
  reference: string;
}): Promise<boolean> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payments')
    .select('id')
    .eq('provider', params.provider)
    .eq('reference', params.reference)
    .eq('status', 'APPROVED')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.payments] approved by reference error', error);
    return false;
  }
  return Boolean(data?.id);
}

export async function getPaymentByProviderTxId(params: {
  provider: string;
  providerTxId: string;
}): Promise<PaymentRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payments')
    .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, plan_id, installment_id, created_at')
    .eq('provider', params.provider)
    .eq('provider_tx_id', params.providerTxId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.payments] provider transaction lookup error', error);
    return null;
  }
  return data as PaymentRecord | null;
}

export async function recordPayment(params: {
  bookingId: string;
  provider: string;
  providerTxId: string | null;
  reference: string | null;
  amount: number;
  currency: string;
  status: string;
  planId?: string | null;
  installmentId?: string | null;
  rawEvent?: unknown;
  throwOnError?: boolean;
  insertOnly?: boolean;
}): Promise<boolean> {
  const supabase = ensureSupabase();

  if (params.reference && !params.insertOnly) {
    const { data, error } = await supabase
      .from('cumbre_payments')
      .update({
        provider_tx_id: params.providerTxId,
        status: params.status,
        amount: params.amount,
        currency: params.currency,
        plan_id: params.planId ?? null,
        installment_id: params.installmentId ?? null,
        raw_event: params.rawEvent ?? null,
      })
      .eq('booking_id', params.bookingId)
      .eq('provider', params.provider)
      .eq('reference', params.reference)
      .select('id');

    if (!error && data && data.length > 0) {
      return true;
    }
  }

  const { error: insertError } = await supabase
    .from('cumbre_payments')
    .insert({
      booking_id: params.bookingId,
      provider: params.provider,
      provider_tx_id: params.providerTxId,
      reference: params.reference,
      amount: params.amount,
      currency: params.currency,
      status: params.status,
      plan_id: params.planId ?? null,
      installment_id: params.installmentId ?? null,
      raw_event: params.rawEvent ?? null,
    });

  if (insertError) {
    console.error('[cumbre.payments] insert error', insertError);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'cumbre.payment',
      detail: insertError.message,
    });
    if (params.throwOnError) {
      throw new Error('No se pudo registrar el pago');
    }
    return false;
  }
  return true;
}

export async function updatePaymentRawEventByProviderTxId(params: {
  provider: string;
  providerTxId: string;
  rawEvent: Record<string, unknown>;
}): Promise<void> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payments')
    .update({ raw_event: params.rawEvent })
    .eq('provider', params.provider)
    .eq('provider_tx_id', params.providerTxId)
    .select('id');

  if (error || !data?.length) {
    throw new Error('No se pudo actualizar la conciliación del pago');
  }
}

export async function createPaymentPlan(params: {
  bookingId: string;
  frequency: string;
  startDate: string;
  endDate: string;
  totalAmount: number;
  currency: string;
  installmentCount: number;
  installmentAmount: number;
  provider: string;
  autoDebit: boolean;
  installments: Array<{ installmentIndex: number; dueDate: string; amount: number }>;
}): Promise<PaymentPlanRecord> {
  const supabase = ensureSupabase();
  const { data: plan, error } = await supabase
    .from('cumbre_payment_plans')
    .insert({
      booking_id: params.bookingId,
      status: 'ACTIVE',
      frequency: params.frequency,
      start_date: params.startDate,
      end_date: params.endDate,
      total_amount: params.totalAmount,
      currency: params.currency,
      installment_count: params.installmentCount,
      installment_amount: params.installmentAmount,
      amount_paid: 0,
      provider: params.provider,
      auto_debit: params.autoDebit,
      next_due_date: params.installments[0]?.dueDate ?? params.startDate,
    })
    .select('*')
    .single();

  if (error || !plan) {
    console.error('[cumbre.installments] plan insert error', error);
    throw new Error('No se pudo crear el plan de cuotas');
  }

  const rows = params.installments.map((item) => ({
    plan_id: plan.id,
    booking_id: params.bookingId,
    installment_index: item.installmentIndex,
    due_date: item.dueDate,
    amount: item.amount,
    currency: params.currency,
    status: 'PENDING',
  }));

  const { error: installmentError } = await supabase
    .from('cumbre_installments')
    .insert(rows);

  if (installmentError) {
    console.error('[cumbre.installments] insert error', installmentError);
    throw new Error('No se pudo crear el cronograma de cuotas');
  }

  return plan as PaymentPlanRecord;
}

export async function updatePaymentPlan(planId: string, updates: Partial<PaymentPlanRecord>): Promise<void> {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from('cumbre_payment_plans')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId);
  if (error) {
    console.error('[cumbre.installments] plan update error', error);
  }
}

export async function updateInstallment(installmentId: string, updates: Partial<InstallmentRecord>): Promise<void> {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from('cumbre_installments')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', installmentId);
  if (error) {
    console.error('[cumbre.installments] installment update error', error);
  }
}

export async function cancelPendingInstallmentsForPlan(planId: string): Promise<number> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .update({
      status: 'CANCELLED',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('plan_id', planId)
    .in('status', ['PENDING', 'FAILED'])
    .select('id');

  if (error) {
    console.error('[cumbre.installments] pending cancel error', error);
    return 0;
  }

  return data?.length ?? 0;
}

export async function completePaymentPlan(planId: string, params?: {
  totalAmount?: number;
  amountPaid?: number;
  currency?: string;
}): Promise<{ cancelledInstallments: number }> {
  const cancelledInstallments = await cancelPendingInstallmentsForPlan(planId);
  const updates: Partial<PaymentPlanRecord> = {
    status: 'COMPLETED',
    auto_debit: false,
    next_due_date: null,
    installment_amount: 0,
  };

  if (params?.totalAmount !== undefined) {
    updates.total_amount = params.totalAmount;
  }
  if (params?.amountPaid !== undefined) {
    updates.amount_paid = params.amountPaid;
  }
  if (params?.currency) {
    updates.currency = params.currency;
  }

  await updatePaymentPlan(planId, updates);
  return { cancelledInstallments };
}

export async function closePaymentPlan(planId: string, params?: {
  status?: 'COMPLETED' | 'CANCELLED';
  totalAmount?: number;
  amountPaid?: number;
  currency?: string;
}): Promise<{ cancelledInstallments: number }> {
  const cancelledInstallments = await cancelPendingInstallmentsForPlan(planId);
  const updates: Partial<PaymentPlanRecord> = {
    status: params?.status ?? 'CANCELLED',
    auto_debit: false,
    next_due_date: null,
    installment_amount: 0,
  };

  if (params?.totalAmount !== undefined) {
    updates.total_amount = params.totalAmount;
  }
  if (params?.amountPaid !== undefined) {
    updates.amount_paid = params.amountPaid;
  }
  if (params?.currency) {
    updates.currency = params.currency;
  }

  await updatePaymentPlan(planId, updates);
  return { cancelledInstallments };
}

export async function getInstallmentByReference(reference: string): Promise<InstallmentRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*')
    .eq('provider_reference', reference)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] lookup by reference error', error);
    return null;
  }
  return data as InstallmentRecord | null;
}

export async function getNextPendingInstallment(planId: string): Promise<InstallmentRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*')
    .eq('plan_id', planId)
    .in('status', ['PENDING', 'FAILED'])
    .order('installment_index', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] next installment error', error);
    return null;
  }
  return data as InstallmentRecord | null;
}

export async function listPendingInstallments(planId: string): Promise<InstallmentRecord[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*')
    .eq('plan_id', planId)
    .in('status', ['PENDING', 'FAILED'])
    .order('installment_index', { ascending: true });
  if (error) {
    console.error('[cumbre.installments] pending list error', error);
    return [];
  }
  return (data || []) as InstallmentRecord[];
}

export async function getInstallmentByPlanIndex(planId: string, index: number): Promise<InstallmentRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*')
    .eq('plan_id', planId)
    .eq('installment_index', index)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] installment lookup error', error);
    return null;
  }
  return data as InstallmentRecord | null;
}

export async function applyManualPaymentToPlan(params: {
  planId: string;
  amount: number;
  reference?: string | null;
  paidAt?: string;
}): Promise<{ paidAmount: number; remainingAmount: number; paidInstallments: number }> {
  const plan = await getPlanById(params.planId);
  if (!plan) {
    return {
      paidAmount: 0,
      remainingAmount: Number(params.amount || 0),
      paidInstallments: 0,
    };
  }

  const installments = await listPendingInstallments(params.planId);
  let remaining = Math.max(Number(params.amount || 0), 0);
  let paidAmount = 0;
  let paidCount = 0;
  const paidAt = params.paidAt ?? new Date().toISOString();
  const currency = plan.currency === 'USD' ? 'USD' : 'COP';

  for (const installment of installments) {
    const installmentAmount = Number(installment.amount || 0);
    if (remaining + 0.01 < installmentAmount) break;
    remaining = remaining - installmentAmount;
    paidAmount += installmentAmount;
    paidCount += 1;
    await updateInstallment(installment.id, {
      status: 'PAID',
      provider_reference: params.reference ?? installment.provider_reference ?? null,
      paid_at: paidAt,
      last_error: null,
    });
  }

  const maxPayable = Math.max(Number(plan.total_amount || 0) - Number(plan.amount_paid || 0), 0);
  const appliedAmount = Math.min(maxPayable, paidAmount + remaining);

  if (appliedAmount > 0) {
    await addPlanPayment(plan.id, appliedAmount);
  }

  const remainingBalance = Math.max(Number(plan.total_amount || 0) - (Number(plan.amount_paid || 0) + appliedAmount), 0);
  const pendingAfter = installments.slice(paidCount);

  if (pendingAfter.length === 0) {
    await refreshPlanNextDueDate(plan.id);
    return {
      paidAmount: appliedAmount,
      remainingAmount: remainingBalance,
      paidInstallments: paidCount,
    };
  }

  if (remainingBalance <= 0) {
    await Promise.all(pendingAfter.map((installment) => updateInstallment(installment.id, {
      status: 'PAID',
      provider_reference: params.reference ?? installment.provider_reference ?? null,
      paid_at: paidAt,
      last_error: null,
    })));
    await refreshPlanNextDueDate(plan.id);
    return {
      paidAmount: appliedAmount,
      remainingAmount: 0,
      paidInstallments: paidCount + pendingAfter.length,
    };
  }

  const pendingCount = pendingAfter.length;
  const average = roundCurrency(remainingBalance / pendingCount, currency as Currency);
  let accumulated = 0;

  await Promise.all(pendingAfter.map((installment, index) => {
    const isLast = index === pendingCount - 1;
    const amount = isLast
      ? roundCurrency(remainingBalance - accumulated, currency as Currency)
      : average;
    accumulated = roundCurrency(accumulated + amount, currency as Currency);
    return updateInstallment(installment.id, { amount });
  }));

  await updatePaymentPlan(plan.id, { installment_amount: average });
  await refreshPlanNextDueDate(plan.id);

  return {
    paidAmount: appliedAmount,
    remainingAmount: remainingBalance,
    paidInstallments: paidCount,
  };
}

export async function addPlanPayment(planId: string, amount: number): Promise<void> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payment_plans')
    .select('amount_paid')
    .eq('id', planId)
    .maybeSingle();
  if (error || !data) {
    console.error('[cumbre.installments] plan amount lookup error', error);
    return;
  }
  const newPaid = Number(data.amount_paid || 0) + Number(amount || 0);
  await updatePaymentPlan(planId, { amount_paid: newPaid });
}

export async function refreshPlanNextDueDate(planId: string): Promise<void> {
  const next = await getNextPendingInstallment(planId);
  await updatePaymentPlan(planId, {
    next_due_date: next?.due_date ?? null,
    status: next ? 'ACTIVE' : 'COMPLETED',
  });
}

export async function listDueInstallments(limit = 25): Promise<(InstallmentRecord & { plan: PaymentPlanRecord })[]> {
  const supabase = ensureSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*, plan:cumbre_payment_plans(*)')
    .in('status', ['PENDING', 'FAILED'])
    .lte('due_date', today)
    .order('due_date', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[cumbre.installments] due list error', error);
    return [];
  }
  return (data || []) as (InstallmentRecord & { plan: PaymentPlanRecord })[];
}

export async function listInstallmentsByDueDates(
  dueDates: string[],
  limit = 200,
): Promise<(InstallmentRecord & { plan: PaymentPlanRecord; booking: BookingRecord })[]> {
  if (!dueDates.length) return [];
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*, plan:cumbre_payment_plans(*), booking:cumbre_bookings(*)')
    .in('status', ['PENDING', 'FAILED'])
    .in('due_date', dueDates)
    .order('due_date', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[cumbre.installments] due list error', error);
    return [];
  }
  return (data || []) as (InstallmentRecord & { plan: PaymentPlanRecord; booking: BookingRecord })[];
}

export async function getInstallmentById(installmentId: string): Promise<InstallmentRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installments')
    .select('*')
    .eq('id', installmentId)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] lookup error', error);
    return null;
  }
  return data as InstallmentRecord | null;
}

export async function hasInstallmentReminder(params: {
  installmentId: string;
  reminderKey: string;
  channel: string;
}): Promise<boolean> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_installment_reminders')
    .select('id')
    .eq('installment_id', params.installmentId)
    .eq('reminder_key', params.reminderKey)
    .eq('channel', params.channel)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.reminders] lookup error', error);
    return true;
  }
  return Boolean(data?.id);
}

export async function recordInstallmentReminder(params: {
  installmentId: string;
  reminderKey: string;
  channel: string;
  payload?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from('cumbre_installment_reminders')
    .insert({
      installment_id: params.installmentId,
      reminder_key: params.reminderKey,
      channel: params.channel,
      payload: params.payload ?? null,
      error: params.error ?? null,
    });
  if (error) {
    console.error('[cumbre.reminders] insert error', error);
  }
}

export async function createInstallmentLinkToken(installmentId: string, ttlDays = 30): Promise<string | null> {
  const supabase = ensureSupabase();
  const tokenPair = generateAccessToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('cumbre_installment_links')
    .insert({
      installment_id: installmentId,
      token_hash: tokenPair.hash,
      expires_at: expiresAt,
    });
  if (error) {
    console.error('[cumbre.installments.links] insert error', error);
    return null;
  }
  return tokenPair.token;
}

export async function getInstallmentByLinkToken(token: string): Promise<{
  link: InstallmentLinkRecord;
  installment: InstallmentRecord & { plan: PaymentPlanRecord; booking: BookingRecord };
} | null> {
  if (!token) return null;
  const supabase = ensureSupabase();
  const tokenHash = hashToken(token);
  const { data, error } = await supabase
    .from('cumbre_installment_links')
    .select('id, installment_id, token_hash, expires_at, used_at, created_at, installment:cumbre_installments(*, plan:cumbre_payment_plans(*), booking:cumbre_bookings(*))')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments.links] lookup error', error);
    return null;
  }
  if (!data?.installment) return null;
  const link: InstallmentLinkRecord = {
    id: data.id,
    installment_id: data.installment_id,
    token_hash: data.token_hash,
    expires_at: data.expires_at ?? null,
    used_at: data.used_at ?? null,
    created_at: data.created_at,
  };
  return {
    link,
    installment: data.installment as InstallmentRecord & { plan: PaymentPlanRecord; booking: BookingRecord },
  };
}

export async function markInstallmentLinksUsed(installmentId: string): Promise<void> {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from('cumbre_installment_links')
    .update({ used_at: new Date().toISOString() })
    .eq('installment_id', installmentId)
    .is('used_at', null);
  if (error) {
    console.error('[cumbre.installments.links] mark used error', error);
  }
}

export async function getPlanByProviderSubscription(subscriptionId: string): Promise<PaymentPlanRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payment_plans')
    .select('*')
    .eq('provider_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] plan lookup error', error);
    return null;
  }
  return data as PaymentPlanRecord | null;
}

export async function getPlanByBookingId(bookingId: string): Promise<PaymentPlanRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payment_plans')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] plan lookup error', error);
    return null;
  }
  return data as PaymentPlanRecord | null;
}

export async function getPlanById(planId: string): Promise<PaymentPlanRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('cumbre_payment_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();
  if (error) {
    console.error('[cumbre.installments] plan lookup error', error);
    return null;
  }
  return data as PaymentPlanRecord | null;
}

export async function recomputeBookingTotals(bookingId: string): Promise<void> {
  const supabase = ensureSupabase();
  const booking = await getBookingById(bookingId);
  if (!booking) return;

  const { data: payments, error } = await supabase
    .from('cumbre_payments')
    .select('amount,status')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');

  if (error) {
    console.error('[cumbre.payments] sum error', error);
    return;
  }

  const totalPaid = (payments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const threshold = booking.deposit_threshold || depositThreshold(Number(booking.total_amount || 0));
  const newStatus = statusFromPaid(totalPaid, Number(booking.total_amount || 0));
  const prevStatus = booking.status;

  const { error: updateError } = await supabase
    .from('cumbre_bookings')
    .update({
      total_paid: totalPaid,
      status: newStatus,
      deposit_threshold: threshold,
    })
    .eq('id', bookingId);

  if (updateError) {
    console.error('[cumbre.booking] update error', updateError);
    return;
  }

  if (booking.contact_email) {
    if (newStatus !== prevStatus && newStatus === 'DEPOSIT_OK') {
      await sendCumbreEmail('deposit_ok', {
        to: booking.contact_email,
        fullName: booking.contact_name ?? undefined,
        bookingId,
        totalPaid,
        totalAmount: Number(booking.total_amount || 0),
        currency: booking.currency,
      });
    }
    if (newStatus !== prevStatus && newStatus === 'PAID') {
      await sendCumbreEmail('paid', {
        to: booking.contact_email,
        fullName: booking.contact_name ?? undefined,
        bookingId,
        totalPaid,
        totalAmount: Number(booking.total_amount || 0),
        currency: booking.currency,
      });
    }
  }
}
