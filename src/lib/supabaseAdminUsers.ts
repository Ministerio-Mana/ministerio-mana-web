import { supabaseAdmin } from './supabaseAdmin';

export async function findAuthUserByEmail(email: string): Promise<{ id: string; email?: string | null } | null> {
  if (!supabaseAdmin) return null;
  const normalized = email.trim().toLowerCase();
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
      console.error('[supabase.admin] listUsers error', error);
      return null;
    }
    const user = data?.users?.find((item) => (item.email || '').toLowerCase() === normalized);
    if (!user?.id) return null;
    return { id: user.id, email: user.email };
  } catch (err) {
    console.error('[supabase.admin] listUsers failed', err);
    return null;
  }
}
