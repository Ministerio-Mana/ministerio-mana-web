import { normalizeCountryRegion } from './normalization.ts';

export type ScopedChurchAccess = {
  isAdmin: boolean;
  isNational: boolean;
  isRegional: boolean;
  allowedChurchId: string | null;
  allowedCountry: string | null;
  allowedRegionIds: string[];
};

export type ChurchScopeRow = {
  id: string;
  country: string | null;
  region_id?: string | null;
};

function normalizeCountry(value: string | null | undefined): string {
  return normalizeCountryRegion(value || '').toLowerCase();
}

export function isChurchScopeRowAllowed(church: ChurchScopeRow, access: ScopedChurchAccess): boolean {
  if (access.isAdmin) return true;
  if (access.allowedChurchId) return church.id === access.allowedChurchId;

  if (access.isRegional) {
    return Boolean(
      church.region_id
      && access.allowedRegionIds.length
      && access.allowedRegionIds.includes(church.region_id),
    );
  }

  if (access.isNational) {
    return Boolean(
      access.allowedCountry
      && normalizeCountry(church.country) === normalizeCountry(access.allowedCountry),
    );
  }

  return false;
}
