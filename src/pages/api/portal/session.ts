import type { APIRoute } from 'astro';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, resolveEffectivePortalRole, resolveEffectiveChurchId } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { getRoleCapabilities, getRoleScope } from '@lib/portalRbac';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No autorizado',
        debug: {
          hasAuthHeader: !!request.headers.get('authorization'),
          hasToken: !!request.headers.get('authorization')?.startsWith('Bearer '),
          // We can't import supabaseAdmin easily here to check instance without circular deps potentially,
          // but we can check env vars which is the likely root cause.
          envCheck: {
            hasUrl: !!import.meta.env.SUPABASE_URL,
            hasKey: !!(import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE)
          }
        }
      }), {
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
        effective_role: 'superadmin',
        effective_church_id: null,
      },
      memberships: [],
      scope: 'global',
      permissions: getRoleCapabilities('superadmin'),
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
  const effectiveRole = resolveEffectivePortalRole(profile.role, memberships);
  const effectiveChurchId = resolveEffectiveChurchId(profile.church_id || profile.portal_church_id || null, memberships);
  const scope = getRoleScope(effectiveRole);
  const permissions = getRoleCapabilities(effectiveRole);

  return new Response(JSON.stringify({
    ok: true,
    profile: {
      ...profile,
      effective_role: effectiveRole,
      effective_church_id: effectiveChurchId,
    },
    memberships,
    scope,
    permissions,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
