import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  ensureUserProfile,
  listUserMemberships,
  resolveEffectivePortalRole,
  resolveEffectiveChurchId,
  type UserMembership,
  type UserProfile,
} from '@lib/portalAuth';

export type PortalChurchRole =
  | 'superadmin'
  | 'admin'
  | 'national_pastor'
  | 'national_collaborator'
  | 'regional_pastor'
  | 'regional_collaborator'
  | 'pastor'
  | 'local_collaborator'
  | 'leader';

export type PortalChurchAccessReason =
  | 'OK'
  | 'UNAUTHORIZED'
  | 'PROFILE_NOT_FOUND'
  | 'ROLE_NOT_ALLOWED'
  | 'MISSING_COUNTRY_SCOPE'
  | 'MISSING_REGION_SCOPE'
  | 'MISSING_CHURCH_SCOPE';

export type PortalChurchAccessContext = {
  ok: boolean;
  reason: PortalChurchAccessReason;
  role: string | null;
  isAdmin: boolean;
  isNational: boolean;
  isRegional: boolean;
  allowedChurchId: string | null;
  allowedCountry: string | null;
  allowedRegionIds: string[];
  profile: UserProfile | null;
  memberships: UserMembership[];
  userId: string | null;
  email: string | null;
  isPasswordSession: boolean;
};

const DEFAULT_ALLOWED_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
  'national_pastor',
  'national_collaborator',
  'regional_pastor',
  'regional_collaborator',
  'pastor',
  'local_collaborator',
  'leader',
];

type AccessOptions = {
  allowedRoles?: PortalChurchRole[];
  allowPasswordSession?: boolean;
};

function isAllowedRole(role: string | null | undefined, allowedRoles: PortalChurchRole[]): role is PortalChurchRole {
  if (!role) return false;
  return allowedRoles.includes(role as PortalChurchRole);
}

export function mapPortalAccessError(
  reason: PortalChurchAccessReason,
  roleNotAllowedMessage = 'No autorizado',
): { status: number; error: string } {
  switch (reason) {
    case 'UNAUTHORIZED':
      return { status: 401, error: 'No autorizado' };
    case 'PROFILE_NOT_FOUND':
      return { status: 403, error: 'Perfil no encontrado' };
    case 'ROLE_NOT_ALLOWED':
      return { status: 403, error: roleNotAllowedMessage };
    case 'MISSING_COUNTRY_SCOPE':
      return { status: 403, error: 'Sin país asignado' };
    case 'MISSING_REGION_SCOPE':
      return { status: 403, error: 'Sin región asignada' };
    case 'MISSING_CHURCH_SCOPE':
      return { status: 403, error: 'Sin iglesia asignada' };
    default:
      return { status: 403, error: 'No autorizado' };
  }
}

async function resolveRegionalScope(userId: string, role: string, profileRegionId: string | null | undefined) {
  const fromProfile = profileRegionId ? [profileRegionId] : [];
  if (!supabaseAdmin) return fromProfile;

  const { data, error } = await supabaseAdmin
    .from('region_leadership_assignments')
    .select('region_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return fromProfile;
    }
    console.error('[portal.access] regional assignments error', error);
    return fromProfile;
  }

  const roleAllowed = new Set(['regional_pastor', 'regional_collaborator', role]);
  const fromAssignments = (data || [])
    .filter((row: any) => roleAllowed.has(String(row?.role || '')))
    .map((row: any) => String(row?.region_id || '').trim())
    .filter(Boolean);

  return Array.from(new Set([...fromProfile, ...fromAssignments]));
}

export async function getPortalChurchAccessContext(
  request: Request,
  options: AccessOptions = {},
): Promise<PortalChurchAccessContext> {
  const allowedRoles = options.allowedRoles ?? DEFAULT_ALLOWED_ROLES;
  const allowPasswordSession = options.allowPasswordSession ?? true;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!allowPasswordSession || !passwordSession?.email) {
      return {
        ok: false,
        reason: 'UNAUTHORIZED',
        role: null,
        isAdmin: false,
        isNational: false,
        isRegional: false,
        allowedChurchId: null,
        allowedCountry: null,
        allowedRegionIds: [],
        profile: null,
        memberships: [],
        userId: null,
        email: null,
        isPasswordSession: false,
      };
    }

    return {
      ok: true,
      reason: 'OK',
      role: 'superadmin',
      isAdmin: true,
      isNational: false,
      isRegional: false,
      allowedChurchId: null,
      allowedCountry: null,
      allowedRegionIds: [],
      profile: null,
      memberships: [],
      userId: null,
      email: passwordSession.email.toLowerCase(),
      isPasswordSession: true,
    };
  }

  const profile = await ensureUserProfile(user);
  if (!profile) {
    return {
      ok: false,
      reason: 'PROFILE_NOT_FOUND',
      role: null,
      isAdmin: false,
      isNational: false,
      isRegional: false,
      allowedChurchId: null,
      allowedCountry: null,
      allowedRegionIds: [],
      profile: null,
      memberships: [],
      userId: user.id,
      email: user.email?.toLowerCase() || null,
      isPasswordSession: false,
    };
  }

  const memberships = await listUserMemberships(user.id);
  const effectiveRole = resolveEffectivePortalRole(profile.role, memberships);
  const effectiveChurchId = resolveEffectiveChurchId(
    profile.church_id || profile.portal_church_id || null,
    memberships,
  );
  const country = profile.country || null;

  if (!isAllowedRole(effectiveRole, allowedRoles)) {
    return {
      ok: false,
      reason: 'ROLE_NOT_ALLOWED',
      role: effectiveRole,
      isAdmin: false,
      isNational: false,
      isRegional: false,
      allowedChurchId: null,
      allowedCountry: null,
      allowedRegionIds: [],
      profile,
      memberships,
      userId: user.id,
      email: user.email?.toLowerCase() || null,
      isPasswordSession: false,
    };
  }

  if (['national_pastor', 'national_collaborator'].includes(effectiveRole)) {
    if (!country) {
      return {
        ok: false,
        reason: 'MISSING_COUNTRY_SCOPE',
        role: effectiveRole,
        isAdmin: false,
        isNational: true,
        isRegional: false,
        allowedChurchId: null,
        allowedCountry: null,
        allowedRegionIds: [],
        profile,
        memberships,
        userId: user.id,
        email: user.email?.toLowerCase() || null,
        isPasswordSession: false,
      };
    }
    return {
      ok: true,
      reason: 'OK',
      role: effectiveRole,
      isAdmin: false,
      isNational: true,
      isRegional: false,
      allowedChurchId: null,
      allowedCountry: country,
      allowedRegionIds: [],
      profile,
      memberships,
      userId: user.id,
      email: user.email?.toLowerCase() || null,
      isPasswordSession: false,
    };
  }

  if (['regional_pastor', 'regional_collaborator'].includes(effectiveRole)) {
    const regionIds = await resolveRegionalScope(user.id, effectiveRole, profile.region_id || null);
    if (!regionIds.length) {
      return {
        ok: false,
        reason: 'MISSING_REGION_SCOPE',
        role: effectiveRole,
        isAdmin: false,
        isNational: false,
        isRegional: true,
        allowedChurchId: null,
        allowedCountry: country,
        allowedRegionIds: [],
        profile,
        memberships,
        userId: user.id,
        email: user.email?.toLowerCase() || null,
        isPasswordSession: false,
      };
    }
    return {
      ok: true,
      reason: 'OK',
      role: effectiveRole,
      isAdmin: false,
      isNational: false,
      isRegional: true,
      allowedChurchId: null,
      allowedCountry: country,
      allowedRegionIds: regionIds,
      profile,
      memberships,
      userId: user.id,
      email: user.email?.toLowerCase() || null,
      isPasswordSession: false,
    };
  }

  if (effectiveRole === 'pastor' || effectiveRole === 'local_collaborator' || effectiveRole === 'leader') {
    if (!effectiveChurchId) {
      return {
        ok: false,
        reason: 'MISSING_CHURCH_SCOPE',
        role: effectiveRole,
        isAdmin: false,
        isNational: false,
        isRegional: false,
        allowedChurchId: null,
        allowedCountry: null,
        allowedRegionIds: [],
        profile,
        memberships,
        userId: user.id,
        email: user.email?.toLowerCase() || null,
        isPasswordSession: false,
      };
    }
    return {
      ok: true,
      reason: 'OK',
      role: effectiveRole,
      isAdmin: false,
      isNational: false,
      isRegional: false,
      allowedChurchId: effectiveChurchId,
      allowedCountry: null,
      allowedRegionIds: [],
      profile,
      memberships,
      userId: user.id,
      email: user.email?.toLowerCase() || null,
      isPasswordSession: false,
    };
  }

  return {
    ok: true,
    reason: 'OK',
    role: effectiveRole,
    isAdmin: effectiveRole === 'superadmin' || effectiveRole === 'admin',
    isNational: false,
    isRegional: false,
    allowedChurchId: null,
    allowedCountry: null,
    allowedRegionIds: [],
    profile,
    memberships,
    userId: user.id,
    email: user.email?.toLowerCase() || null,
    isPasswordSession: false,
  };
}
