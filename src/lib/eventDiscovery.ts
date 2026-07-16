export type EventDiscoveryProfile = {
  churchId?: string | null;
  regionId?: string | null;
  city?: string | null;
  country?: string | null;
};

export type DiscoverableEvent = {
  id: string;
  scope?: string | null;
  church_id?: string | null;
  region_id?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  slug?: string | null;
  visibility?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

export type EventAudienceKind = 'CHURCH' | 'NEARBY' | 'REGIONAL' | 'NATIONAL' | 'GLOBAL';

export type DiscoveredEvent<T extends DiscoverableEvent = DiscoverableEvent> = T & {
  audience_kind: EventAudienceKind;
  audience_label: string;
  audience_priority: number;
  public_path: string;
};

function normalizePlace(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sameId(left: unknown, right: unknown): boolean {
  const a = String(left ?? '').trim().toLowerCase();
  const b = String(right ?? '').trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function samePlace(left: unknown, right: unknown): boolean {
  const a = normalizePlace(left);
  const b = normalizePlace(right);
  return Boolean(a && b && a === b);
}

export function getEventPublicPath(event: Pick<DiscoverableEvent, 'id' | 'slug'>): string {
  if (event.id === '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202') return '/eventos/cumbre-mundial-2026';
  const slug = String(event.slug || '').trim().toLowerCase();
  return `/eventos/${slug || event.id}`;
}

export function getEventAudience(
  event: DiscoverableEvent,
  profile: EventDiscoveryProfile,
): Pick<DiscoveredEvent, 'audience_kind' | 'audience_label' | 'audience_priority'> | null {
  const scope = String(event.scope || '').trim().toUpperCase();
  const sameCountry = samePlace(event.country, profile.country);

  if (scope === 'GLOBAL') {
    return { audience_kind: 'GLOBAL', audience_label: 'Para toda la familia Maná', audience_priority: 4 };
  }

  if (scope === 'NATIONAL') {
    return sameCountry
      ? { audience_kind: 'NATIONAL', audience_label: `En ${String(event.country || profile.country || 'tu país')}`, audience_priority: 3 }
      : null;
  }

  if (scope === 'REGIONAL') {
    return sameId(event.region_id, profile.regionId)
      ? { audience_kind: 'REGIONAL', audience_label: 'En tu región', audience_priority: 2 }
      : null;
  }

  if (scope === 'LOCAL') {
    if (sameId(event.church_id, profile.churchId)) {
      return { audience_kind: 'CHURCH', audience_label: 'En tu iglesia', audience_priority: 0 };
    }
    if (sameCountry && samePlace(event.city, profile.city)) {
      return { audience_kind: 'NEARBY', audience_label: `Cerca de ti · ${String(event.city || profile.city || '')}`, audience_priority: 1 };
    }
  }

  return null;
}

function lastEventMoment(event: DiscoverableEvent): number {
  const end = new Date(String(event.end_date || event.start_date || '')).getTime();
  return Number.isFinite(end) ? end : Number.POSITIVE_INFINITY;
}

function startEventMoment(event: DiscoverableEvent): number {
  const start = new Date(String(event.start_date || '')).getTime();
  return Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
}

export function discoverEventsForProfile<T extends DiscoverableEvent>(
  events: T[],
  profile: EventDiscoveryProfile,
  options: { now?: number; limit?: number } = {},
): DiscoveredEvent<T>[] {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20)));

  return events
    .filter((event) => {
      const status = String(event.status || 'PUBLISHED').toUpperCase();
      const visibility = String(event.visibility || 'PUBLIC').toUpperCase();
      return status === 'PUBLISHED' && visibility === 'PUBLIC' && lastEventMoment(event) >= now;
    })
    .map((event) => {
      const audience = getEventAudience(event, profile);
      return audience ? {
        ...event,
        ...audience,
        public_path: getEventPublicPath(event),
      } : null;
    })
    .filter((event): event is DiscoveredEvent<T> => Boolean(event))
    .sort((left, right) => (
      left.audience_priority - right.audience_priority
      || startEventMoment(left) - startEventMoment(right)
      || String(left.id).localeCompare(String(right.id))
    ))
    .slice(0, limit);
}
