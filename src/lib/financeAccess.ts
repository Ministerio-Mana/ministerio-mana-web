import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
  ensureUserProfile,
  listUserMemberships,
  resolveEffectivePortalRole,
} from '@lib/portalAuth';
import { getRoleCapabilities, mergePortalCapabilities } from '@lib/portalRbac';
import {
  getSupportedSecondaryRoles,
  listActivePortalRoleAssignments,
  type PortalRoleAssignment,
} from '@lib/portalRoleAssignments';
import {
  buildFinanceScopeFilter,
  resolveFinanceScopeAccess,
  type FinanceScopeAccess,
} from '@lib/financeScope';

export type FinanceAccessContext = {
  ok: boolean;
  status: number;
  error: string;
  userId: string | null;
  role: string;
  isPasswordSession: boolean;
  assignments: PortalRoleAssignment[];
  access: FinanceScopeAccess;
};

function denied(status: number, error: string): FinanceAccessContext {
  return {
    ok: false,
    status,
    error,
    userId: null,
    role: 'user',
    isPasswordSession: false,
    assignments: [],
    access: resolveFinanceScopeAccess({ primaryRole: 'user' }),
  };
}

export async function getFinanceAccessContext(request: Request): Promise<FinanceAccessContext> {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) return denied(401, 'Unauthorized');
    return {
      ok: true,
      status: 200,
      error: '',
      userId: null,
      role: 'superadmin',
      isPasswordSession: true,
      assignments: [],
      access: resolveFinanceScopeAccess({ primaryRole: 'superadmin' }),
    };
  }

  const [profile, memberships, assignments] = await Promise.all([
    ensureUserProfile(user),
    listUserMemberships(user.id),
    listActivePortalRoleAssignments(user.id),
  ]);
  if (!profile) return { ...denied(403, 'Profile not found'), userId: user.id };

  const role = resolveEffectivePortalRole(profile.role, memberships);
  const access = resolveFinanceScopeAccess({ primaryRole: role, assignments });
  const secondaryRoles = getSupportedSecondaryRoles(assignments)
    .filter((secondaryRole) => secondaryRole !== 'finance' || access.allowed);
  const capabilities = secondaryRoles.length
    ? mergePortalCapabilities([role, ...secondaryRoles])
    : getRoleCapabilities(role);

  if (!capabilities.can_access_finances || !access.allowed) {
    return {
      ...denied(access.hasInvalidAssignments ? 503 : 403, access.hasInvalidAssignments
        ? 'Financial scope configuration is incomplete'
        : 'Forbidden'),
      userId: user.id,
      role,
      assignments,
      access,
    };
  }

  return {
    ok: true,
    status: 200,
    error: '',
    userId: user.id,
    role,
    isPasswordSession: false,
    assignments,
    access,
  };
}

export function applyFinanceScopeFilter<T>(query: T, access: FinanceScopeAccess): T {
  const filter = buildFinanceScopeFilter(access);
  if (!filter) return query;
  return (query as any).or(filter) as T;
}
