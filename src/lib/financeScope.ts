export type FinanceAssignmentScope = 'global' | 'country' | 'region' | 'church';

export type FinanceRoleAssignment = {
  role?: string | null;
  status?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
  scope_key?: string | null;
};

export type FinanceScopeAccess = {
  allowed: boolean;
  isGlobal: boolean;
  source: 'admin' | 'legacy-finance' | 'assignments' | 'none';
  countryKeys: string[];
  regionIds: string[];
  churchIds: string[];
  hasAssignments: boolean;
  hasInvalidAssignments: boolean;
};

export type FinanceScopedRecord = {
  finance_scope_type?: string | null;
  finance_scope_country_key?: string | null;
  finance_region_id?: string | null;
  church_id?: string | null;
};

const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function normalizeFinanceCountryKey(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isFinanceUuid(value?: string | null): boolean {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function resolveFinanceScopeAccess(params: {
  primaryRole?: string | null;
  assignments?: FinanceRoleAssignment[];
}): FinanceScopeAccess {
  const primaryRole = String(params.primaryRole || 'user').trim().toLowerCase();
  const assignments = (params.assignments || []).filter((assignment) => (
    String(assignment?.role || '').trim().toLowerCase() === 'finance'
    && String(assignment?.status || 'active').trim().toLowerCase() === 'active'
  ));

  if (ADMIN_ROLES.has(primaryRole)) {
    return {
      allowed: true,
      isGlobal: true,
      source: 'admin',
      countryKeys: [],
      regionIds: [],
      churchIds: [],
      hasAssignments: assignments.length > 0,
      hasInvalidAssignments: false,
    };
  }

  const countryKeys: string[] = [];
  const regionIds: string[] = [];
  const churchIds: string[] = [];
  let isGlobal = false;
  let invalidCount = 0;

  assignments.forEach((assignment) => {
    const scopeType = String(assignment?.scope_type || '').trim().toLowerCase() as FinanceAssignmentScope;
    const scopeId = String(assignment?.scope_id || '').trim();
    const scopeKey = normalizeFinanceCountryKey(assignment?.scope_key);

    if (scopeType === 'global' && !scopeId && !scopeKey) {
      isGlobal = true;
      return;
    }
    if (scopeType === 'country' && !scopeId && scopeKey) {
      countryKeys.push(scopeKey);
      return;
    }
    if (scopeType === 'region' && isFinanceUuid(scopeId)) {
      regionIds.push(scopeId.toLowerCase());
      return;
    }
    if (scopeType === 'church' && isFinanceUuid(scopeId)) {
      churchIds.push(scopeId.toLowerCase());
      return;
    }
    invalidCount += 1;
  });

  const hasAssignments = assignments.length > 0;
  if (!hasAssignments && primaryRole === 'finance') {
    return {
      allowed: true,
      isGlobal: true,
      source: 'legacy-finance',
      countryKeys: [],
      regionIds: [],
      churchIds: [],
      hasAssignments: false,
      hasInvalidAssignments: false,
    };
  }

  const normalizedCountries = unique(countryKeys);
  const normalizedRegions = unique(regionIds);
  const normalizedChurches = unique(churchIds);
  const allowed = isGlobal
    || normalizedCountries.length > 0
    || normalizedRegions.length > 0
    || normalizedChurches.length > 0;

  return {
    allowed,
    isGlobal,
    source: allowed ? 'assignments' : 'none',
    countryKeys: normalizedCountries,
    regionIds: normalizedRegions,
    churchIds: normalizedChurches,
    hasAssignments,
    hasInvalidAssignments: invalidCount > 0,
  };
}

export function buildFinanceScopeFilter(access: FinanceScopeAccess): string | null {
  if (!access.allowed) return 'id.eq.00000000-0000-0000-0000-000000000000';
  if (access.isGlobal) return null;

  const clauses = [
    ...access.countryKeys.map((countryKey) => (
      `and(finance_scope_type.in.(NATIONAL,REGIONAL,LOCAL),finance_scope_country_key.eq.${countryKey})`
    )),
    ...access.regionIds.map((regionId) => (
      `and(finance_scope_type.in.(REGIONAL,LOCAL),finance_region_id.eq.${regionId})`
    )),
    ...access.churchIds.map((churchId) => (
      `and(finance_scope_type.eq.LOCAL,church_id.eq.${churchId})`
    )),
  ];

  return clauses.length
    ? clauses.join(',')
    : 'id.eq.00000000-0000-0000-0000-000000000000';
}

export function financeScopeCanAccessRecord(
  access: FinanceScopeAccess,
  record: FinanceScopedRecord,
): boolean {
  if (!access.allowed) return false;
  if (access.isGlobal) return true;

  const scopeType = String(record?.finance_scope_type || '').trim().toUpperCase();
  const countryKey = normalizeFinanceCountryKey(record?.finance_scope_country_key);
  const regionId = String(record?.finance_region_id || '').trim().toLowerCase();
  const churchId = String(record?.church_id || '').trim().toLowerCase();

  if (
    ['NATIONAL', 'REGIONAL', 'LOCAL'].includes(scopeType)
    && countryKey
    && access.countryKeys.includes(countryKey)
  ) return true;

  if (
    ['REGIONAL', 'LOCAL'].includes(scopeType)
    && regionId
    && access.regionIds.includes(regionId)
  ) return true;

  return scopeType === 'LOCAL' && Boolean(churchId && access.churchIds.includes(churchId));
}

export function serializeFinanceScopeAccess(access: FinanceScopeAccess) {
  return {
    allowed: access.allowed,
    is_global: access.isGlobal,
    source: access.source,
    country_keys: access.countryKeys,
    region_ids: access.regionIds,
    church_ids: access.churchIds,
    configuration_warning: access.hasInvalidAssignments,
  };
}
