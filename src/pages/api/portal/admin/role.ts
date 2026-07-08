import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { MISIONEROS } from '@data/misioneros';

export const prerender = false;

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function normalizeNameForMatch(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveCampusMissionarySlug(fullName?: string | null): string | null {
  const normalizedFullName = normalizeNameForMatch(fullName || '');
  if (!normalizedFullName) return null;
  const match = MISIONEROS.find((missionary) => {
    const normalizedMissionaryName = normalizeNameForMatch(missionary.nombre);
    return (
      normalizedMissionaryName === normalizedFullName
      || normalizedFullName.includes(normalizedMissionaryName)
      || normalizedMissionaryName.includes(normalizedFullName)
    );
  });
  return match?.slug || null;
}

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
    identifier: 'portal.admin.role',
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
    return new Response(JSON.stringify({ ok: false, error: 'Solo superadmin puede actualizar este rol' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.userId || !payload?.role) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const desiredRole = String(payload.role);
  const ALLOWED_ROLE_CHANGES = new Set(['user', 'admin', 'superadmin', 'campus_missionary', 'intercessor']);
  if (!ALLOWED_ROLE_CHANGES.has(desiredRole)) {
    return new Response(JSON.stringify({ ok: false, error: 'Rol no permitido en este flujo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role, full_name')
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (targetProfileError) {
    console.error('[portal.admin.role] target fetch error', targetProfileError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el usuario' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!targetProfile?.user_id) {
    return new Response(JSON.stringify({ ok: false, error: 'Usuario no encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (ctx.userId && targetProfile.user_id === ctx.userId && desiredRole !== 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'No puedes quitarte el rol superadmin a ti mismo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const updatePayload: Record<string, unknown> = {
    role: desiredRole,
    updated_at: new Date().toISOString(),
  };
  const campusMissionarySlug = desiredRole === 'campus_missionary'
    ? resolveCampusMissionarySlug(targetProfile.full_name)
    : null;
  if (campusMissionarySlug) {
    updatePayload.campus_missionary_slug = campusMissionarySlug;
  }

  let { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updatePayload)
    .eq('user_id', payload.userId)
    .select('user_id, role')
    .single();

  if (error && campusMissionarySlug && isMissingColumnError(error)) {
    delete updatePayload.campus_missionary_slug;
    const fallback = await supabaseAdmin
      .from('user_profiles')
      .update(updatePayload)
      .eq('user_id', payload.userId)
      .select('user_id, role')
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('[portal.admin.role] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, user: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
