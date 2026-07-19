import { normalizeChurchPageSlug } from './churchPage.ts';

export type PublicChurchDirectoryItem = {
  id: string;
  code: string;
  name: string;
  city: string;
  country: string;
  continent: string;
  address: string;
  maps_url: string;
  lat: number | null;
  lng: number | null;
  contact: { name: string; email: string; phone: string };
  whatsapp: string;
  service: string;
  notes: string;
  kind?: 'CHURCH' | 'GROUP';
  lifecycle_status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  is_public?: boolean;
  show_on_map?: boolean;
  page_slug?: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePublicChurchDirectoryItem(value: Record<string, any>, index = 0): PublicChurchDirectoryItem {
  const code = normalizeChurchPageSlug(value.code || `${value.country}-${value.city}-${value.name}`);
  const lat = nullableCoordinate(value.lat);
  const lng = nullableCoordinate(value.lng);
  return {
    id: text(value.id) || `fallback-${index}-${code}`,
    code,
    name: text(value.name),
    city: text(value.city),
    country: text(value.country),
    continent: text(value.continent) || 'América',
    address: text(value.address),
    maps_url: text(value.maps_url || value.mapsUrl),
    lat,
    lng,
    contact: {
      name: text(value.contact?.name || value.contact_name),
      email: text(value.contact?.email || value.contact_email),
      phone: text(value.contact?.phone || value.contact_phone),
    },
    whatsapp: text(value.whatsapp || value.contact_phone),
    service: text(value.service),
    notes: text(value.notes),
    kind: value.kind === 'GROUP' ? 'GROUP' : 'CHURCH',
    lifecycle_status: value.lifecycle_status === 'DRAFT' || value.lifecycle_status === 'INACTIVE' ? value.lifecycle_status : 'ACTIVE',
    is_public: value.is_public !== false,
    show_on_map: value.show_on_map !== false && lat !== null && lng !== null,
  };
}

export function isPublicChurchDirectoryReady(value: PublicChurchDirectoryItem): boolean {
  return Boolean(value.address || value.maps_url);
}
