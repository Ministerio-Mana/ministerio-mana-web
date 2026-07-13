import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
  ensureUserProfile,
  listUserMemberships,
  resolveEffectiveChurchId,
  resolveEffectivePortalRole,
} from '@lib/portalAuth';
import {
  canManageEventScope,
  getRoleCapabilities,
  getRoleScope,
  isNationalScopedRole,
  isRegionalScopedRole,
  mergePortalCapabilities,
} from '@lib/portalRbac';
import { getSupportedSecondaryRoles, listActivePortalRoleAssignments } from '@lib/portalRoleAssignments';
import {
  financeScopeCanAccessRecord,
  normalizeFinanceCountryKey,
  resolveFinanceScopeAccess,
  type FinanceScopeAccess,
} from '@lib/financeScope';

export type EventAccessContext = {
  ok: boolean;
  status: number;
  error: string;
  role: string;
  scope: string;
  userId: string | null;
  isAdmin: boolean;
  isPasswordSession: boolean;
  country: string | null;
  churchId: string | null;
  isNational: boolean;
  isRegional: boolean;
  regionIds: string[];
  secondaryRoles: string[];
  financeAccess: FinanceScopeAccess;
  capabilities: ReturnType<typeof getRoleCapabilities>;
};

export type ScopedEvent = {
  id?: string | null;
  scope?: string | null;
  church_id?: string | null;
  region_id?: string | null;
  country?: string | null;
};

function deniedContext(status: number, error: string, userId: string | null = null): EventAccessContext {
  return {
    ok: false,
    status,
    error,
    role: 'user',
    scope: 'self',
    userId,
    isAdmin: false,
    isPasswordSession: false,
    country: null,
    churchId: null,
    isNational: false,
    isRegional: false,
    regionIds: [],
    secondaryRoles: [],
    financeAccess: resolveFinanceScopeAccess({ primaryRole: 'user' }),
    capabilities: getRoleCapabilities('user'),
  };
}

async function resolveRegionalScope(userId: string, profileRegionId?: string | null): Promise<string[]> {
  const fromProfile = profileRegionId ? [profileRegionId] : [];
  if (!supabaseAdmin) return fromProfile;

  const { data, error } = await supabaseAdmin
    .from('region_leadership_assignments')
    .select('region_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    if (error.code !== '42P01' && error.code !== '42703') {
      console.error('[event.access] regional assignments error', error);
    }
    return fromProfile;
  }

  const fromAssignments = (data || [])
    .map((row: any) => String(row?.region_id || '').trim())
    .filter(Boolean);
  return Array.from(new Set([...fromProfile, ...fromAssignments]));
}

export async function isChurchInCountry(churchId: string, country: string | null): Promise<boolean> {
  if (!supabaseAdmin || !churchId || !country) return false;
  const { data: church } = await supabaseAdmin
    .from('churches')
    .select('id, country')
    .eq('id', churchId)
    .maybeSingle();
  return Boolean(church?.id && church.country === country);
}

export async function isChurchInRegions(
  churchId: string,
  regionIds: string[],
  fallbackCountry?: string | null,
): Promise<boolean> {
  if (!supabaseAdmin || !churchId || !regionIds.length) return false;

  const initial = await supabaseAdmin
    .from('churches')
    .select('id, region_id, country')
    .eq('id', churchId)
    .maybeSingle();
  let church: any = initial.data;
  let error = initial.error;

  if (error?.code === '42703') {
    const fallback = await supabaseAdmin
      .from('churches')
      .select('id, country')
      .eq('id', churchId)
      .maybeSingle();
    church = fallback.data;
    error = fallback.error;
  }

  if (error || !church?.id) return false;
  if (church.region_id) return regionIds.includes(church.region_id);
  return Boolean(fallbackCountry && church.country === fallbackCountry);
}

export async function getEventAccessContext(request: Request): Promise<EventAccessContext> {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) return deniedContext(401, 'Unauthorized');
    return {
      ...deniedContext(200, ''),
      ok: true,
      role: 'superadmin',
      scope: 'global',
      isAdmin: true,
      isPasswordSession: true,
      financeAccess: resolveFinanceScopeAccess({ primaryRole: 'superadmin' }),
      capabilities: getRoleCapabilities('superadmin'),
    };
  }

  const profile = await ensureUserProfile(user);
  if (!profile) return deniedContext(403, 'Profile not found', user.id);

  const [memberships, roleAssignments] = await Promise.all([
    listUserMemberships(user.id),
    listActivePortalRoleAssignments(user.id),
  ]);
  const role = resolveEffectivePortalRole(profile.role, memberships);
  const churchId = resolveEffectiveChurchId(
    profile.church_id || profile.portal_church_id || null,
    memberships,
  );
  const isRegional = isRegionalScopedRole(role);
  const isNational = isNationalScopedRole(role);
  const regionIds = isRegional ? await resolveRegionalScope(user.id, profile.region_id || null) : [];
  const financeAccess = resolveFinanceScopeAccess({ primaryRole: role, assignments: roleAssignments });
  const secondaryRoles = getSupportedSecondaryRoles(roleAssignments)
    .filter((secondaryRole) => secondaryRole !== 'finance' || financeAccess.allowed);
  const capabilities = secondaryRoles.length
    ? mergePortalCapabilities([role, ...secondaryRoles])
    : getRoleCapabilities(role);

  if (isRegional && !regionIds.length) {
    return {
      ...deniedContext(403, 'Sin región asignada', user.id),
      role,
      scope: getRoleScope(role),
      country: profile.country || null,
      churchId,
      isNational,
      isRegional,
      secondaryRoles,
      financeAccess,
      capabilities,
    };
  }

  return {
    ok: true,
    status: 200,
    error: '',
    role,
    scope: getRoleScope(role),
    userId: user.id,
    isAdmin: role === 'admin' || role === 'superadmin',
    isPasswordSession: false,
    country: profile.country || null,
    churchId,
    isNational,
    isRegional,
    regionIds,
    secondaryRoles,
    financeAccess,
    capabilities,
  };
}

async function canFinanceAccessEvent(
  access: FinanceScopeAccess,
  event: ScopedEvent,
): Promise<boolean> {
  const scopeType = String(event?.scope || '').trim().toUpperCase();
  const record = {
    finance_scope_type: scopeType,
    finance_scope_country_key: normalizeFinanceCountryKey(event?.country),
    finance_region_id: event?.region_id || null,
    church_id: event?.church_id || null,
  };
  if (financeScopeCanAccessRecord(access, record)) return true;

  if (!supabaseAdmin || scopeType !== 'LOCAL' || !event?.church_id) return false;
  const { data: church, error } = await supabaseAdmin
    .from('churches')
    .select('id, region_id, country')
    .eq('id', event.church_id)
    .maybeSingle();
  if (error || !church?.id) return false;

  return financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: normalizeFinanceCountryKey(church.country),
    finance_region_id: church.region_id || null,
    church_id: church.id,
  });
}

export async function canActorManageEvent(ctx: EventAccessContext, event: ScopedEvent): Promise<boolean> {
  if (!ctx.ok || !event?.scope) return false;
  if (ctx.isAdmin) return true;
  if (!canManageEventScope(ctx.role, event.scope)) return false;

  const scope = String(event.scope).toUpperCase();
  if (scope === 'GLOBAL') return false;
  if (scope === 'NATIONAL') return Boolean(ctx.isNational && ctx.country && event.country === ctx.country);
  if (scope === 'REGIONAL') {
    if (ctx.isRegional) return Boolean(event.region_id && ctx.regionIds.includes(event.region_id));
    return Boolean(ctx.isNational && ctx.country && event.country === ctx.country);
  }
  if (scope !== 'LOCAL' || !event.church_id) return false;
  if (ctx.churchId && event.church_id === ctx.churchId) return true;
  if (ctx.isRegional) return isChurchInRegions(event.church_id, ctx.regionIds, ctx.country);
  if (ctx.isNational) return isChurchInCountry(event.church_id, ctx.country);
  return false;
}

export async function canActorOperateEventPayments(
  ctx: EventAccessContext,
  event: ScopedEvent,
): Promise<boolean> {
  if (!ctx.ok || ctx.isPasswordSession) return false;
  if (!ctx.capabilities.can_manage_event_finances) return false;
  if (ctx.isAdmin) return true;
  if (ctx.financeAccess.allowed && await canFinanceAccessEvent(ctx.financeAccess, event)) return true;
  return canActorManageEvent(ctx, event);
}

export function canActorApproveEventPayments(ctx: EventAccessContext): boolean {
  return ctx.ok && !ctx.isPasswordSession && ctx.capabilities.can_approve_event_payments;
}
