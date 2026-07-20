import { supabaseAdmin } from './supabaseAdmin.ts';

export const CUMBRE_EVENT_ID = '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202';
const EVENT_PAYMENT_ASSETS_BUCKET = String(
  import.meta.env.EVENT_PAYMENT_ASSETS_BUCKET || process.env.EVENT_PAYMENT_ASSETS_BUCKET || 'event-payment-assets',
).trim();

const LEGACY_PUBLIC_FIELDS = [
  'id',
  'title',
  'description',
  'scope',
  'church_id',
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

const REGIONAL_PUBLIC_FIELDS = [LEGACY_PUBLIC_FIELDS, 'region_id'].join(',');

const PLATFORM_EXPERIENCE_FIELDS = [
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
  'attendance_mode',
  'pricing_model',
  'registration_requires_approval',
  'page_settings',
];

const PLATFORM_PUBLIC_FIELDS_BASE = [REGIONAL_PUBLIC_FIELDS, ...PLATFORM_EXPERIENCE_FIELDS].join(',');
const PLATFORM_PUBLIC_FIELDS_WITHOUT_REGION = [LEGACY_PUBLIC_FIELDS, ...PLATFORM_EXPERIENCE_FIELDS].join(',');

const PLATFORM_PUBLIC_FIELDS_BEFORE_EXPERIENCE = [PLATFORM_PUBLIC_FIELDS_BASE, 'banner_layout'].join(',');
const PLATFORM_PUBLIC_FIELDS = [
  PLATFORM_PUBLIC_FIELDS_BEFORE_EXPERIENCE,
  'contact_whatsapp',
  'contact_whatsapp_message',
  'registration_form_config',
].join(',');
const PLATFORM_PUBLIC_FIELDS_DUAL = [PLATFORM_PUBLIC_FIELDS, 'price_cop', 'price_usd'].join(',');

export type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  scope: string;
  church_id?: string | null;
  region_id?: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
  banner_layout?: 'HORIZONTAL' | 'SQUARE' | 'VERTICAL' | null;
  location_name: string | null;
  location_address: string | null;
  city: string | null;
  country: string | null;
  price: number | null;
  price_cop?: number | null;
  price_usd?: number | null;
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
  contact_whatsapp?: string | null;
  contact_whatsapp_message?: string | null;
  registration_form_config?: unknown;
  timezone?: string | null;
  attendance_mode?: 'IN_PERSON' | 'ONLINE' | 'HYBRID' | null;
  pricing_model?: 'FREE' | 'PAID' | 'DONATION' | null;
  registration_requires_approval?: boolean | null;
  page_settings?: unknown;
};

export type PublicEventPaymentOption = {
  id: string;
  kind: 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'QR_TRANSFER' | 'EXTERNAL';
  provider: 'WOMPI' | 'STRIPE' | 'MANUAL' | 'EXTERNAL';
  currency: string;
  label: string;
  instructions: string | null;
  external_url: string | null;
  qr_url: string | null;
  requires_evidence: boolean;
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
    .select(PLATFORM_PUBLIC_FIELDS_DUAL)
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

  const beforeDual = await supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS)
    .eq('status', 'PUBLISHED')
    .order('start_date', { ascending: true });
  if (!beforeDual.error) {
    return normalizeRows(beforeDual.data).filter((event) => (
      event.visibility === 'PUBLIC' || event.id === CUMBRE_EVENT_ID
    ));
  }
  if (!isExpectedSchemaError(beforeDual.error)) {
    console.error('[public-events] list fallback error', beforeDual.error);
    return [];
  }

  const beforeExperience = await supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_BEFORE_EXPERIENCE)
    .eq('status', 'PUBLISHED')
    .order('start_date', { ascending: true });
  if (!beforeExperience.error) {
    return normalizeRows(beforeExperience.data).filter((event) => (
      event.visibility === 'PUBLIC' || event.id === CUMBRE_EVENT_ID
    ));
  }

  const beforeLayout = await supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_BASE)
    .eq('status', 'PUBLISHED')
    .order('start_date', { ascending: true });
  if (!beforeLayout.error) {
    return normalizeRows(beforeLayout.data).filter((event) => (
      event.visibility === 'PUBLIC' || event.id === CUMBRE_EVENT_ID
    ));
  }

  const withoutRegion = await supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_WITHOUT_REGION)
    .eq('status', 'PUBLISHED')
    .order('start_date', { ascending: true });
  if (!withoutRegion.error) {
    return normalizeRows(withoutRegion.data).filter((event) => (
      event.visibility === 'PUBLIC' || event.id === CUMBRE_EVENT_ID
    ));
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
  return legacy.data ? [legacy.data as unknown as PublicEvent] : [];
}

export async function getPublicDatabaseEvent(identifier: string): Promise<PublicEvent | null> {
  if (!supabaseAdmin) return null;
  const normalized = identifier.trim().toLowerCase();
  if (!isUuid(normalized) && !isSafeSlug(normalized)) return null;

  let enhancedQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_DUAL)
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

  let beforeDualQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS)
    .eq('status', 'PUBLISHED');
  beforeDualQuery = isUuid(normalized)
    ? beforeDualQuery.eq('id', normalized)
    : beforeDualQuery.eq('slug', normalized);
  const beforeDual = await beforeDualQuery.maybeSingle();
  if (!beforeDual.error) {
    const event = beforeDual.data as PublicEvent | null;
    return event && event.visibility !== 'PRIVATE' ? event : null;
  }
  if (!isExpectedSchemaError(beforeDual.error)) {
    console.error('[public-events] detail fallback error', beforeDual.error);
    return null;
  }

  let beforeExperienceQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_BEFORE_EXPERIENCE)
    .eq('status', 'PUBLISHED');
  beforeExperienceQuery = isUuid(normalized)
    ? beforeExperienceQuery.eq('id', normalized)
    : beforeExperienceQuery.eq('slug', normalized);
  const beforeExperience = await beforeExperienceQuery.maybeSingle();
  if (!beforeExperience.error) {
    const event = beforeExperience.data as PublicEvent | null;
    return event && event.visibility !== 'PRIVATE' ? event : null;
  }

  let beforeLayoutQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_BASE)
    .eq('status', 'PUBLISHED');
  beforeLayoutQuery = isUuid(normalized)
    ? beforeLayoutQuery.eq('id', normalized)
    : beforeLayoutQuery.eq('slug', normalized);
  const beforeLayout = await beforeLayoutQuery.maybeSingle();
  if (!beforeLayout.error) {
    const event = beforeLayout.data as PublicEvent | null;
    return event && event.visibility !== 'PRIVATE' ? event : null;
  }

  let withoutRegionQuery = supabaseAdmin
    .from('events')
    .select(PLATFORM_PUBLIC_FIELDS_WITHOUT_REGION)
    .eq('status', 'PUBLISHED');
  withoutRegionQuery = isUuid(normalized)
    ? withoutRegionQuery.eq('id', normalized)
    : withoutRegionQuery.eq('slug', normalized);
  const withoutRegion = await withoutRegionQuery.maybeSingle();
  if (!withoutRegion.error) {
    const event = withoutRegion.data as PublicEvent | null;
    return event && event.visibility !== 'PRIVATE' ? event : null;
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

export async function listPublicEventPaymentOptions(eventId: string): Promise<PublicEventPaymentOption[]> {
  if (!supabaseAdmin || !isUuid(eventId)) return [];
  const db = supabaseAdmin;
  const { data, error } = await db
    .from('event_payment_options')
    .select('id, kind, provider, currency, label, instructions, external_url, qr_asset_path, requires_evidence')
    .eq('event_id', eventId)
    .eq('is_active', true)
    .in('provider', ['WOMPI', 'STRIPE', 'MANUAL', 'EXTERNAL'])
    .order('created_at', { ascending: true });
  if (error) {
    if (error.code !== '42P01') console.error('[public-events] payment options error', error);
    return [];
  }
  const options = await Promise.all((data || []).map(async (row: any) => {
    const externalUrl = typeof row.external_url === 'string' && /^https:\/\//i.test(row.external_url)
      ? row.external_url
      : null;
    let qrUrl: string | null = null;
    if (row.kind === 'QR_TRANSFER' && row.qr_asset_path) {
      const signed = await db.storage
        .from(EVENT_PAYMENT_ASSETS_BUCKET)
        .createSignedUrl(String(row.qr_asset_path), 3600);
      qrUrl = signed.data?.signedUrl || null;
    }
    return {
      id: String(row.id),
      kind: row.kind,
      provider: row.provider,
      currency: String(row.currency || ''),
      label: String(row.label || 'Método de pago'),
      instructions: row.instructions ? String(row.instructions) : null,
      external_url: externalUrl,
      qr_url: qrUrl,
      requires_evidence: Boolean(row.requires_evidence),
    } as PublicEventPaymentOption;
  }));
  return options.filter((option) => option.kind === 'ONLINE' || option.kind === 'CASH' || option.kind === 'BANK_TRANSFER'
    || (option.kind === 'QR_TRANSFER' && option.qr_url)
    || (option.kind === 'EXTERNAL' && option.external_url));
}
