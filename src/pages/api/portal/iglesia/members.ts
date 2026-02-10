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
  let isNational = false;
  let churchId: string | null = null;
  let country: string | null = null;
  let profile: any = null;

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
    profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const activeMembership = memberships.find((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    const hasChurchRole = Boolean(activeMembership);
    const role = profile?.role || 'user';
    const allowedRoles = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator', 'church_admin'];
    if (!allowedRoles.includes(role) && !hasChurchRole) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    isAdmin = Boolean(profile && isAdminRole(role));
    if (role === 'national_pastor') {
      isNational = true;
      country = profile?.country || null;
      if (!country) {
        return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    isAllowed = Boolean(profile && (isAdmin || isNational || hasChurchRole || role === 'pastor' || role === 'local_collaborator'));
    churchId = profile?.church_id || activeMembership?.church?.id || null;
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  let targetChurch = isAdmin ? (requestedChurch || churchId) : churchId;

  if (isNational) {
    if (!requestedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { data: church } = await supabaseAdmin
      .from('churches')
      .select('id, country')
      .eq('id', requestedChurch)
      .maybeSingle();
    if (!church?.id || church.country !== country) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    targetChurch = requestedChurch;
  }

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
