import { normalizeEventLandingSettings } from './eventLanding.ts';
import { getEventPublicPath, type DiscoveredEvent } from './eventDiscovery.ts';
import type { PublicEvent } from './publicEvents.ts';

export type ChurchPromotion = {
  id: string;
  source: 'EVENT' | 'CAMPAIGN';
  title: string;
  description: string;
  eyebrow: string;
  image_url: string;
  mobile_image_url: string;
  cta_label: string;
  cta_href: string;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safePublicUrl(value: unknown, allowRelative = true): string {
  const raw = String(value ?? '').trim();
  if (allowRelative && /^\/(?!\/)[^\\\s]*$/.test(raw)) return raw.slice(0, 500);
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString().slice(0, 500) : '';
  } catch {
    return '';
  }
}

function normalizePriority(value: unknown, fallback = 50): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? `${raw}-05:00` : raw;
  const date = new Date(zoned);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isActiveWindow(promotion: Pick<ChurchPromotion, 'starts_at' | 'ends_at'>, now: number): boolean {
  const startsAt = promotion.starts_at ? new Date(promotion.starts_at).getTime() : Number.NEGATIVE_INFINITY;
  const endsAt = promotion.ends_at ? new Date(promotion.ends_at).getTime() : Number.POSITIVE_INFINITY;
  return startsAt <= now && endsAt >= now;
}

export function normalizeCmsChurchPromotion(row: Record<string, any>): ChurchPromotion | null {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
  const title = cleanText(payload.title || row?.title, 120);
  const imageUrl = safePublicUrl(payload.image || payload.image_url);
  const ctaHref = safePublicUrl(payload.ctaHref || payload.cta_href || payload.url);
  if (!title || !imageUrl || !ctaHref) return null;

  return {
    id: cleanText(row?.id || row?.section_key || title, 120),
    source: 'CAMPAIGN',
    title,
    description: cleanText(payload.description || payload.text, 320),
    eyebrow: cleanText(payload.eyebrow, 80) || 'Para toda la familia Maná',
    image_url: imageUrl,
    mobile_image_url: safePublicUrl(payload.mobileImage || payload.mobile_image || payload.mobile_image_url),
    cta_label: cleanText(payload.ctaLabel || payload.cta_label, 50) || 'Conocer más',
    cta_href: ctaHref,
    starts_at: normalizeDate(payload.startsAt || payload.starts_at),
    ends_at: normalizeDate(payload.endsAt || payload.ends_at),
    priority: normalizePriority(payload.priority, Number(row?.position || 50)),
  };
}

export function buildEventChurchPromotions(
  events: Array<DiscoveredEvent<PublicEvent>>,
  options: { now?: number; limit?: number } = {},
): ChurchPromotion[] {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const limit = Math.max(1, Math.min(8, Number(options.limit || 4)));

  return events
    .map((event) => {
      const settings = normalizeEventLandingSettings(event.page_settings);
      const imageUrl = safePublicUrl(event.banner_url);
      if (!settings.promote_on_church_pages || !imageUrl) return null;
      const promotion: ChurchPromotion = {
        id: `event-${event.id}`,
        source: 'EVENT',
        title: cleanText(event.title, 120),
        description: cleanText(event.description, 320),
        eyebrow: settings.promotion_eyebrow || event.audience_label,
        image_url: imageUrl,
        mobile_image_url: '',
        cta_label: 'Ver evento',
        cta_href: getEventPublicPath(event),
        starts_at: normalizeDate(event.start_date),
        ends_at: normalizeDate(event.end_date || event.start_date),
        priority: settings.promotion_priority,
      };
      return promotion.title && isActiveWindow({ starts_at: null, ends_at: promotion.ends_at }, now) ? promotion : null;
    })
    .filter((promotion): promotion is ChurchPromotion => Boolean(promotion))
    .sort((left, right) => (
      left.priority - right.priority
      || new Date(left.starts_at || 0).getTime() - new Date(right.starts_at || 0).getTime()
      || left.id.localeCompare(right.id)
    ))
    .slice(0, limit);
}

export async function listCmsChurchPromotions(options: { now?: number } = {}): Promise<ChurchPromotion[]> {
  const { supabaseAdmin } = await import('./supabaseAdmin.ts');
  if (!supabaseAdmin) return [];
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();

  const pageResult = await supabaseAdmin
    .from('cms_pages')
    .select('id')
    .eq('page_key', 'church-promotions')
    .eq('status', 'published')
    .maybeSingle();
  if (pageResult.error || !pageResult.data?.id) return [];

  const sectionsResult = await supabaseAdmin
    .from('cms_sections')
    .select('id,section_key,title,position,payload')
    .eq('page_id', pageResult.data.id)
    .eq('kind', 'promotion')
    .eq('status', 'published')
    .order('position', { ascending: true });
  if (sectionsResult.error) return [];

  return (sectionsResult.data || [])
    .map((row) => normalizeCmsChurchPromotion(row))
    .filter((promotion): promotion is ChurchPromotion => Boolean(promotion && isActiveWindow(promotion, now)));
}

export function mergeChurchPromotions(
  campaigns: ChurchPromotion[],
  eventPromotions: ChurchPromotion[],
  limit = 4,
): ChurchPromotion[] {
  const seen = new Set<string>();
  return [...campaigns, ...eventPromotions]
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .filter((promotion) => {
      const key = `${promotion.cta_href.toLowerCase()}|${promotion.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(8, limit)));
}
