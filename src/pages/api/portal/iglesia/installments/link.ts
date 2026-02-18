import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { createInstallmentLinkToken } from '@lib/cumbreStore';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a cuotas');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
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
    .select('id, booking_id, status, booking:cumbre_bookings(id, church_id), plan:cumbre_payment_plans(id, provider, provider_payment_method_id, provider_subscription_id)')
    .eq('id', installmentId)
    .maybeSingle();

  if (error || !installment) {
    return new Response(JSON.stringify({ ok: false, error: 'Cuota no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const booking = (installment as any).booking;
  const plan = (installment as any).plan;
  const isAuto = (plan?.provider === 'wompi' && plan?.provider_payment_method_id)
    || (plan?.provider === 'stripe' && plan?.provider_subscription_id);

  if (!access.isAdmin) {
    const isAllowedChurch = await isChurchAllowedForAccess(booking?.church_id || null, access);
    if (!isAllowedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (isAuto) {
    return new Response(JSON.stringify({ ok: false, error: 'Cobro automático activo' }), {
      status: 400,
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
