import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export async function getUserFromRequest(request: Request): Promise<User | null> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
