import { supabaseAdmin } from './supabaseAdmin';

export async function findAuthUserByEmail(email: string): Promise<{ id: string; email?: string | null } | null> {
  if (!supabaseAdmin) return null;
  const normalized = email.trim().toLowerCase();
  try {
    const perPage = 1000;
    const maxPages = 25;
    for (let page = 1; page <= maxPages; page += 1) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error('[supabase.admin] listUsers error', error);
        throw error;
      }
      const users = data?.users ?? [];
      const user = users.find((item) => (item.email || '').toLowerCase() === normalized);
      if (user?.id) return { id: user.id, email: user.email };
      if (users.length < perPage) return null;
    }
    throw new Error('Auth user lookup exceeded pagination limit');
  } catch (err) {
    console.error('[supabase.admin] listUsers failed', err);
    throw err;
  }
}
