import {
  mergeStripeAccountingMetadata,
  resolveCampusStripeAccounting,
  resolveCumbreStripeAccounting,
  resolveDonationStripeAccounting,
  resolveEventStripeAccounting,
  resolvePilgrimageStripeAccounting,
  type CampusStripeDestination,
  type StripeAccountingDescriptor,
} from './stripeAccounting.ts';

export const STRIPE_ACCOUNTING_BACKFILL_VERSION = 'mana_fund_v1_2026_07';

export type StripeAccountingConfidence = 'ALREADY_CLASSIFIED' | 'EXACT_INTERNAL' | 'EXACT_METADATA' | 'UNASSIGNED';

export type HistoricalDonationEvidence = {
  id?: unknown;
  source?: unknown;
  donation_type?: unknown;
  project_name?: unknown;
  event_name?: unknown;
  campus?: unknown;
  cumbre_booking_id?: unknown;
  payment_domain?: unknown;
};

export type HistoricalEventEvidence = {
  id?: unknown;
  title?: unknown;
};

export type HistoricalStripeEvidence = {
  metadata?: Record<string, unknown>;
  donation?: HistoricalDonationEvidence | null;
  event?: HistoricalEventEvidence | null;
  campusDestinations?: CampusStripeDestination[];
};

export type HistoricalStripeResolution = {
  accounting: StripeAccountingDescriptor | null;
  confidence: StripeAccountingConfidence;
  reason: string;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function searchText(value: unknown): string {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function metadataCampusDestinations(metadata: Record<string, unknown>): CampusStripeDestination[] {
  const slugs = text(metadata.missionaries)
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  return slugs.map((slug) => ({ slug, name: slug.replace(/[-_]+/g, ' ') }));
}

function looksLikeCumbre(...values: unknown[]): boolean {
  return values.some((value) => searchText(value).includes('cumbre'));
}

function looksLikeCampus(...values: unknown[]): boolean {
  return values.some((value) => searchText(value).includes('campus'));
}

function looksLikeKnownPilgrimage(...values: unknown[]): boolean {
  return values.some((value) => {
    const normalized = searchText(value);
    return normalized.includes('turquia') || normalized.includes('islas griegas');
  });
}

function knownPilgrimageAccounting(): StripeAccountingDescriptor {
  return resolvePilgrimageStripeAccounting({
    pilgrimageId: 'TURQUIA_ISLAS_GRIEGAS_2026',
    pilgrimageTitle: 'Turquía e Islas Griegas 2026',
  });
}

export function resolveHistoricalStripeAccounting(
  evidence: HistoricalStripeEvidence,
): HistoricalStripeResolution {
  const metadata = evidence.metadata || {};
  if (text(metadata.mana_schema) === 'mana_fund_v1' && text(metadata.fund_code)) {
    return { accounting: null, confidence: 'ALREADY_CLASSIFIED', reason: 'mana_schema+fund_code' };
  }

  if (evidence.event?.id) {
    return {
      accounting: resolveEventStripeAccounting({
        eventId: evidence.event.id,
        eventTitle: evidence.event.title,
      }),
      confidence: 'EXACT_INTERNAL',
      reason: 'event_payment→events',
    };
  }

  const donation = evidence.donation;
  if (donation) {
    if (donation.cumbre_booking_id || looksLikeCumbre(donation.source, donation.project_name, donation.event_name)) {
      return { accounting: resolveCumbreStripeAccounting(), confidence: 'EXACT_INTERNAL', reason: 'donations:cumbre' };
    }
    if (looksLikeKnownPilgrimage(donation.project_name, donation.event_name)) {
      return { accounting: knownPilgrimageAccounting(), confidence: 'EXACT_INTERNAL', reason: 'donations:peregrinacion_identificada' };
    }
    const destinations = evidence.campusDestinations || [];
    if (destinations.length || looksLikeCampus(donation.source, donation.donation_type, donation.project_name, donation.campus)) {
      return {
        accounting: resolveCampusStripeAccounting(destinations),
        confidence: 'EXACT_INTERNAL',
        reason: destinations.length ? 'donations+campus_allocations' : 'donations:campus_general',
      };
    }
    return {
      accounting: resolveDonationStripeAccounting({
        source: donation.source,
        donationType: donation.donation_type,
        projectName: donation.project_name,
      }),
      confidence: 'EXACT_INTERNAL',
      reason: 'donations:id/reference/provider_tx_id',
    };
  }

  if (metadata.cumbre_booking_id || metadata.cumbre_plan_id || looksLikeCumbre(
    metadata.source,
    metadata.payment_domain,
    metadata.event_name,
    metadata.project_name,
  )) {
    return { accounting: resolveCumbreStripeAccounting(), confidence: 'EXACT_METADATA', reason: 'metadata:cumbre' };
  }

  if (metadata.event_id && (metadata.event_name || metadata.event_payment_id || metadata.event_payment_reference)) {
    return {
      accounting: resolveEventStripeAccounting({ eventId: metadata.event_id, eventTitle: metadata.event_name }),
      confidence: 'EXACT_METADATA',
      reason: 'metadata:event',
    };
  }

  if (looksLikeKnownPilgrimage(metadata.event_name, metadata.project_name, metadata.description)) {
    return { accounting: knownPilgrimageAccounting(), confidence: 'EXACT_METADATA', reason: 'metadata:peregrinacion_identificada' };
  }

  const metadataDestinations = metadataCampusDestinations(metadata);
  if (metadataDestinations.length || metadata.campus_subscription_id || looksLikeCampus(
    metadata.source,
    metadata.payment_domain,
    metadata.project_name,
  )) {
    return {
      accounting: resolveCampusStripeAccounting(metadataDestinations),
      confidence: 'EXACT_METADATA',
      reason: metadataDestinations.length ? 'metadata:campus_destinations' : 'metadata:campus_general',
    };
  }

  const donationType = text(metadata.donation_type);
  const donationReference = text(metadata.donation_reference);
  const source = text(metadata.source);
  if (donationType || donationReference || searchText(source).includes('donation') || searchText(source).includes('primicia')) {
    return {
      accounting: resolveDonationStripeAccounting({
        source,
        donationType: donationType || 'general',
        projectName: metadata.project_name,
      }),
      confidence: 'EXACT_METADATA',
      reason: 'metadata:donation',
    };
  }

  return { accounting: null, confidence: 'UNASSIGNED', reason: 'sin evidencia contable suficiente' };
}

export function buildHistoricalStripeMetadata(params: {
  accounting: StripeAccountingDescriptor;
  currentMetadata?: Record<string, unknown>;
  productId?: string | null;
  confidence: Exclude<StripeAccountingConfidence, 'ALREADY_CLASSIFIED' | 'UNASSIGNED'>;
}): Record<string, string> {
  const currentMetadata = { ...(params.currentMetadata || {}) };
  delete currentMetadata.historical_backfill;
  delete currentMetadata.backfill_confidence;
  delete currentMetadata.stripe_product_id;
  return mergeStripeAccountingMetadata(params.accounting, {
    historical_backfill: STRIPE_ACCOUNTING_BACKFILL_VERSION,
    backfill_confidence: params.confidence,
    stripe_product_id: params.productId || '',
    ...currentMetadata,
  });
}
