import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function getEnv(name: string): string | undefined {
  return import.meta.env?.[name] ?? undefined;
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;
  const url = getEnv('PUBLIC_SUPABASE_URL') ?? getEnv('SUPABASE_URL');
  const anonKey = getEnv('PUBLIC_SUPABASE_ANON_KEY') ?? getEnv('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Supabase public config missing (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY)');
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
