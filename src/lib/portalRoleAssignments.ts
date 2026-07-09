import { supabaseAdmin } from '@lib/supabaseAdmin';

export type PortalRoleAssignment = {
  role: string;
  status?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
};

const SUPPORTED_SECONDARY_ROLES = new Set(['intercessor']);

function isMissingRoleAssignmentsTable(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01'
    || code === '42703'
    || message.includes('portal_role_assignments')
  );
}

export async function listActivePortalRoleAssignments(userId: string): Promise<PortalRoleAssignment[]> {
  if (!supabaseAdmin || !userId) return [];

  const { data, error } = await supabaseAdmin
    .from('portal_role_assignments')
    .select('role, status, scope_type, scope_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    if (isMissingRoleAssignmentsTable(error)) return [];
    console.error('[portal.role-assignments] fetch error', error);
    return [];
  }

  return (data || []) as PortalRoleAssignment[];
}

export function getSupportedSecondaryRoles(assignments: PortalRoleAssignment[] = []): string[] {
  return Array.from(new Set(
    assignments
      .map((assignment) => String(assignment?.role || '').trim())
      .filter((role) => SUPPORTED_SECONDARY_ROLES.has(role)),
  ));
}
