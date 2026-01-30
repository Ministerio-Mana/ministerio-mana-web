import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let isAllowed = false;
  let isAdmin = false;
  let churchId: string | null = null;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    isAllowed = true;
    isAdmin = true;
  } else {
    const profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    isAdmin = Boolean(profile && isAdminRole(profile.role));
    isAllowed = Boolean(profile && (isAdmin || hasChurchRole));
    churchId = memberships.find((m: any) => m?.church?.id)?.church?.id || profile?.church_id || null;
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  const targetChurch = isAdmin ? (requestedChurch || churchId) : churchId;

  if (!targetChurch) {
    if (isAdmin) {
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
