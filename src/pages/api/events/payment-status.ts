import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceRateLimit } from '@lib/rateLimit';
import { isEventPaymentReference } from '@lib/eventFinance';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ url, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const allowed = await enforceRateLimit(`events.payment-status:${clientAddress || 'unknown'}`, 60, 30, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas consultas.' }, 429);

  const eventId = String(url.searchParams.get('event_id') || '').trim();
  const reference = String(url.searchParams.get('reference') || '').trim().toUpperCase();
  if (!UUID_PATTERN.test(eventId) || !isEventPaymentReference(reference)) {
    return json({ ok: false, error: 'Referencia inválida.' }, 400);
  }

  const { data: payment, error } = await supabaseAdmin
    .from('event_payments')
    .select('id, registration_id, status, received_at')
    .eq('event_id', eventId)
    .eq('reference', reference)
    .maybeSingle();
  if (error) return json({ ok: false, error: 'No se pudo consultar el pago.' }, 500);
  if (!payment) return json({ ok: false, error: 'Pago no encontrado.' }, 404);

  const { data: registration } = await supabaseAdmin
    .from('event_registrations')
    .select('status')
    .eq('id', payment.registration_id)
    .maybeSingle();

  return json({
    ok: true,
    payment_status: payment.status,
    registration_status: registration?.status || null,
  });
};
