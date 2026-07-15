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

const PORTAL_COUNTRY_ALIASES: Readonly<Record<string, { key: string; label: string }>> = Object.freeze({
  au: { key: 'australia', label: 'Australia' },
  australia: { key: 'australia', label: 'Australia' },
  co: { key: 'colombia', label: 'Colombia' },
  col: { key: 'colombia', label: 'Colombia' },
  colombia: { key: 'colombia', label: 'Colombia' },
  ec: { key: 'ecuador', label: 'Ecuador' },
  ecuador: { key: 'ecuador', label: 'Ecuador' },
  es: { key: 'espana', label: 'España' },
  espana: { key: 'espana', label: 'España' },
  fr: { key: 'francia', label: 'Francia' },
  france: { key: 'francia', label: 'Francia' },
  francia: { key: 'francia', label: 'Francia' },
  mexico: { key: 'mexico', label: 'México' },
  mx: { key: 'mexico', label: 'México' },
  eeuu: { key: 'estados unidos', label: 'Estados Unidos' },
  'estados unidos': { key: 'estados unidos', label: 'Estados Unidos' },
  'estados unidos de america': { key: 'estados unidos', label: 'Estados Unidos' },
  us: { key: 'estados unidos', label: 'Estados Unidos' },
  usa: { key: 'estados unidos', label: 'Estados Unidos' },
});

export function normalizeTerritoryKey(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizePortalCountryKey(value?: string | null): string {
  const normalized = normalizeTerritoryKey(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PORTAL_COUNTRY_ALIASES[normalized]?.key || normalized;
}

function getPortalCountryLabel(value?: string | null): string {
  const raw = String(value || '').trim();
  const normalized = normalizeTerritoryKey(raw)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PORTAL_COUNTRY_ALIASES[normalized]?.label || raw;
}

export function listPortalCountries(
  churches: PortalChurchRecord[] = [],
  regions: PortalRegionRecord[] = [],
): string[] {
  const byKey = new Map<string, string>();
  [...regions, ...churches].forEach((record) => {
    const country = String(record?.country || '').trim();
    const key = normalizePortalCountryKey(country);
    if (key && !byKey.has(key)) byKey.set(key, getPortalCountryLabel(country));
  });
  return Array.from(byKey.values()).sort((left, right) => left.localeCompare(right, 'es'));
}

export function filterPortalRegions(
  regions: PortalRegionRecord[] = [],
  params: { country?: string | null; allowedRegionIds?: string[] } = {},
): PortalRegionRecord[] {
  const countryKey = normalizePortalCountryKey(params.country);
  const allowed = new Set((params.allowedRegionIds || []).filter(Boolean));
  return regions.filter((region) => {
    if (region?.is_active === false) return false;
    if (countryKey && normalizePortalCountryKey(region?.country) !== countryKey) return false;
    if (allowed.size && !allowed.has(String(region?.id || ''))) return false;
    return true;
  });
}

export function filterPortalChurches(
  churches: PortalChurchRecord[] = [],
  params: { country?: string | null; regionId?: string | null; allowedRegionIds?: string[] } = {},
): PortalChurchRecord[] {
  const countryKey = normalizePortalCountryKey(params.country);
  const regionId = String(params.regionId || '').trim();
  const allowed = new Set((params.allowedRegionIds || []).filter(Boolean));
  return churches.filter((church) => {
    if (countryKey && normalizePortalCountryKey(church?.country) !== countryKey) return false;
    if (regionId && String(church?.region_id || '') !== regionId) return false;
    if (allowed.size && !allowed.has(String(church?.region_id || ''))) return false;
    return true;
  });
}

export function listPortalCities(
  churches: PortalChurchRecord[] = [],
  params: { country?: string | null; regionId?: string | null; allowedRegionIds?: string[] } = {},
): string[] {
  const byKey = new Map<string, string>();
  filterPortalChurches(churches, params).forEach((church) => {
    const city = String(church?.city || '').trim();
    const key = normalizeTerritoryKey(city);
    if (key && !byKey.has(key)) byKey.set(key, city);
  });
  return Array.from(byKey.values()).sort((left, right) => left.localeCompare(right, 'es'));
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
  const target = normalizePortalCountryKey(value);
  if (!target) return null;
  return listPortalCountries(churches, regions).find((country) => (
    normalizePortalCountryKey(country) === target
  )) || null;
}
