import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { MISIONEROS } from '@data/misioneros';

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
  const requestedCampusMissionarySlug = String(payload.campusMissionarySlug || '').trim();
  if (
    desiredRole === 'campus_missionary'
    && !MISIONEROS.some((missionary) => missionary.slug === requestedCampusMissionarySlug)
  ) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona un misionero Campus válido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role, campus_missionary_slug')
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
    campus_missionary_slug: desiredRole === 'campus_missionary' ? requestedCampusMissionarySlug : null,
    updated_at: new Date().toISOString(),
  };
  if (desiredRole === 'campus_missionary') {
    const { data: slugOwner, error: slugOwnerError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('campus_missionary_slug', requestedCampusMissionarySlug)
      .neq('user_id', targetProfile.user_id)
      .maybeSingle();
    if (slugOwnerError) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el misionero Campus' }), { status: 500 });
    }
    if (slugOwner?.user_id) {
      return new Response(JSON.stringify({ ok: false, error: 'Ese misionero Campus ya está asociado a otra cuenta' }), { status: 409 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updatePayload)
    .eq('user_id', payload.userId)
    .select('user_id, role')
    .single();

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
