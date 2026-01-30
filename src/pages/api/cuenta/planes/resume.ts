import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { updatePaymentPlan, refreshPlanNextDueDate } from '@lib/cumbreStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const planId = (payload.planId || '').toString();
  if (!planId) {
    return new Response(JSON.stringify({ ok: false, error: 'planId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: plan, error } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('id, booking_id, status')
    .eq('id', planId)
    .maybeSingle();

  if (error || !plan) {
    return new Response(JSON.stringify({ ok: false, error: 'Plan no encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: booking } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('contact_email')
    .eq('id', plan.booking_id)
    .maybeSingle();

  if (!booking?.contact_email || booking.contact_email.toLowerCase() !== user.email.toLowerCase()) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  await updatePaymentPlan(planId, { status: 'ACTIVE' });
  await refreshPlanNextDueDate(planId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
