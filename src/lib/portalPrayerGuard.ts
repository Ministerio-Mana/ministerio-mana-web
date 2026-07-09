import { enforceAdminIp } from '@lib/adminIpAllowlist';
import {
  ensureUserProfile,
  listUserMemberships,
  resolveEffectivePortalRole,
  type UserProfile,
} from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { getSupportedSecondaryRoles, listActivePortalRoleAssignments } from '@lib/portalRoleAssignments';

export type PortalPrayerGuardResult = {
  ok: boolean;
  status: number;
  error: string | null;
  role: string | null;
  profile: UserProfile | null;
  userId: string | null;
  email: string | null;
  isPasswordSession: boolean;
};

const PRAYER_ACCESS_ROLES = new Set(['superadmin', 'admin', 'intercessor']);
const PRAYER_REVIEW_ROLES = new Set(['superadmin', 'admin', 'intercessor']);

export function canAccessPrayerPanel(role?: string | null): boolean {
  return PRAYER_ACCESS_ROLES.has(String(role || ''));
}

export function canReviewPrayerModeration(role?: string | null): boolean {
  return PRAYER_REVIEW_ROLES.has(String(role || ''));
}

async function getPortalPrayerContext(request: Request): Promise<PortalPrayerGuardResult> {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile) {
      return {
        ok: false,
        status: 403,
        error: 'Perfil no encontrado',
        role: null,
        profile: null,
        userId: user.id,
        email: user.email.toLowerCase(),
        isPasswordSession: false,
      };
    }

    const [memberships, roleAssignments] = await Promise.all([
      listUserMemberships(user.id),
      listActivePortalRoleAssignments(user.id),
    ]);
    const effectiveRole = resolveEffectivePortalRole(profile.role, memberships);
    const secondaryRoles = getSupportedSecondaryRoles(roleAssignments);
    const hasSecondaryPrayerAccess = secondaryRoles.includes('intercessor');
    if (!canAccessPrayerPanel(effectiveRole) && !hasSecondaryPrayerAccess) {
      return {
        ok: false,
        status: 403,
        error: 'No autorizado',
        role: effectiveRole,
        profile,
        userId: user.id,
        email: user.email.toLowerCase(),
        isPasswordSession: false,
      };
    }

    return {
      ok: true,
      status: 200,
      error: null,
      role: canAccessPrayerPanel(effectiveRole) ? effectiveRole : 'intercessor',
      profile,
      userId: user.id,
      email: user.email.toLowerCase(),
      isPasswordSession: false,
    };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return {
      ok: false,
      status: 401,
      error: 'No autorizado',
      role: null,
      profile: null,
      userId: null,
      email: null,
      isPasswordSession: false,
    };
  }

  return {
    ok: true,
    status: 200,
    error: null,
    role: 'superadmin',
    profile: null,
    userId: null,
    email: passwordSession.email.toLowerCase(),
    isPasswordSession: true,
  };
}

export async function enforcePortalPrayerGuard(params: {
  request: Request;
  clientAddress?: string | null;
  identifier: string;
}): Promise<PortalPrayerGuardResult> {
  const ctx = await getPortalPrayerContext(params.request);
  if (!ctx.ok) return ctx;

  const ipCheck = await enforceAdminIp({
    request: params.request,
    clientAddress: params.clientAddress || undefined,
    identifier: params.identifier,
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });

  if (!ipCheck.ok) {
    return {
      ok: false,
      status: 403,
      error: 'No autorizado',
      role: ctx.role,
      profile: ctx.profile,
      userId: ctx.userId,
      email: ctx.email,
      isPasswordSession: ctx.isPasswordSession,
    };
  }

  return ctx;
}
