import { supabaseAdmin } from './supabaseAdmin.ts';
import { isChurchPageSchemaMissingError, normalizeChurchPageDraft, normalizeChurchPageSlug } from './churchPage.ts';
import { listPublicDatabaseEvents, type PublicEvent } from './publicEvents.ts';

const CHURCH_FIELDS = 'id,code,name,kind,lifecycle_status,is_public,show_on_map,city,country,continent,address,maps_url,lat,lng,contact_name,contact_email,contact_phone,service,notes';

export type PublicChurchPage = {
  id: string;
  church_id: string;
  slug: string;
  published_at: string | null;
  page: ReturnType<typeof normalizeChurchPageDraft>;
  church: Record<string, any>;
  events: PublicEvent[];
};

export async function listPublishedChurchPageSummaries(): Promise<Array<{ church_id: string; slug: string; display_name: string }>> {
  if (!supabaseAdmin) return [];
  const result = await supabaseAdmin
    .from('church_public_pages')
    .select('church_id,slug,published_snapshot')
    .eq('status', 'PUBLISHED');
  if (isChurchPageSchemaMissingError(result.error)) return [];
  if (result.error) {
    console.error('[church-public] summaries failed', { code: result.error.code, message: result.error.message });
    return [];
  }
  return (result.data || []).map((row: any) => ({
    church_id: String(row.church_id || ''),
    slug: normalizeChurchPageSlug(row.slug),
    display_name: normalizeChurchPageDraft(row.published_snapshot || {}).display_name,
  })).filter((row) => row.church_id && row.slug);
}

export async function getPublicChurchPage(slug: string): Promise<PublicChurchPage | null> {
  if (!supabaseAdmin) return null;
  const normalizedSlug = normalizeChurchPageSlug(slug);
  if (!normalizedSlug) return null;

  const pageResult = await supabaseAdmin
    .from('church_public_pages')
    .select('id,church_id,slug,published_at,published_snapshot')
    .eq('slug', normalizedSlug)
    .eq('status', 'PUBLISHED')
    .maybeSingle();
  if (isChurchPageSchemaMissingError(pageResult.error)) return null;
  if (pageResult.error || !pageResult.data?.published_snapshot) return null;

  let churchResult = await supabaseAdmin
    .from('churches')
    .select(CHURCH_FIELDS)
    .eq('id', pageResult.data.church_id)
    .maybeSingle();
  if (churchResult.error?.code === '42703') {
    churchResult = await supabaseAdmin
      .from('churches')
      .select('id,code,name,city,country,address,maps_url,lat,lng,contact_name,contact_email,contact_phone')
      .eq('id', pageResult.data.church_id)
      .maybeSingle();
  }
  if (churchResult.error || !churchResult.data) return null;
  const hasCanonicalDirectory = 'lifecycle_status' in churchResult.data;
  if (hasCanonicalDirectory && (
    churchResult.data.lifecycle_status !== 'ACTIVE'
    || churchResult.data.is_public === false
  )) return null;

  const canonicalContact = churchResult.data as Record<string, any>;
  const page = normalizeChurchPageDraft({
    ...pageResult.data.published_snapshot,
    slug: pageResult.data.slug,
    status: 'PUBLISHED',
    contact_whatsapp: hasCanonicalDirectory ? canonicalContact.contact_phone ?? '' : pageResult.data.published_snapshot.contact_whatsapp,
    contact_email: hasCanonicalDirectory ? canonicalContact.contact_email ?? '' : pageResult.data.published_snapshot.contact_email,
    pastor_name: hasCanonicalDirectory ? canonicalContact.contact_name ?? '' : pageResult.data.published_snapshot.pastor_name,
    service_schedule: hasCanonicalDirectory ? canonicalContact.service ?? '' : pageResult.data.published_snapshot.service_schedule,
  });
  const now = Date.now();
  const events = (await listPublicDatabaseEvents())
    .filter((event) => {
      if (event.church_id !== pageResult.data.church_id) return false;
      const lastMoment = new Date(event.end_date || event.start_date).getTime();
      return Number.isFinite(lastMoment) && lastMoment >= now;
    })
    .slice(0, 6);
  return {
    id: pageResult.data.id,
    church_id: pageResult.data.church_id,
    slug: pageResult.data.slug,
    published_at: pageResult.data.published_at,
    page,
    church: churchResult.data,
    events,
  };
}
