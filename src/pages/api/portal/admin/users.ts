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

export const GET: APIRoute = async ({ request }) => {
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

  const { data: profiles, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, full_name, role, phone, city, country, church_name, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[portal.admin.users] profiles error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const userIds = (profiles || []).map((p: any) => p.user_id);
  let memberships: any[] = [];
  if (userIds.length) {
    const { data } = await supabaseAdmin
      .from('church_memberships')
      .select('user_id, role, status, church:churches(id, name, city, country)')
      .in('user_id', userIds);
    memberships = data ?? [];
  }

  const membershipMap = memberships.reduce((acc: any, row: any) => {
    if (!acc[row.user_id]) acc[row.user_id] = [];
    acc[row.user_id].push({
      role: row.role,
      status: row.status,
      church: row.church,
    });
    return acc;
  }, {});

  const response = (profiles || []).map((profile: any) => ({
    ...profile,
    memberships: membershipMap[profile.user_id] || [],
  }));

  return new Response(JSON.stringify({ ok: true, users: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
