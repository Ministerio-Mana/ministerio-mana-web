import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getPortalChurchAccessContext(request);
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  let targetChurch = ctx.isAdmin ? (requestedChurch || ctx.allowedChurchId) : ctx.allowedChurchId;
  const requiresScopedChurchSelection = !ctx.isAdmin && !ctx.allowedChurchId;
  if (requiresScopedChurchSelection) {
    if (!requestedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const isAllowedChurch = await isChurchAllowedForAccess(requestedChurch, ctx);
    if (!isAllowedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    targetChurch = requestedChurch;
  }

  if (!targetChurch) {
    if (ctx.isAdmin) {
      return new Response(JSON.stringify({ ok: true, members: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: 'Sin iglesia asignada' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: memberships, error } = await supabaseAdmin
    .from('church_memberships')
    .select('user_id, role, status, church:churches(id, name, city, country)')
    .eq('church_id', targetChurch);

  if (error) {
    console.error('[portal.iglesia.members] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const userIds = (memberships || []).map((m: any) => m.user_id);
  let profiles: any[] = [];
  if (userIds.length) {
    const { data } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, full_name, phone')
      .in('user_id', userIds);
    profiles = data ?? [];
  }

  const profileMap = profiles.reduce((acc: any, row: any) => {
    acc[row.user_id] = row;
    return acc;
  }, {});

  const response = (memberships || []).map((item: any) => ({
    ...item,
    profile: profileMap[item.user_id] || null,
  }));

  return new Response(JSON.stringify({ ok: true, members: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
