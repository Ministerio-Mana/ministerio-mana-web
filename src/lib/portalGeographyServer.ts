import { findPortalCountry } from './portalGeography.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';

export type PortalCountryResolution =
  | { ok: true; country: string | null }
  | { ok: false; error: unknown };

export async function resolvePortalCountryFromDatabase(
  value?: string | null,
): Promise<PortalCountryResolution> {
  if (!supabaseAdmin) return { ok: false, error: new Error('Supabase no configurado') };
  const [churchesResult, regionsResult] = await Promise.all([
    supabaseAdmin.from('churches').select('country').not('country', 'is', null).limit(2000),
    supabaseAdmin.from('regions').select('country,is_active').eq('is_active', true).not('country', 'is', null).limit(2000),
  ]);
  if (churchesResult.error || regionsResult.error) {
    return { ok: false, error: churchesResult.error || regionsResult.error };
  }
  return {
    ok: true,
    country: findPortalCountry(value, churchesResult.data || [], regionsResult.data || []),
  };
}
