import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
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
    identifier: 'portal.admin.cumbre.assign-church',
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
  if (!payload?.bookingId || (!payload?.churchId && !payload?.churchName)) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = String(payload.bookingId);
  let churchId = payload.churchId ? String(payload.churchId) : '';
  let churchName = payload.churchName ? String(payload.churchName) : '';

  if (churchId === '__virtual__') {
    churchId = '';
    churchName = churchName || 'Ministerio Virtual';
  }

  const basePayload: Record<string, any> = {
    church_id: churchId || null,
    contact_church: churchName || null,
  };

  let { data, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .update({ ...basePayload, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select('id, church_id, contact_church')
    .maybeSingle();

  if (error && error.code === 'PGRST204' && String(error.message || '').includes('updated_at')) {
    const retry = await supabaseAdmin
      .from('cumbre_bookings')
      .update(basePayload)
      .eq('id', bookingId)
      .select('id, church_id, contact_church')
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error('[portal.admin.cumbre.assign-church] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, booking: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
