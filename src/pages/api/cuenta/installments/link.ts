import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { createInstallmentLinkToken } from '@lib/cumbreStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  let email = user?.email?.toLowerCase() ?? '';
  if (!email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    email = passwordSession.email.toLowerCase();
  }

  const body = await request.json().catch(() => ({}));
  const installmentId = (body?.installmentId || '').toString();
  if (!installmentId) {
    return new Response(JSON.stringify({ ok: false, error: 'installmentId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: installment, error } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, status, booking:cumbre_bookings(id, contact_email)')
    .eq('id', installmentId)
    .maybeSingle();

  if (error || !installment) {
    return new Response(JSON.stringify({ ok: false, error: 'Cuota no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const booking = (installment as any).booking;
  if (!booking?.contact_email || booking.contact_email.toLowerCase() !== email) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const token = await createInstallmentLinkToken(installmentId);
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo generar el link' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const baseUrl = resolveBaseUrl(request);
  const url = `${baseUrl}/cumbre2026/pagar/${token}`;

  return new Response(JSON.stringify({ ok: true, url, token }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
