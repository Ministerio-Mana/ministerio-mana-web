import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export type PortalRole =
  | 'user'
  | 'admin'
  | 'superadmin'
  | 'national_pastor'
  | 'national_collaborator'
  | 'regional_pastor'
  | 'regional_collaborator'
  | 'pastor'
  | 'local_collaborator'
  | 'campus_missionary'
  | 'leader';
export type ChurchRole = 'church_admin' | 'church_member';
export type EffectiveManagementRole =
  | 'superadmin'
  | 'admin'
  | 'national_pastor'
  | 'national_collaborator'
  | 'regional_pastor'
  | 'regional_collaborator'
  | 'pastor'
  | 'local_collaborator';

export type UserProfile = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: PortalRole;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  affiliation_type?: string | null;
  church_name?: string | null;
  church_id?: string | null;
  portal_church_id?: string | null;
  region_id?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type UserMembership = {
  id?: string;
  role?: ChurchRole | string;
  status?: string | null;
  church?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
};

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function parseEmails(raw?: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isSuperadminEmail(email?: string | null): boolean {
  const list = parseEmails(env('PORTAL_SUPERADMIN_EMAILS'));
  if (!email) return false;
  return list.has(email.toLowerCase());
}

export async function ensureUserProfile(user: User): Promise<UserProfile | null> {
  if (!supabaseAdmin) return null;
  const email = user.email?.toLowerCase();
  if (!email) return null;

  const shouldBeSuperadmin = isSuperadminEmail(email);
  const desiredRole: PortalRole = shouldBeSuperadmin ? 'superadmin' : 'user';

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existingError) {
    console.error('[portal.profile] fetch error', existingError);
    return null;
  }

  if (existing) {
    const nextRole: PortalRole | null = shouldBeSuperadmin && existing.role !== 'superadmin'
      ? 'superadmin'
      : (!shouldBeSuperadmin && existing.role === 'superadmin' ? 'user' : null);

    if (nextRole) {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ role: nextRole, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .select('*')
        .single();
      if (error) {
        console.error('[portal.profile] role update error', error);
        return null;
      }
      return data as UserProfile;
    }
    return existing as UserProfile;
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .insert({
      user_id: user.id,
      email,
      full_name: (user.user_metadata as any)?.full_name ?? null,
      role: desiredRole,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    console.error('[portal.profile] upsert error', error);
    return null;
  }

  return data as UserProfile;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[portal.profile] fetch error', error);
    return null;
  }
  return data as UserProfile | null;
}

export async function listUserMemberships(userId: string) {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from('church_memberships')
    .select('id, role, status, church:churches(id, code, name, city, country)')
    .eq('user_id', userId);
  if (error) {
    console.error('[portal.memberships] fetch error', error);
    return [];
  }
  return (data ?? []) as UserMembership[];
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

export function getActiveChurchMembership(memberships: UserMembership[] = []): UserMembership | null {
  const active = memberships.filter((m) =>
    ['church_admin', 'church_member'].includes(String(m?.role || ''))
    && String(m?.status || '').toLowerCase() !== 'pending',
  );
  const adminMembership = active.find((m) => m?.role === 'church_admin');
  if (adminMembership) return adminMembership;
  const memberMembership = active.find((m) => m?.role === 'church_member');
  return memberMembership || null;
}

export function resolveEffectivePortalRole(profileRole?: string | null, memberships: UserMembership[] = []): string {
  const role = String(profileRole || 'user');
  if ([
    'superadmin',
    'admin',
    'national_pastor',
    'national_collaborator',
    'regional_pastor',
    'regional_collaborator',
    'pastor',
    'local_collaborator',
    'leader',
  ].includes(role)) {
    return role;
  }

  const activeMembership = getActiveChurchMembership(memberships);
  if (activeMembership?.role === 'church_admin') return 'pastor';
  if (activeMembership?.role === 'church_member') return 'local_collaborator';

  return role;
}

export function resolveEffectiveChurchId(profileChurchId?: string | null, memberships: UserMembership[] = []): string | null {
  const activeMembership = getActiveChurchMembership(memberships);
  return activeMembership?.church?.id || profileChurchId || null;
}
