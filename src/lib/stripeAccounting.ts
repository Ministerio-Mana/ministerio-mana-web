export type StripeAccountingDomain = 'DONATION' | 'PRIMICIAS' | 'CAMPUS' | 'EVENT';

export type StripeAccountingDescriptor = {
  paymentDomain: StripeAccountingDomain;
  conceptCode: 'TITHE' | 'OFFERING' | 'MISSIONS' | 'CAMPUS' | 'EVENT' | 'PILGRIMAGE' | 'GENERAL';
  conceptLabel: string;
  fundCode: string;
  fundLabel: string;
  productName: string;
  source: string;
  beneficiaryType: 'MINISTRY' | 'MISSIONARY' | 'EVENT' | 'PILGRIMAGE' | 'MULTIPLE';
  beneficiaryCode: string;
  beneficiaryLabel: string;
};

export type CampusStripeDestination = {
  slug: string;
  name: string;
};

const METADATA_KEY_MAX = 40;
const METADATA_VALUE_MAX = 500;
const METADATA_ENTRY_MAX = 50;
const ACCOUNTING_SCHEMA = 'mana_fund_v1';

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizedSearchText(value: unknown): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeCodeSegment(value: unknown, fallback = 'GENERAL'): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 80) || fallback;
}

function compactLabel(value: unknown, fallback: string, max = 120): string {
  return normalizeText(value).replace(/\s+/g, ' ').slice(0, max) || fallback;
}

function ministryFund(params: {
  paymentDomain?: StripeAccountingDomain;
  conceptCode: StripeAccountingDescriptor['conceptCode'];
  conceptLabel: string;
  fundCode: string;
  fundLabel: string;
  productName: string;
  source: string;
}): StripeAccountingDescriptor {
  return {
    paymentDomain: params.paymentDomain || 'DONATION',
    conceptCode: params.conceptCode,
    conceptLabel: compactLabel(params.conceptLabel, 'General'),
    fundCode: normalizeCodeSegment(params.fundCode),
    fundLabel: compactLabel(params.fundLabel, 'Donación general'),
    productName: compactLabel(params.productName, 'Donación · Ministerio Maná'),
    source: normalizeCodeSegment(params.source).toLowerCase(),
    beneficiaryType: 'MINISTRY',
    beneficiaryCode: 'MINISTERIO_MANA_USA',
    beneficiaryLabel: 'Ministerio Maná USA',
  };
}

export function resolveStripeDonationSource(value: unknown): 'primicias_stripe' | 'donations_form' {
  return normalizedSearchText(value).includes('primicias') ? 'primicias_stripe' : 'donations_form';
}

export function resolveDonationStripeAccounting(params: {
  source?: unknown;
  donationType?: unknown;
  projectName?: unknown;
}): StripeAccountingDescriptor {
  const source = resolveStripeDonationSource(params.source);
  const donationType = normalizedSearchText(params.donationType);
  const projectName = normalizedSearchText(params.projectName);
  const isPrimicias = source === 'primicias_stripe' || projectName.includes('primicia');
  const isTithe = donationType === 'diezmos' || projectName.includes('diezmo');

  if (isTithe) {
    return ministryFund({
      fundCode: 'DONATION_TITHE',
      conceptCode: 'TITHE',
      conceptLabel: 'Diezmos',
      fundLabel: 'Diezmos',
      productName: 'Donación · Diezmos',
      source,
    });
  }
  if (isPrimicias) {
    return ministryFund({
      paymentDomain: 'PRIMICIAS',
      conceptCode: 'OFFERING',
      conceptLabel: 'Primicias',
      fundCode: 'PRIMICIAS',
      fundLabel: 'Primicias',
      productName: 'Donación · Primicias',
      source,
    });
  }

  const knownFunds: Record<string, {
    code: string;
    conceptCode: StripeAccountingDescriptor['conceptCode'];
    label: string;
    product: string;
  }> = {
    ofrendas: { code: 'DONATION_OFFERING', conceptCode: 'OFFERING', label: 'Ofrendas', product: 'Donación · Ofrendas' },
    misiones: { code: 'DONATION_MISSIONS', conceptCode: 'MISSIONS', label: 'Misiones', product: 'Donación · Misiones' },
    campus: { code: 'CAMPUS_GENERAL', conceptCode: 'CAMPUS', label: 'Campus Maná · Fondo general', product: 'Campus Maná · Fondo general' },
    evento: { code: 'DONATION_EVENT', conceptCode: 'EVENT', label: 'Eventos · Fondo general', product: 'Donación · Eventos' },
    peregrinaciones: { code: 'DONATION_PILGRIMAGE', conceptCode: 'PILGRIMAGE', label: 'Peregrinaciones', product: 'Donación · Peregrinaciones' },
    general: { code: 'DONATION_GENERAL', conceptCode: 'GENERAL', label: 'Donación general', product: 'Donación · Fondo general' },
  };
  const selected = knownFunds[donationType] || knownFunds.general;
  return ministryFund({
    paymentDomain: donationType === 'campus' ? 'CAMPUS' : 'DONATION',
    conceptCode: selected.conceptCode,
    conceptLabel: selected.label,
    fundCode: selected.code,
    fundLabel: selected.label,
    productName: selected.product,
    source,
  });
}

export function resolveCampusStripeAccounting(destinations: CampusStripeDestination[]): StripeAccountingDescriptor {
  const safeDestinations = destinations
    .map((destination) => ({
      slug: normalizeCodeSegment(destination.slug, 'SIN_ASIGNAR'),
      name: compactLabel(destination.name, 'Sin asignar'),
    }))
    .filter((destination) => destination.slug !== 'SIN_ASIGNAR' || destination.name !== 'Sin asignar');

  if (safeDestinations.length === 1) {
    const destination = safeDestinations[0];
    return {
      paymentDomain: 'CAMPUS',
      conceptCode: 'CAMPUS',
      conceptLabel: 'Campus',
      fundCode: `CAMPUS_${destination.slug}`.slice(0, 100),
      fundLabel: `Campus Maná · ${destination.name}`.slice(0, 120),
      productName: `Campus Maná · ${destination.name}`.slice(0, 120),
      source: 'campus_checkout',
      beneficiaryType: 'MISSIONARY',
      beneficiaryCode: destination.slug,
      beneficiaryLabel: destination.name,
    };
  }

  return {
    paymentDomain: 'CAMPUS',
    conceptCode: 'CAMPUS',
    conceptLabel: 'Campus',
    fundCode: safeDestinations.length > 1 ? 'CAMPUS_SPLIT' : 'CAMPUS_GENERAL',
    fundLabel: safeDestinations.length > 1
      ? `Campus Maná · ${safeDestinations.length} asignaciones`
      : 'Campus Maná · Fondo general',
    productName: safeDestinations.length > 1
      ? 'Campus Maná · Distribución múltiple'
      : 'Campus Maná · Fondo general',
    source: 'campus_checkout',
    beneficiaryType: safeDestinations.length > 1 ? 'MULTIPLE' : 'MINISTRY',
    beneficiaryCode: safeDestinations.length > 1 ? 'MULTIPLE_MISSIONARIES' : 'MINISTERIO_MANA_USA',
    beneficiaryLabel: safeDestinations.length > 1 ? 'Múltiples misioneros Campus' : 'Ministerio Maná USA',
  };
}

export function resolveEventStripeAccounting(params: {
  eventId: unknown;
  eventTitle: unknown;
}): StripeAccountingDescriptor {
  const eventId = normalizeCodeSegment(params.eventId, 'SIN_ID');
  const eventTitle = compactLabel(params.eventTitle, 'Evento Maná');
  return {
    paymentDomain: 'EVENT',
    conceptCode: 'EVENT',
    conceptLabel: 'Eventos',
    fundCode: `EVENT_${eventId}`.slice(0, 100),
    fundLabel: `Evento · ${eventTitle}`.slice(0, 120),
    productName: `Evento · ${eventTitle}`.slice(0, 120),
    source: 'event_checkout',
    beneficiaryType: 'EVENT',
    beneficiaryCode: eventId,
    beneficiaryLabel: eventTitle,
  };
}

export function resolveCumbreStripeAccounting(): StripeAccountingDescriptor {
  return {
    paymentDomain: 'EVENT',
    conceptCode: 'EVENT',
    conceptLabel: 'Eventos',
    fundCode: 'EVENT_CUMBRE_2026',
    fundLabel: 'Evento · Cumbre Mundial 2026',
    productName: 'Evento · Cumbre Mundial 2026',
    source: 'cumbre_2026',
    beneficiaryType: 'EVENT',
    beneficiaryCode: 'CUMBRE_2026',
    beneficiaryLabel: 'Cumbre Mundial 2026',
  };
}

export function resolvePilgrimageStripeAccounting(params: {
  pilgrimageId: unknown;
  pilgrimageTitle: unknown;
}): StripeAccountingDescriptor {
  const pilgrimageId = normalizeCodeSegment(params.pilgrimageId, 'GENERAL');
  const pilgrimageTitle = compactLabel(params.pilgrimageTitle, 'Peregrinación Maná');
  return {
    paymentDomain: 'DONATION',
    conceptCode: 'PILGRIMAGE',
    conceptLabel: 'Peregrinaciones',
    fundCode: `PILGRIMAGE_${pilgrimageId}`.slice(0, 100),
    fundLabel: `Peregrinación · ${pilgrimageTitle}`.slice(0, 120),
    productName: `Peregrinación · ${pilgrimageTitle}`.slice(0, 120),
    source: 'pilgrimage_checkout',
    beneficiaryType: 'PILGRIMAGE',
    beneficiaryCode: pilgrimageId,
    beneficiaryLabel: pilgrimageTitle,
  };
}

export function getFixedStripeAccountingCatalog(): StripeAccountingDescriptor[] {
  return [
    resolveDonationStripeAccounting({ donationType: 'general' }),
    resolveDonationStripeAccounting({ donationType: 'diezmos' }),
    resolveDonationStripeAccounting({ donationType: 'ofrendas' }),
    resolveDonationStripeAccounting({ donationType: 'misiones' }),
    resolveDonationStripeAccounting({ donationType: 'evento' }),
    resolveDonationStripeAccounting({ donationType: 'peregrinaciones' }),
    resolveDonationStripeAccounting({ source: 'primicias-stripe', donationType: 'ofrendas', projectName: 'Primicias' }),
    resolveCampusStripeAccounting([]),
    resolveCumbreStripeAccounting(),
    resolvePilgrimageStripeAccounting({
      pilgrimageId: 'TURQUIA_ISLAS_GRIEGAS_2026',
      pilgrimageTitle: 'Turquía e Islas Griegas 2026',
    }),
  ];
}

export function buildStripeAccountingMetadata(accounting: StripeAccountingDescriptor): Record<string, string> {
  return {
    mana_schema: ACCOUNTING_SCHEMA,
    payment_domain: accounting.paymentDomain,
    concept_code: accounting.conceptCode,
    concept_label: accounting.conceptLabel,
    fund_code: accounting.fundCode,
    fund_label: accounting.fundLabel,
    beneficiary_type: accounting.beneficiaryType,
    beneficiary_code: accounting.beneficiaryCode,
    beneficiary_label: accounting.beneficiaryLabel,
    source: accounting.source,
  };
}

export function sanitizeStripeMetadata(...records: Array<Record<string, unknown> | undefined>): Record<string, string> {
  const output = new Map<string, string>();
  for (const record of records) {
    if (!record) continue;
    for (const [rawKey, rawValue] of Object.entries(record)) {
      const key = normalizeText(rawKey).replace(/[\[\]]/g, '_').slice(0, METADATA_KEY_MAX);
      const value = normalizeText(rawValue).slice(0, METADATA_VALUE_MAX);
      if (!key || !value) continue;
      output.set(key, value);
    }
  }
  return Object.fromEntries([...output.entries()].slice(0, METADATA_ENTRY_MAX));
}

export function mergeStripeAccountingMetadata(
  accounting: StripeAccountingDescriptor,
  extra?: Record<string, unknown>,
): Record<string, string> {
  const standard = buildStripeAccountingMetadata(accounting);
  const extraMetadata = sanitizeStripeMetadata(extra);
  for (const key of Object.keys(standard)) delete extraMetadata[key];
  return sanitizeStripeMetadata(standard, extraMetadata);
}

export function buildStripePaymentDescription(accounting: StripeAccountingDescriptor): string {
  return `Ministerio Maná · ${accounting.fundLabel}`.slice(0, 180);
}
