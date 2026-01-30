import type { APIRoute } from 'astro';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      mode: 'password',
      profile: {
        user_id: 'password-session',
        email: passwordSession.email,
        full_name: passwordSession.email.split('@')[0],
        role: 'superadmin',
      },
      memberships: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const profile = await ensureUserProfile(user);
  if (!profile) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear perfil' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const memberships = await listUserMemberships(user.id);

  return new Response(JSON.stringify({
    ok: true,
    profile,
    memberships,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
