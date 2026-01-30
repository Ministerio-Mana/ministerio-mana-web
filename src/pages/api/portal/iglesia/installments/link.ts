import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { createInstallmentLinkToken } from '@lib/cumbreStore';

export const prerender = false;

async function getPortalContext(request: Request) {
  let isAllowed = false;
  let isAdmin = false;
  let churchId: string | null = null;
  let profile: any = null;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return { ok: false, isAdmin: false, churchId: null, profile: null };
    }
    isAllowed = true;
    isAdmin = true;
  } else {
    profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    isAdmin = Boolean(profile && isAdminRole(profile.role));
    isAllowed = Boolean(profile && (isAdmin || hasChurchRole));
    churchId = memberships.find((m: any) => m?.church?.id)?.church?.id || profile?.church_id || null;
  }

  if (!isAllowed) {
    return { ok: false, isAdmin: false, churchId: null, profile: profile ?? null };
  }

  return { ok: true, isAdmin, churchId, profile };
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getPortalContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
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
  const targetChurch = ctx.profile?.portal_church_id || ctx.profile?.church_id || ctx.churchId;
  const isAuto = (plan?.provider === 'wompi' && plan?.provider_payment_method_id)
    || (plan?.provider === 'stripe' && plan?.provider_subscription_id);

  if (!ctx.isAdmin && booking?.church_id && targetChurch && booking.church_id !== targetChurch) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
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
