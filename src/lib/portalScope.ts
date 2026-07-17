import { supabaseAdmin } from '@lib/supabaseAdmin';
import type { PortalChurchAccessContext } from '@lib/portalAccess';
import { isChurchScopeRowAllowed, type ChurchScopeRow, type ScopedChurchAccess } from '@lib/churchScopePolicy';

type ScopedAccess = Pick<
  PortalChurchAccessContext,
  'isAdmin' | 'isNational' | 'isRegional' | 'allowedChurchId' | 'allowedCountry' | 'allowedRegionIds'
> & ScopedChurchAccess;

async function getChurchScope(churchId: string): Promise<ChurchScopeRow | null> {
  if (!supabaseAdmin || !churchId) return null;

  let { data, error } = await supabaseAdmin
    .from('churches')
    .select('id, country, region_id')
    .eq('id', churchId)
    .maybeSingle();

  if (error?.code === '42703') {
    const fallback = await supabaseAdmin
      .from('churches')
      .select('id, country')
      .eq('id', churchId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return null;
  }

  return (data as ChurchScopeRow | null) || null;
}

export async function listAccessibleChurchIds(access: ScopedAccess): Promise<string[]> {
  if (!supabaseAdmin) return [];
  if (access.isAdmin) return [];
  if (access.allowedChurchId) return [access.allowedChurchId];

  if (access.isRegional) {
    if (!access.allowedRegionIds.length) return [];
    const { data, error } = await supabaseAdmin
      .from('churches')
      .select('id')
      .in('region_id', access.allowedRegionIds);
    if (error) return [];
    return Array.from(new Set((data || []).map((church: any) => church.id).filter(Boolean)));
  }

  if (access.isNational) {
    if (!access.allowedCountry) return [];
    const { data, error } = await supabaseAdmin
      .from('churches')
      .select('id')
      .eq('country', access.allowedCountry);
    if (error) return [];
    return Array.from(new Set((data || []).map((church: any) => church.id).filter(Boolean)));
  }

  return [];
}

export async function isChurchAllowedForAccess(churchId: string | null | undefined, access: ScopedAccess): Promise<boolean> {
  if (!churchId) return false;
  if (access.isAdmin) return true;
  if (access.allowedChurchId) return churchId === access.allowedChurchId;

  const church = await getChurchScope(churchId);
  if (!church?.id) return false;
  return isChurchScopeRowAllowed(church, access);
}
