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
  page_slug?: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function key(value: Record<string, unknown>): string {
  return [value.country, value.city, value.name]
    .map((part) => text(part).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .join('|');
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
  row.continent = text(value.continent);
  return row;
}

export async function listPublicChurchDirectory(): Promise<PublicChurchDirectoryItem[]> {
  const fallback = (churchesFallback as Record<string, any>[]).map(fallbackRow);
  if (!supabaseAdmin) return fallback;

  let result = await supabaseAdmin
    .from('churches')
    .select('id,code,name,city,country,continent,address,maps_url,lat,lng,contact_name,contact_email,contact_phone')
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
  const merged = new Map<string, PublicChurchDirectoryItem>();
  fallback.forEach((church) => merged.set(key(church as unknown as Record<string, unknown>), church));
  database.forEach((church) => {
    const identity = key(church as unknown as Record<string, unknown>);
    const previous = merged.get(identity);
    merged.set(identity, {
      ...(previous || church),
      ...church,
      code: church.code || previous?.code || '',
      name: church.name || previous?.name || '',
      city: church.city || previous?.city || '',
      country: church.country || previous?.country || '',
      continent: church.continent || previous?.continent || 'América',
      address: church.address || previous?.address || '',
      maps_url: church.maps_url || previous?.maps_url || '',
      lat: church.lat ?? previous?.lat ?? null,
      lng: church.lng ?? previous?.lng ?? null,
      service: church.service || previous?.service || '',
      notes: church.notes || previous?.notes || '',
      whatsapp: church.whatsapp || previous?.whatsapp || '',
      contact: {
        name: church.contact.name || previous?.contact.name || '',
        email: church.contact.email || previous?.contact.email || '',
        phone: church.contact.phone || previous?.contact.phone || '',
      },
    });
  });
  return Array.from(merged.values()).sort((a, b) => (
    `${a.continent}|${a.country}|${a.city}|${a.name}`.localeCompare(`${b.continent}|${b.country}|${b.city}|${b.name}`, 'es')
  ));
}
