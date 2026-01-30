import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

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

export const POST: APIRoute = async ({ request }) => {
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
  if (!payload?.userId || !payload?.role) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const desiredRole = String(payload.role);
  if (ctx.role !== 'superadmin' && desiredRole !== 'user') {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese rol' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({ role: desiredRole, updated_at: new Date().toISOString() })
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
