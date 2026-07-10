import { supabaseAdmin } from '@lib/supabaseAdmin';

export const CUMBRE_EVENT_ID = '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202';

const LEGACY_PUBLIC_FIELDS = [
  'id',
  'title',
  'description',
  'scope',
  'start_date',
  'end_date',
  'banner_url',
  'location_name',
  'location_address',
  'city',
  'country',
  'price',
  'currency',
  'status',
].join(',');

const PLATFORM_PUBLIC_FIELDS = [
  LEGACY_PUBLIC_FIELDS,
  'slug',
  'visibility',
  'category',
  'registration_mode',
  'registration_url',
  'registration_opens_at',
  'registration_closes_at',
  'capacity',
  'contact_email',
  'timezone',
].join(',');

export type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  scope: string;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
  location_name: string | null;
  location_address: string | null;
  city: string | null;
  country: string | null;
  price: number | null;
  currency: string | null;
  status: string;
  slug?: string | null;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | null;
  category?: string | null;
  registration_mode?: 'NONE' | 'EXTERNAL' | 'INTERNAL' | null;
  registration_url?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  capacity?: number | null;
  contact_email?: string | null;
  timezone?: string | null;
};

function isExpectedSchemaError(error: any): boolean {
  return error?.code === '42703' || error?.code === '42P01';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 180;
}

function normalizeRows(rows: unknown): PublicEvent[] {
  return Array.isArray(rows) ? rows as PublicEvent[] : [];
}

export function getPublicEventPath(event: Pick<PublicEvent, 'id' | 'slug'>): string {
  if (event.id === CUMBRE_EVENT_ID) return '/eventos/cumbre-mundial-2026';
  return `/eventos/${event.slug || event.id}`;
}

export async function listPublicDatabaseEvents(): Promise<PublicEvent[]> {
  if (!supabaseAdmin) return [];

  const enhanced = await supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS)
    .eq('status', 'PUBLISHED')
    .order('start_date', { ascending: true });

  if (!enhanced.error) {
    return normalizeRows(enhanced.data).filter((event) => (
      event.visibility === 'PUBLIC' || event.id === CUMBRE_EVENT_ID
    ));
  }

  if (!isExpectedSchemaError(enhanced.error)) {
    console.error('[public-events] list error', enhanced.error);
    return [];
  }

  // Before the platform upgrade, only the known global Cumbre event is listed.
  // Other legacy events remain shareable by their UUID without becoming discoverable.
  const legacy = await supabaseAdmin
    .from('events')
    .select(LEGACY_PUBLIC_FIELDS)
    .eq('id', CUMBRE_EVENT_ID)
    .eq('status', 'PUBLISHED')
    .maybeSingle();

  if (legacy.error && legacy.error.code !== 'PGRST116' && legacy.error.code !== '42P01') {
    console.error('[public-events] legacy list error', legacy.error);
  }
  return legacy.data ? [legacy.data as PublicEvent] : [];
}

export async function getPublicDatabaseEvent(identifier: string): Promise<PublicEvent | null> {
  if (!supabaseAdmin) return null;
  const normalized = identifier.trim().toLowerCase();
  if (!isUuid(normalized) && !isSafeSlug(normalized)) return null;

  let enhancedQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS)
    .eq('status', 'PUBLISHED');

  enhancedQuery = isUuid(normalized)
    ? enhancedQuery.eq('id', normalized)
    : enhancedQuery.eq('slug', normalized);

  const enhanced = await enhancedQuery.maybeSingle();
  if (!enhanced.error) {
    const event = enhanced.data as PublicEvent | null;
    return event && event.visibility !== 'PRIVATE' ? event : null;
  }

  if (!isExpectedSchemaError(enhanced.error)) {
    console.error('[public-events] detail error', enhanced.error);
    return null;
  }
  if (!isUuid(normalized)) return null;

  const legacy = await supabaseAdmin
    .from('events')
    .select(LEGACY_PUBLIC_FIELDS)
    .eq('id', normalized)
    .eq('status', 'PUBLISHED')
    .maybeSingle();

  if (legacy.error && legacy.error.code !== 'PGRST116' && legacy.error.code !== '42P01') {
    console.error('[public-events] legacy detail error', legacy.error);
    return null;
  }
  return legacy.data as PublicEvent | null;
}
