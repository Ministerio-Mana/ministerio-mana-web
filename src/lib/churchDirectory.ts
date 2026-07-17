import churchesFallback from '../data/churches.json';
import { supabaseAdmin } from './supabaseAdmin.ts';
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

function fallbackRow(value: Record<string, any>, index: number): PublicChurchDirectoryItem {
  const code = normalizeChurchPageSlug(value.code || `${value.country}-${value.city}-${value.name}`);
  return {
    id: text(value.id) || `fallback-${index}-${code}`,
    code,
    name: text(value.name),
    city: text(value.city),
    country: text(value.country),
    continent: text(value.continent) || 'América',
    address: text(value.address),
    maps_url: text(value.maps_url || value.mapsUrl),
    lat: Number.isFinite(Number(value.lat)) ? Number(value.lat) : null,
    lng: Number.isFinite(Number(value.lng)) ? Number(value.lng) : null,
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
    show_on_map: value.show_on_map !== false,
  };
}

function databaseRow(value: Record<string, any>, index: number): PublicChurchDirectoryItem {
  const row = fallbackRow({
    ...value,
    whatsapp: value.contact_phone,
    contact: {
      name: value.contact_name,
      email: value.contact_email,
      phone: value.contact_phone,
    },
  }, index);
  row.continent = text(value.continent) || 'América';
  return row;
}

export async function listPublicChurchDirectory(): Promise<PublicChurchDirectoryItem[]> {
  const fallback = (churchesFallback as Record<string, any>[]).map(fallbackRow);
  if (!supabaseAdmin) return fallback;

  let result = await supabaseAdmin
    .from('churches')
    .select('id,code,name,kind,lifecycle_status,is_public,show_on_map,city,country,continent,address,maps_url,lat,lng,contact_name,contact_email,contact_phone,service,notes')
    .eq('lifecycle_status', 'ACTIVE')
    .eq('is_public', true)
    .order('continent')
    .order('country')
    .order('city')
    .order('name');
  if (result.error?.code === '42703') {
    result = await supabaseAdmin
      .from('churches')
      .select('id,code,name,city,country,address,maps_url,lat,lng,contact_name,contact_email,contact_phone')
      .order('country')
      .order('city')
      .order('name');
  }
  if (result.error) {
    console.error('[church-directory] database fallback', { code: result.error.code, message: result.error.message });
    return fallback;
  }

  const database = (result.data || []).map(databaseRow);
  return database.sort((a, b) => (
    `${a.continent}|${a.country}|${a.city}|${a.name}`.localeCompare(`${b.continent}|${b.country}|${b.city}|${b.name}`, 'es')
  ));
}
