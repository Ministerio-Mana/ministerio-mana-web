import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { resolveBaseUrl } from '@lib/url';
import { normalizeChurchName, normalizeCityName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText } from '@lib/validation';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null, userId: null };
    }
    return { ok: true, role: profile.role, userId: user.id };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null, userId: null };
  }
  return { ok: true, role: 'superadmin', userId: null };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.invite',
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

  if (ctx.role !== 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para crear administradores' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Email requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const email = String(payload.email).trim().toLowerCase();
  const fullName = sanitizePlainText(payload.fullName || '', 120) || null;
  const desiredRole = String(payload.role || 'admin');
  const churchRole = String(payload.churchRole || '');
  const churchRaw = normalizeChurchName(payload.church || '');

  const ALLOWED_ADMIN_PANEL_ROLES = new Set(['admin', 'superadmin']);
  if (!ALLOWED_ADMIN_PANEL_ROLES.has(desiredRole)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rol no permitido en este flujo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const baseUrl = resolveBaseUrl(request);
  const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;

  const existingUser = await findAuthUserByEmail(email);
  let userId = existingUser?.id || null;
  const linkKind = userId ? 'recovery' : 'invite';
  const result = await sendAuthLink({ kind: linkKind, email, redirectTo });
  if (!result.ok) {
    console.error('[portal.admin.invite] invite error', result.error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar invitación' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!userId) {
    userId = result.userId || null;
  }

  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear usuario' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      email,
      full_name: fullName,
      role: desiredRole,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (churchRole && churchRaw) {
    let churchId: string | null = null;
    const { data: existingChurch } = await supabaseAdmin
      .from('churches')
      .select('id, name')
      .ilike('name', churchRaw)
      .maybeSingle();
    if (existingChurch?.id) {
      churchId = existingChurch.id;
    } else {
      const { data: created } = await supabaseAdmin
        .from('churches')
        .insert({
          name: churchRaw,
          city: normalizeCityName(payload.city || ''),
          country: normalizeCountryRegion(payload.country || '') || null,
          created_by: ctx.userId,
        })
        .select('id')
        .single();
      churchId = created?.id || null;
    }

    if (churchId) {
      await supabaseAdmin
        .from('church_memberships')
        .upsert({
          church_id: churchId,
          user_id: userId,
          role: churchRole,
          status: 'active',
        }, { onConflict: 'church_id,user_id' });
    }
  }

  return new Response(JSON.stringify({ ok: true, userId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
