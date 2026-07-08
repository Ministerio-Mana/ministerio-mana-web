import type { APIRoute } from 'astro';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, resolveEffectivePortalRole, resolveEffectiveChurchId } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { getCreatableRoles, getRoleCapabilities, getRoleScope } from '@lib/portalRbac';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

async function resolveAllowedRegionIds(
  userId: string,
  effectiveRole: string,
  profileRegionId?: string | null,
): Promise<string[]> {
  const base = profileRegionId ? [profileRegionId] : [];
  if (!['regional_pastor', 'regional_collaborator'].includes(effectiveRole)) {
    return base;
  }
  if (!supabaseAdmin) return base;

  const { data, error } = await supabaseAdmin
    .from('region_leadership_assignments')
    .select('region_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return base;
    }
    console.error('[portal.session] regional assignments error', error);
    return base;
  }

  const roleAllowed = new Set(['regional_pastor', 'regional_collaborator']);
  const fromAssignments = (data || [])
    .filter((row: any) => roleAllowed.has(String(row?.role || '')))
    .map((row: any) => String(row?.region_id || '').trim())
    .filter(Boolean);

  return Array.from(new Set([...base, ...fromAssignments]));
}

export const GET: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No autorizado',
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
      creatable_roles: getCreatableRoles('superadmin'),
      scope_context: {
        allowed_country: null,
        allowed_region_ids: [],
        allowed_church_id: null,
      },
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
  const allowedRegionIds = await resolveAllowedRegionIds(user.id, effectiveRole, profile.region_id || null);

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
    creatable_roles: getCreatableRoles(effectiveRole),
    scope_context: {
      allowed_country: profile.country || null,
      allowed_region_ids: allowedRegionIds,
      allowed_church_id: effectiveChurchId,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
