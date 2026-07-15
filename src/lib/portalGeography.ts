export type PortalCountryRecord = {
  country?: string | null;
};

export type PortalRegionRecord = PortalCountryRecord & {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  is_active?: boolean | null;
};

export type PortalChurchRecord = PortalCountryRecord & {
  id?: string | null;
  region_id?: string | null;
  city?: string | null;
  name?: string | null;
};

export function normalizeTerritoryKey(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function listPortalCountries(
  churches: PortalChurchRecord[] = [],
  regions: PortalRegionRecord[] = [],
): string[] {
  const byKey = new Map<string, string>();
  [...regions, ...churches].forEach((record) => {
    const country = String(record?.country || '').trim();
    const key = normalizeTerritoryKey(country);
    if (key && !byKey.has(key)) byKey.set(key, country);
  });
  return Array.from(byKey.values()).sort((left, right) => left.localeCompare(right, 'es'));
}

export function filterPortalRegions(
  regions: PortalRegionRecord[] = [],
  params: { country?: string | null; allowedRegionIds?: string[] } = {},
): PortalRegionRecord[] {
  const countryKey = normalizeTerritoryKey(params.country);
  const allowed = new Set((params.allowedRegionIds || []).filter(Boolean));
  return regions.filter((region) => {
    if (region?.is_active === false) return false;
    if (countryKey && normalizeTerritoryKey(region?.country) !== countryKey) return false;
    if (allowed.size && !allowed.has(String(region?.id || ''))) return false;
    return true;
  });
}

export function filterPortalChurches(
  churches: PortalChurchRecord[] = [],
  params: { country?: string | null; regionId?: string | null; allowedRegionIds?: string[] } = {},
): PortalChurchRecord[] {
  const countryKey = normalizeTerritoryKey(params.country);
  const regionId = String(params.regionId || '').trim();
  const allowed = new Set((params.allowedRegionIds || []).filter(Boolean));
  return churches.filter((church) => {
    if (countryKey && normalizeTerritoryKey(church?.country) !== countryKey) return false;
    if (regionId && String(church?.region_id || '') !== regionId) return false;
    if (allowed.size && !allowed.has(String(church?.region_id || ''))) return false;
    return true;
  });
}

export function isPortalCountry(
  value: string | null | undefined,
  churches: PortalChurchRecord[] = [],
  regions: PortalRegionRecord[] = [],
): boolean {
  return Boolean(findPortalCountry(value, churches, regions));
}

export function findPortalCountry(
  value: string | null | undefined,
  churches: PortalChurchRecord[] = [],
  regions: PortalRegionRecord[] = [],
): string | null {
  const target = normalizeTerritoryKey(value);
  if (!target) return null;
  return listPortalCountries(churches, regions).find((country) => (
    normalizeTerritoryKey(country) === target
  )) || null;
}
