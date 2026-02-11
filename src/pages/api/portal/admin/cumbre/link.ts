import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { generateAccessToken } from '@lib/cumbre2026';
import { resolveBaseUrl } from '@lib/url';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null };
    }
    return { ok: true, role: profile.role };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null };
  }

  return { ok: true, role: 'superadmin' };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.link',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAdminContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = String(payload.bookingId);
  const tokenPair = generateAccessToken();

  const { error } = await supabaseAdmin
    .from('cumbre_bookings')
    .update({
      token_hash: tokenPair.hash,
    })
    .eq('id', bookingId);

  if (error) {
    console.error('[portal.admin.cumbre.link] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo generar el enlace' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const baseUrl = resolveBaseUrl(request);
  const ctaUrl = `${baseUrl}/eventos/cumbre-mundial-2026/registro?bookingId=${bookingId}&token=${tokenPair.token}`;

  return new Response(JSON.stringify({ ok: true, ctaUrl }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
