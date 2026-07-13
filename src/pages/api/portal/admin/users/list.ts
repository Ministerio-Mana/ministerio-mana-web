import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import {
  getPortalChurchAccessContext,
  mapPortalAccessError,
  type PortalChurchRole,
} from '@lib/portalAccess';
import { listAccessibleChurchIds } from '@lib/portalScope';
import { getRoleCapabilities } from '@lib/portalRbac';

const MANAGEMENT_ALLOWED_ROLES: PortalChurchRole[] = [
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

const PROFILE_SELECT = 'user_id, first_name, last_name, full_name, email, role, campus_missionary_slug, church_id, portal_church_id, region_id, church_name, city, country, created_at, updated_at';

const FETCH_LIMIT = 400;
const RESPONSE_LIMIT = 200;

type ProfileRow = Record<string, any>;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function parseUpdatedAt(value: unknown): number {
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFutureTimestamp(value: unknown, now: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > now;
}

function isMissingRoleAssignmentsSchema(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === '42703' || message.includes('portal_role_assignments');
}

function dedupeProfiles(rows: ProfileRow[]): ProfileRow[] {
  const byUserId = new Map<string, ProfileRow>();
  for (const row of rows) {
    const userId = String(row?.user_id || '').trim();
    if (!userId) continue;
    const current = byUserId.get(userId);
    if (!current) {
      byUserId.set(userId, row);
      continue;
    }
    if (parseUpdatedAt(row?.updated_at) >= parseUpdatedAt(current?.updated_at)) {
      byUserId.set(userId, row);
    }
  }
  return Array.from(byUserId.values());
}

function sortProfilesByUpdatedAt(rows: ProfileRow[]): ProfileRow[] {
  return [...rows].sort((left, right) => parseUpdatedAt(right?.updated_at) - parseUpdatedAt(left?.updated_at));
}

async function fetchProfiles(
  applyScope: (query: any) => any,
  options: { ignoreErrorCodes?: string[] } = {},
): Promise<ProfileRow[]> {
  if (!supabaseAdmin) return [];

  let query = supabaseAdmin
    .from('user_profiles')
    .select(PROFILE_SELECT)
    .order('updated_at', { ascending: false });

  query = applyScope(query) || query;

  const { data, error } = await query.limit(FETCH_LIMIT);

  if (error) {
    if ((options.ignoreErrorCodes || []).includes(String(error.code || ''))) {
      return [];
    }
    throw new Error(error.message || 'Error consultando user_profiles');
  }

  return (data || []) as ProfileRow[];
}

async function fetchProfilesByChurchIds(churchIds: string[]): Promise<ProfileRow[]> {
  const uniqueIds = Array.from(new Set(churchIds.filter(Boolean)));
  if (!uniqueIds.length) return [];

  const rows: ProfileRow[] = [];
  const chunks = chunkArray(uniqueIds, 120);

  for (const ids of chunks) {
    const byChurch = await fetchProfiles((query) => query.in('church_id', ids));
    rows.push(...byChurch);
  }

  return dedupeProfiles(rows);
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
  }

  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: MANAGEMENT_ALLOWED_ROLES,
    allowPasswordSession: false,
  });

  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'No autorizado para gestionar usuarios');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const effectiveRole = String(access.role || 'user');
  const capabilities = getRoleCapabilities(effectiveRole);
  if (!capabilities.can_manage_users) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.users.list',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  let scopedUsers: ProfileRow[] = [];

  try {
    if (effectiveRole === 'superadmin') {
      scopedUsers = await fetchProfiles((query) => query);
    } else if (effectiveRole === 'admin') {
      scopedUsers = await fetchProfiles((query) => query.neq('role', 'superadmin'));
    } else if (access.allowedChurchId) {
      scopedUsers = await fetchProfilesByChurchIds([access.allowedChurchId]);
    } else if (access.isRegional) {
      const scopedChurchIds = await listAccessibleChurchIds(access);
      const byChurch = await fetchProfilesByChurchIds(scopedChurchIds);
      const byRegion = access.allowedRegionIds.length
        ? await fetchProfiles(
            (query) => query.in('region_id', access.allowedRegionIds),
            { ignoreErrorCodes: ['42703'] },
          )
        : [];

      scopedUsers = dedupeProfiles([...byRegion, ...byChurch]);
    } else if (access.isNational) {
      if (!access.allowedCountry) {
        return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
      }

      const scopedChurchIds = await listAccessibleChurchIds(access);
      const byCountry = await fetchProfiles((query) => query.eq('country', access.allowedCountry));
      const byChurch = await fetchProfilesByChurchIds(scopedChurchIds);
      scopedUsers = dedupeProfiles([...byCountry, ...byChurch]);
    } else {
      scopedUsers = [];
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'Error interno' }), { status: 500 });
  }

  const users = sortProfilesByUpdatedAt(scopedUsers).slice(0, RESPONSE_LIMIT);
  const visibleUserIds = users.map((profile: any) => profile?.user_id).filter(Boolean);
  const financeAssignmentMap = new Map<string, any[]>();

  if (visibleUserIds.length && effectiveRole === 'superadmin') {
    const { data: assignments, error: assignmentsError } = await supabaseAdmin
      .from('portal_role_assignments')
      .select('id,user_id,scope_type,scope_id,scope_key,status')
      .in('user_id', visibleUserIds)
      .eq('role', 'finance')
      .eq('status', 'active');
    if (assignmentsError) {
      if (!isMissingRoleAssignmentsSchema(assignmentsError)) {
        console.error('[portal.admin.users.list] finance assignments error', assignmentsError);
      }
    } else {
      (assignments || []).forEach((assignment: any) => {
        const rows = financeAssignmentMap.get(assignment.user_id) || [];
        rows.push({
          id: assignment.id,
          scope_type: assignment.scope_type,
          scope_id: assignment.scope_id,
          scope_key: assignment.scope_key,
        });
        financeAssignmentMap.set(assignment.user_id, rows);
      });
    }
  }

  const churchIds = Array.from(new Set((users || [])
    .map((profile: any) => profile?.church_id || profile?.portal_church_id || null)
    .filter(Boolean)));

  const churchMap = new Map<string, any>();
  const regionMap = new Map<string, any>();

  if (churchIds.length) {
    const { data: churches, error: churchesError } = await supabaseAdmin
      .from('churches')
      .select('id, name, city, country, region_id')
      .in('id', churchIds);

    if (churchesError) {
      console.error('[portal.admin.users.list] churches error', churchesError);
    } else {
      (churches || []).forEach((church: any) => {
        if (!church?.id) return;
        churchMap.set(church.id, church);
      });
    }
  }

  const regionIds = Array.from(new Set((users || [])
    .map((profile: any) => {
      const resolvedChurchId = profile?.church_id || profile?.portal_church_id || null;
      const church = resolvedChurchId ? churchMap.get(resolvedChurchId) : null;
      return profile?.region_id || church?.region_id || null;
    })
    .filter(Boolean)));

  if (regionIds.length) {
    const { data: regions, error: regionsError } = await supabaseAdmin
      .from('regions')
      .select('id, country, code, name, is_active')
      .in('id', regionIds);

    if (regionsError) {
      if (regionsError.code !== '42P01') {
        console.error('[portal.admin.users.list] regions error', regionsError);
      }
    } else {
      (regions || []).forEach((region: any) => {
        if (!region?.id) return;
        regionMap.set(region.id, region);
      });
    }
  }

  const authUsersByEmail = new Map<string, any>();
  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (authError) {
      console.error('[portal.admin.users.list] auth list error', authError);
      break;
    }
    const authUsers = authData?.users || [];
    authUsers.forEach((authUser: any) => {
      const email = String(authUser?.email || '').toLowerCase();
      if (!email) return;
      authUsersByEmail.set(email, authUser);
    });
    if (authUsers.length < perPage) break;
    page += 1;
  }

  const now = Date.now();
  const enrichedUsers = (users || []).map((profile: any) => {
    const email = String(profile?.email || '').toLowerCase();
    const authUser = authUsersByEmail.get(email);
    const metadata = authUser?.user_metadata || {};
    const invitedAt = authUser?.invited_at || null;
    const emailConfirmedAt = authUser?.email_confirmed_at || null;
    const lastSignInAt = authUser?.last_sign_in_at || null;
    const bannedUntil = authUser?.banned_until || null;
    const isBlocked = isFutureTimestamp(bannedUntil, now);
    const accountDeletedAt = metadata?.account_deleted_at || null;
    const accountDeletedBy = metadata?.account_deleted_by || null;
    const accountDeleteReason = metadata?.account_delete_reason || null;
    const isAccountDeleted = Boolean(accountDeletedAt && accountDeletedBy === 'self_service');

    let accessStatus = 'pending';
    if (isAccountDeleted) {
      accessStatus = 'deleted';
    } else if (isBlocked) {
      accessStatus = 'blocked';
    } else if (!authUser) {
      accessStatus = 'unknown';
    } else if (!emailConfirmedAt && invitedAt) {
      accessStatus = 'invited';
    } else if (!emailConfirmedAt) {
      accessStatus = 'pending';
    } else if (lastSignInAt) {
      accessStatus = 'active';
    } else {
      accessStatus = 'confirmed';
    }

    const resolvedChurchId = profile?.church_id || profile?.portal_church_id || null;
    const resolvedChurch = resolvedChurchId ? (churchMap.get(resolvedChurchId) || null) : null;
    const resolvedRegionId = profile?.region_id || resolvedChurch?.region_id || null;

    return {
      ...profile,
      church: resolvedChurch,
      region: resolvedRegionId ? (regionMap.get(resolvedRegionId) || null) : null,
      full_name: profile?.full_name
        || authUser?.user_metadata?.full_name
        || [authUser?.user_metadata?.first_name, authUser?.user_metadata?.last_name].filter(Boolean).join(' ')
        || null,
      access_status: accessStatus,
      invited_at: invitedAt,
      email_confirmed_at: emailConfirmedAt,
      last_sign_in_at: lastSignInAt,
      is_blocked: isBlocked,
      is_account_deleted: isAccountDeleted,
      account_deleted_at: accountDeletedAt,
      account_deleted_by: accountDeletedBy,
      account_delete_reason: accountDeleteReason,
      finance_assignments: financeAssignmentMap.get(profile.user_id) || [],
      finance_assignment_count: (financeAssignmentMap.get(profile.user_id) || []).length,
    };
  });

  return new Response(JSON.stringify({ ok: true, users: enrichedUsers }), { status: 200 });
};
