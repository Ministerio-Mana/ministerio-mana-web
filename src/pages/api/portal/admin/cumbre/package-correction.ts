import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { depositThreshold, getPrice, isValidPackageType, statusFromPaid, type Currency, type PackageType } from '@lib/cumbre2026';
import { buildInstallmentSchedule, getInstallmentDeadline, roundCurrency } from '@lib/cumbreInstallments';
import { getPlanByBookingId, updateInstallment, updatePaymentPlan } from '@lib/cumbreStore';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

const MANUAL_PAYMENT_METHODS = new Set(['', 'manual', 'cash', 'physical']);
const MANUAL_SOURCES = new Set(['', 'portal-iglesia', 'portal-iglesia-edit', 'cumbre-manual']);

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function normalizeCurrency(raw: unknown): Currency {
  return String(raw || '').trim().toUpperCase() === 'USD' ? 'USD' : 'COP';
}

function normalizeFrequency(raw: string | null | undefined): 'MONTHLY' | 'BIWEEKLY' {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'BIWEEKLY' || value === 'QUINCENAL') return 'BIWEEKLY';
  return 'MONTHLY';
}

function packageLabel(value: string): string {
  if (value === 'lodging') return 'Con alojamiento';
  if (value === 'no_lodging') return 'Sin alojamiento';
  if (value === 'child_0_7') return 'Nino 0-4';
  if (value === 'child_7_13') return 'Nino 5-10';
  return value || 'SIN_PAQUETE';
}

function calculateExpectedTotal(participants: any[], currency: Currency): number {
  return participants.reduce((sum, participant) => {
    const packageType = String(participant?.package_type || '').trim() as PackageType;
    if (!isValidPackageType(packageType)) return sum;
    return sum + getPrice(currency, packageType);
  }, 0);
}

async function getApprovedPaymentsTotal(bookingId: string): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { data, error } = await supabaseAdmin
    .from('cumbre_payments')
    .select('amount')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');

  if (error) {
    console.error('[portal.admin.cumbre.package-correction] payments error', error);
    throw new Error('No se pudo calcular pagos aprobados');
  }

  return (data || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

async function syncPendingPlan(params: {
  bookingId: string;
  totalAmount: number;
  totalPaid: number;
  currency: Currency;
}) {
  if (!supabaseAdmin) return null;

  const plan = await getPlanByBookingId(params.bookingId);
  if (!plan) return null;

  const planFrequency = String(plan.frequency || 'MONTHLY').toUpperCase();
  const remaining = Math.max(Number(params.totalAmount || 0) - Number(params.totalPaid || 0), 0);

  if (planFrequency === 'DEPOSIT') {
    const remainingRounded = roundCurrency(remaining, params.currency);
    await updatePaymentPlan(plan.id, {
      total_amount: remainingRounded,
      installment_amount: remainingRounded,
      installment_count: 1,
      currency: params.currency,
      status: remainingRounded <= 0 ? 'PAID' : plan.status,
    });

    const { data: installments, error } = await supabaseAdmin
      .from('cumbre_installments')
      .select('id, status, due_date')
      .eq('plan_id', plan.id)
      .in('status', ['PENDING', 'FAILED']);

    if (error) {
      console.error('[portal.admin.cumbre.package-correction] deposit installments error', error);
      return { id: plan.id, updated: true, warning: 'No se pudieron ajustar cuotas pendientes' };
    }

    await Promise.all((installments || []).map((installment) => updateInstallment(installment.id, {
      amount: remainingRounded,
      currency: params.currency,
      status: remainingRounded <= 0 ? 'PAID' : installment.status,
    })));

    const nextDue = (installments || []).find((installment) => installment.due_date)?.due_date || null;
    await updatePaymentPlan(plan.id, { next_due_date: remainingRounded <= 0 ? null : nextDue });
    return { id: plan.id, updated: true, frequency: 'DEPOSIT' };
  }

  const frequency = normalizeFrequency(planFrequency);
  const deadline = plan.end_date || getInstallmentDeadline();
  const startDate = plan.start_date ? new Date(`${plan.start_date}T00:00:00Z`) : new Date();
  const schedule = buildInstallmentSchedule({
    totalAmount: params.totalAmount,
    currency: params.currency,
    frequency,
    startDate,
    deadline,
  });

  await updatePaymentPlan(plan.id, {
    total_amount: params.totalAmount,
    installment_amount: schedule.installmentAmount,
    installment_count: schedule.installmentCount,
    currency: params.currency,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    status: remaining <= 0 ? 'PAID' : plan.status,
  });

  const { data: installments, error } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, status, installment_index')
    .eq('plan_id', plan.id);

  if (error) {
    console.error('[portal.admin.cumbre.package-correction] installments error', error);
    return { id: plan.id, updated: true, warning: 'No se pudieron ajustar cuotas pendientes' };
  }

  const scheduleByIndex = new Map(schedule.installments.map((item) => [item.installmentIndex, item]));
  const pending = (installments || []).filter((installment) => ['PENDING', 'FAILED'].includes(installment.status));
  await Promise.all(pending.map((installment) => {
    const scheduleItem = scheduleByIndex.get(installment.installment_index);
    if (!scheduleItem) return Promise.resolve();
    return updateInstallment(installment.id, {
      amount: remaining <= 0 ? 0 : scheduleItem.amount,
      due_date: scheduleItem.dueDate,
      currency: params.currency,
      status: remaining <= 0 ? 'PAID' : installment.status,
    });
  }));

  const nextDue = pending
    .map((installment) => scheduleByIndex.get(installment.installment_index)?.dueDate)
    .filter(Boolean)
    .sort()[0] || null;
  await updatePaymentPlan(plan.id, { next_due_date: remaining <= 0 ? null : nextDue });
  return { id: plan.id, updated: true, frequency };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.package-correction',
  });

  if (!guard.ok) {
    return jsonResponse({ ok: false, error: guard.error || 'No autorizado' }, guard.status);
  }

  if (!supabaseAdmin) {
    return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  }

  const body = await request.json().catch(() => null);
  const bookingId = String(body?.bookingId || body?.booking_id || '').trim();
  const participantIds = Array.isArray(body?.participantIds)
    ? body.participantIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  const targetPackageType = String(body?.targetPackageType || body?.target_package_type || 'no_lodging').trim() as PackageType;
  const dryRun = body?.dryRun !== false;
  const confirm = String(body?.confirm || '').trim();
  const allowOnline = body?.allowOnline === true;
  const reason = String(body?.reason || '').trim().slice(0, 500);

  if (!isUuid(bookingId) || participantIds.length === 0 || participantIds.some((id) => !isUuid(id))) {
    return jsonResponse({ ok: false, error: 'bookingId y participantIds validos son requeridos' }, 400);
  }

  if (participantIds.length > 20) {
    return jsonResponse({ ok: false, error: 'Corrige maximo 20 participantes por solicitud' }, 400);
  }

  if (targetPackageType !== 'no_lodging') {
    return jsonResponse({ ok: false, error: 'Esta correccion segura solo permite cambiar de lodging a no_lodging' }, 400);
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, currency, total_amount, total_paid, status, deposit_threshold, payment_method, source')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return jsonResponse({ ok: false, error: 'Reserva no encontrada' }, 404);
  }

  const paymentMethod = String(booking.payment_method || '').trim().toLowerCase();
  const source = String(booking.source || '').trim().toLowerCase();
  if (!dryRun && (!MANUAL_PAYMENT_METHODS.has(paymentMethod) || !MANUAL_SOURCES.has(source)) && !allowOnline) {
    return jsonResponse({
      ok: false,
      error: 'La reserva parece tener origen/pago online. Revisa en dryRun y reenvia con allowOnline=true si confirmas la correccion.',
    }, 409);
  }

  const { data: participants, error: participantsError } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, relationship, document_type, document_number, package_type')
    .eq('booking_id', bookingId);

  if (participantsError) {
    return jsonResponse({ ok: false, error: 'No se pudieron cargar participantes' }, 500);
  }

  const participantsById = new Map((participants || []).map((participant) => [participant.id, participant]));
  const selected = participantIds.map((id) => participantsById.get(id));
  if (selected.some((participant) => !participant)) {
    return jsonResponse({ ok: false, error: 'Uno o mas participantes no pertenecen a la reserva' }, 400);
  }

  const invalidSelected = selected.filter((participant) => participant?.package_type !== 'lodging');
  if (invalidSelected.length > 0) {
    return jsonResponse({
      ok: false,
      error: 'Solo se corrigen participantes que actualmente estan en lodging',
      invalid_participants: invalidSelected.map((participant) => ({
        participant_id: participant?.id,
        name: participant?.full_name,
        package_type: participant?.package_type,
      })),
    }, 409);
  }

  const currency = normalizeCurrency(booking.currency);
  const beforeParticipants = participants || [];
  const afterParticipants = beforeParticipants.map((participant) => (
    participantIds.includes(participant.id)
      ? { ...participant, package_type: targetPackageType }
      : participant
  ));
  const beforeTotal = roundCurrency(calculateExpectedTotal(beforeParticipants, currency), currency);
  const afterTotal = roundCurrency(calculateExpectedTotal(afterParticipants, currency), currency);
  const totalPaid = roundCurrency(await getApprovedPaymentsTotal(bookingId), currency);
  const afterDepositThreshold = depositThreshold(afterTotal);
  const afterStatus = statusFromPaid(totalPaid, afterTotal);
  const responsePayload = {
    ok: true,
    dryRun,
    booking: {
      id: booking.id,
      contact_name: booking.contact_name || '',
      currency,
      current_total_amount: Number(booking.total_amount || 0),
      expected_total_before: beforeTotal,
      expected_total_after: afterTotal,
      total_paid: totalPaid,
      status_before: booking.status || '',
      status_after: afterStatus,
      deposit_threshold_after: afterDepositThreshold,
    },
    changes: selected.map((participant) => ({
      participant_id: participant?.id,
      name: participant?.full_name,
      relationship: participant?.relationship,
      from: packageLabel('lodging'),
      to: packageLabel(targetPackageType),
      price_before: getPrice(currency, 'lodging'),
      price_after: getPrice(currency, targetPackageType),
    })),
    message: dryRun
      ? 'Vista previa solamente. No se escribio nada en la base de datos.'
      : 'Correccion aplicada.',
  };

  if (dryRun) {
    return jsonResponse(responsePayload);
  }

  if (confirm !== 'APLICAR') {
    return jsonResponse({ ok: false, error: 'Para aplicar envia dryRun=false y confirm=\"APLICAR\"' }, 400);
  }

  const { data: updatedParticipants, error: updateParticipantsError } = await supabaseAdmin
    .from('cumbre_participants')
    .update({ package_type: targetPackageType })
    .eq('booking_id', bookingId)
    .eq('package_type', 'lodging')
    .in('id', participantIds)
    .select('id');

  if (updateParticipantsError || (updatedParticipants || []).length !== participantIds.length) {
    console.error('[portal.admin.cumbre.package-correction] participants update error', updateParticipantsError);
    return jsonResponse({
      ok: false,
      error: 'No se aplico la correccion completa de participantes. Revisa auditoria antes de intentar de nuevo.',
      updated_count: updatedParticipants?.length || 0,
      expected_count: participantIds.length,
    }, 500);
  }

  const { error: bookingUpdateError } = await supabaseAdmin
    .from('cumbre_bookings')
    .update({
      total_amount: afterTotal,
      total_paid: totalPaid,
      status: afterStatus,
      deposit_threshold: afterDepositThreshold,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  if (bookingUpdateError) {
    console.error('[portal.admin.cumbre.package-correction] booking update error', bookingUpdateError);
    return jsonResponse({
      ok: false,
      error: 'Participantes corregidos, pero fallo el recalculo de reserva. Ejecuta recompute y revisa auditoria.',
    }, 500);
  }

  const planResult = await syncPendingPlan({
    bookingId,
    totalAmount: afterTotal,
    totalPaid,
    currency,
  });

  await logSecurityEvent({
    type: 'maintenance',
    identifier: 'portal.admin.cumbre.package-correction',
    ip: clientAddress || null,
    detail: reason || 'Correccion package_type lodging -> no_lodging',
    meta: {
      actor_email: guard.email,
      actor_user_id: guard.userId,
      booking_id: bookingId,
      participant_ids: participantIds,
      before_total: beforeTotal,
      after_total: afterTotal,
      total_paid: totalPaid,
      status_after: afterStatus,
      plan: planResult,
    },
  });

  return jsonResponse({
    ...responsePayload,
    dryRun: false,
    plan: planResult,
  });
};
