import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type GetToken = () => Promise<string | null>;

function getEnv(name: string): string | undefined {
  return import.meta.env?.[name] ?? undefined;
}

export function createSupabaseServerClient(getToken: GetToken): SupabaseClient {
  const url = getEnv('PUBLIC_SUPABASE_URL') ?? getEnv('SUPABASE_URL');
  const anonKey = getEnv('PUBLIC_SUPABASE_ANON_KEY') ?? getEnv('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Supabase public config missing (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY)');
  }

  return createClient(url, anonKey, {
    accessToken: async () => (await getToken()) ?? null,
  });
}
