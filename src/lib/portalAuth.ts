import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export type PortalRole = 'user' | 'admin' | 'superadmin';
export type ChurchRole = 'church_admin' | 'church_member';

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
  created_at?: string;
  updated_at?: string;
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

  const desiredRole: PortalRole = isSuperadminEmail(email) ? 'superadmin' : 'user';

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
    if (existing.role !== desiredRole) {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ role: desiredRole, updated_at: new Date().toISOString() })
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
  return data ?? [];
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}
