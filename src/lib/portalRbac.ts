import type { PortalRole } from '@lib/portalAuth';

export type PortalScope = 'self' | 'church' | 'region' | 'country' | 'global';
export type EventScope = 'LOCAL' | 'REGIONAL' | 'NATIONAL' | 'GLOBAL';

export type PortalCapabilities = {
  can_manage_users: boolean;
  can_create_users: boolean;
  can_manage_local_events: boolean;
  can_manage_regional_events: boolean;
  can_manage_national_events: boolean;
  can_manage_global_events: boolean;
  can_register_people: boolean;
  can_access_finances: boolean;
  can_access_campus: boolean;
  can_access_prayers: boolean;
};

export const KNOWN_PORTAL_ROLES: PortalRole[] = [
  'user',
  'local_collaborator',
  'pastor',
  'regional_collaborator',
  'regional_pastor',
  'national_collaborator',
  'national_pastor',
  'campus_missionary',
  'intercessor',
  'leader',
  'admin',
  'superadmin',
];

const BASE_USER_CAPABILITIES: PortalCapabilities = {
  can_manage_users: false,
  can_create_users: false,
  can_manage_local_events: false,
  can_manage_regional_events: false,
  can_manage_national_events: false,
  can_manage_global_events: false,
  can_register_people: false,
  can_access_finances: false,
  can_access_campus: false,
  can_access_prayers: false,
};

const ROLE_CAPABILITIES: Record<string, PortalCapabilities> = {
  user: { ...BASE_USER_CAPABILITIES },
  local_collaborator: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: false,
    can_register_people: true,
  },
  pastor: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: true,
    can_manage_local_events: true,
    can_register_people: true,
  },
  regional_collaborator: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: false,
    can_register_people: true,
  },
  regional_pastor: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: true,
    can_manage_local_events: true,
    can_manage_regional_events: true,
    can_register_people: true,
  },
  national_collaborator: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: false,
    can_register_people: true,
  },
  national_pastor: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: true,
    can_manage_local_events: true,
    can_manage_regional_events: true,
    can_manage_national_events: true,
    can_register_people: true,
  },
  campus_missionary: {
    ...BASE_USER_CAPABILITIES,
    can_access_campus: true,
  },
  intercessor: {
    ...BASE_USER_CAPABILITIES,
    can_access_prayers: true,
  },
  leader: {
    ...BASE_USER_CAPABILITIES,
    can_manage_users: true,
    can_create_users: false,
    can_register_people: true,
  },
  admin: {
    can_manage_users: true,
    can_create_users: true,
    can_manage_local_events: true,
    can_manage_regional_events: true,
    can_manage_national_events: true,
    can_manage_global_events: true,
    can_register_people: true,
    can_access_finances: true,
    can_access_campus: true,
    can_access_prayers: true,
  },
  superadmin: {
    can_manage_users: true,
    can_create_users: true,
    can_manage_local_events: true,
    can_manage_regional_events: true,
    can_manage_national_events: true,
    can_manage_global_events: true,
    can_register_people: true,
    can_access_finances: true,
    can_access_campus: true,
    can_access_prayers: true,
  },
};

const ROLE_SCOPE: Record<string, PortalScope> = {
  superadmin: 'global',
  admin: 'global',
  national_pastor: 'country',
  national_collaborator: 'country',
  regional_pastor: 'region',
  regional_collaborator: 'region',
  pastor: 'church',
  local_collaborator: 'church',
  leader: 'church',
  campus_missionary: 'self',
  intercessor: 'global',
  user: 'self',
};

const CREATABLE_BY_ROLE: Record<string, string[]> = {
  superadmin: [
    'superadmin',
    'admin',
    'national_pastor',
    'national_collaborator',
    'regional_pastor',
    'regional_collaborator',
    'campus_missionary',
    'intercessor',
    'pastor',
    'local_collaborator',
    'leader',
    'user',
  ],
  admin: [
    'national_pastor',
    'national_collaborator',
    'regional_pastor',
    'regional_collaborator',
    'campus_missionary',
    'intercessor',
    'pastor',
    'local_collaborator',
    'leader',
    'user',
  ],
  national_pastor: [
    'national_collaborator',
    'regional_pastor',
    'regional_collaborator',
    'pastor',
    'local_collaborator',
    'leader',
    'user',
  ],
  regional_pastor: ['regional_collaborator', 'pastor', 'local_collaborator', 'leader', 'user'],
  pastor: ['local_collaborator', 'leader', 'user'],
};

export function normalizePortalRole(role?: string | null): string {
  return String(role || 'user');
}

export function getRoleCapabilities(role?: string | null): PortalCapabilities {
  return ROLE_CAPABILITIES[normalizePortalRole(role)] || BASE_USER_CAPABILITIES;
}

export function getRoleScope(role?: string | null): PortalScope {
  return ROLE_SCOPE[normalizePortalRole(role)] || 'self';
}

export function getCreatableRoles(creatorRole?: string | null): string[] {
  return CREATABLE_BY_ROLE[normalizePortalRole(creatorRole)] || [];
}

export function canCreateRole(creatorRole?: string | null, targetRole?: string | null): boolean {
  const normalizedTargetRole = normalizePortalRole(targetRole);
  return getCreatableRoles(creatorRole).includes(normalizedTargetRole);
}

export function canManageEventScope(role?: string | null, scope?: string | null): boolean {
  const caps = getRoleCapabilities(role);
  const normalizedScope = String(scope || '').toUpperCase() as EventScope;
  if (normalizedScope === 'GLOBAL') return caps.can_manage_global_events;
  if (normalizedScope === 'NATIONAL') return caps.can_manage_national_events;
  if (normalizedScope === 'REGIONAL') return caps.can_manage_regional_events;
  if (normalizedScope === 'LOCAL') return caps.can_manage_local_events;
  return false;
}

export function canInviteChurchPeople(role?: string | null): boolean {
  const caps = getRoleCapabilities(role);
  return caps.can_register_people;
}

export function isCountryScopedRole(role?: string | null): boolean {
  const normalized = normalizePortalRole(role);
  return ['national_pastor', 'national_collaborator', 'regional_pastor', 'regional_collaborator'].includes(normalized);
}

export function isNationalScopedRole(role?: string | null): boolean {
  const normalized = normalizePortalRole(role);
  return ['national_pastor', 'national_collaborator'].includes(normalized);
}

export function isRegionalScopedRole(role?: string | null): boolean {
  const normalized = normalizePortalRole(role);
  return ['regional_pastor', 'regional_collaborator'].includes(normalized);
}

export function needsCountryForRole(role?: string | null): boolean {
  return isCountryScopedRole(role);
}

export function needsChurchForRole(role?: string | null): boolean {
  const normalized = normalizePortalRole(role);
  return ['pastor', 'local_collaborator', 'leader'].includes(normalized);
}

export function needsRegionForRole(role?: string | null): boolean {
  return isRegionalScopedRole(role);
}
