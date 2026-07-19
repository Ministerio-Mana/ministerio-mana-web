import churchesFallback from '../data/churches.json';
import { supabaseAdmin } from './supabaseAdmin.ts';
import {
  isPublicChurchDirectoryReady,
  normalizePublicChurchDirectoryItem,
  type PublicChurchDirectoryItem,
} from './churchDirectoryItem.ts';

export type { PublicChurchDirectoryItem } from './churchDirectoryItem.ts';

function databaseRow(value: Record<string, any>, index: number): PublicChurchDirectoryItem {
  const row = normalizePublicChurchDirectoryItem({
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
  const fallback = (churchesFallback as Record<string, any>[]).map(normalizePublicChurchDirectoryItem).filter(isPublicChurchDirectoryReady);
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

  const database = (result.data || []).map(databaseRow).filter(isPublicChurchDirectoryReady);
  return database.sort((a, b) => (
    `${a.continent}|${a.country}|${a.city}|${a.name}`.localeCompare(`${b.continent}|${b.country}|${b.city}|${b.name}`, 'es')
  ));
}
