type ChurchMapsInput = {
  maps_url?: unknown;
  lat?: unknown;
  lng?: unknown;
  address?: unknown;
  city?: unknown;
  country?: unknown;
};

const GOOGLE_MAPS_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
]);

function isAllowedGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GOOGLE_MAPS_HOSTS.has(host) || host.endsWith('.google.com');
}

export function getSafeMapsUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!isAllowedGoogleMapsHost(url.hostname)) return null;
    if (url.hostname.toLowerCase() === 'goo.gl' && !url.pathname.startsWith('/maps')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildSafeChurchMapsUrl(church: ChurchMapsInput, fallbackCountry = 'Colombia'): string {
  const safeMapsUrl = getSafeMapsUrl(church.maps_url);
  if (safeMapsUrl) return safeMapsUrl;

  const rawLat = church.lat;
  const rawLng = church.lng;
  const lat = rawLat === null || rawLat === undefined || String(rawLat).trim() === '' ? Number.NaN : Number(rawLat);
  const lng = rawLng === null || rawLng === undefined || String(rawLng).trim() === '' ? Number.NaN : Number(rawLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  const query = [
    church.address,
    church.city,
    church.country || fallbackCountry,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');

  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : 'https://maps.google.com';
}
