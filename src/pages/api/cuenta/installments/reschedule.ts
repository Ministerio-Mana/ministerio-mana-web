import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { getInstallmentDeadline, isValidDateOnly } from '@lib/cumbreInstallments';
import { refreshPlanNextDueDate } from '@lib/cumbreStore';

export const prerender = false;

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

function isValidCalendarDate(value: string): boolean {
  if (!isValidDateOnly(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  let sessionEmail = normalizeEmail(user?.email);
  if (!sessionEmail) {
    const passwordSession = readPasswordSession(request);
    sessionEmail = normalizeEmail(passwordSession?.email);
  }

  if (!sessionEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const installmentId = String(payload.installmentId || '').trim();
  const dueDate = String(payload.dueDate || '').trim();

  if (!installmentId || !dueDate) {
    return new Response(JSON.stringify({ ok: false, error: 'installmentId y dueDate son requeridos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!isValidCalendarDate(dueDate)) {
    return new Response(JSON.stringify({ ok: false, error: 'Formato de fecha invalido. Usa YYYY-MM-DD' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) {
    return new Response(JSON.stringify({ ok: false, error: 'La fecha no puede ser anterior a hoy' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: installment, error: installmentError } = await supabaseAdmin
    .from('cumbre_installments')
    .select(
      'id, plan_id, booking_id, installment_index, due_date, status, booking:cumbre_bookings(id, contact_email), plan:cumbre_payment_plans(id, status, end_date)',
    )
    .eq('id', installmentId)
    .maybeSingle();

  if (installmentError || !installment) {
    return new Response(JSON.stringify({ ok: false, error: 'Cuota no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const booking = (installment as any).booking;
  const bookingEmail = normalizeEmail(booking?.contact_email);
  if (!bookingEmail || bookingEmail !== sessionEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para modificar esta cuota' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!['PENDING', 'FAILED'].includes(String(installment.status || ''))) {
    return new Response(JSON.stringify({ ok: false, error: 'Solo puedes mover cuotas pendientes o fallidas' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const plan = (installment as any).plan || {};
  const planStatus = String(plan.status || '').toUpperCase();
  if (['CANCELLED', 'COMPLETED'].includes(planStatus)) {
    return new Response(JSON.stringify({ ok: false, error: 'El plan ya no permite cambios de fecha' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const globalDeadline = getInstallmentDeadline();
  const planEndDate = isValidCalendarDate(String(plan.end_date || '')) ? String(plan.end_date) : null;
  const maxAllowedDate = planEndDate && planEndDate < globalDeadline ? planEndDate : globalDeadline;

  if (dueDate > maxAllowedDate) {
    return new Response(JSON.stringify({
      ok: false,
      error: `La fecha no puede superar ${maxAllowedDate}`,
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const planId = String(installment.plan_id || '').trim();
  const installmentIndex = Number(installment.installment_index || 0);
  if (!planId || !Number.isFinite(installmentIndex) || installmentIndex <= 0) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos de cuota invalidos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const [{ data: previousPending }, { data: nextPending }] = await Promise.all([
    supabaseAdmin
      .from('cumbre_installments')
      .select('due_date')
      .eq('plan_id', planId)
      .in('status', ['PENDING', 'FAILED'])
      .lt('installment_index', installmentIndex)
      .order('installment_index', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('cumbre_installments')
      .select('due_date')
      .eq('plan_id', planId)
      .in('status', ['PENDING', 'FAILED'])
      .gt('installment_index', installmentIndex)
      .order('installment_index', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const previousDueDate = String(previousPending?.due_date || '').trim();
  const nextDueDate = String(nextPending?.due_date || '').trim();

  if (previousDueDate && dueDate < previousDueDate) {
    return new Response(JSON.stringify({
      ok: false,
      error: `La fecha debe ser igual o posterior a la cuota anterior (${previousDueDate})`,
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (nextDueDate && dueDate > nextDueDate) {
    return new Response(JSON.stringify({
      ok: false,
      error: `La fecha debe ser igual o anterior a la siguiente cuota (${nextDueDate})`,
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const currentDueDate = String(installment.due_date || '').trim();
  if (currentDueDate === dueDate) {
    return new Response(JSON.stringify({
      ok: true,
      changed: false,
      installment: { id: installment.id, due_date: currentDueDate, status: installment.status },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('cumbre_installments')
    .update({
      due_date: dueDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', installment.id)
    .select('id, due_date, status')
    .single();

  if (updateError || !updated) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar la cuota' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  await refreshPlanNextDueDate(planId);

  return new Response(JSON.stringify({
    ok: true,
    changed: true,
    installment: updated,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
