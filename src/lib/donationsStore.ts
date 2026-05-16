import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin';

export type DonationStatus = 'PENDING' | 'APPROVED' | 'FAILED';
export type DonationDomain = 'CUMBRE' | 'CAMPUS' | 'PRIMICIAS' | 'DONATION' | 'OTHER';

export type DonationRecord = {
  id: string;
  provider: string;
  status: DonationStatus;
  amount: number;
  currency: string;
  reference: string | null;
  provider_tx_id: string | null;
  payment_method: string | null;
  donation_type: string | null;
  project_name: string | null;
  event_name: string | null;
  campus: string | null;
  church: string | null;
  church_city: string | null;
  donor_name: string | null;
  donor_email: string | null;
  donor_phone: string | null;
  donor_document_type: string | null;
  donor_document_number: string | null;
  is_recurring: boolean | null;
  donor_country: string | null;
  donor_city: string | null;
  donation_description: string | null;
  need_certificate: boolean | null;
  source: string | null;
  cumbre_booking_id: string | null;
  concept_code?: string | null;
  concept_label?: string | null;
  payment_domain?: DonationDomain | string | null;
  church_id?: string | null;
  user_id?: string | null;
  missionary_id?: string | null;
  missionary_name?: string | null;
  raw_event?: unknown;
};

function ensureSupabase() {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }
  return supabaseAdmin;
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function normalizePrefix(raw: string | undefined, fallback: string): string {
  return (raw || fallback).replace(/[^A-Z0-9_-]/gi, '').toUpperCase() || fallback;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function getDefaultPrefixForDomain(domain: DonationDomain): string {
  if (domain === 'CUMBRE') {
    return normalizePrefix(env('DONATION_REFERENCE_PREFIX_CUMBRE') || env('CUMBRE_REFERENCE_PREFIX'), 'CUM');
  }
  if (domain === 'CAMPUS') {
    return normalizePrefix(env('DONATION_REFERENCE_PREFIX_CAMPUS'), 'CAMP');
  }
  if (domain === 'PRIMICIAS') {
    return normalizePrefix(env('DONATION_REFERENCE_PREFIX_PRIMICIAS'), 'PRI');
  }
  if (domain === 'OTHER') {
    return normalizePrefix(env('DONATION_REFERENCE_PREFIX_OTHER') || env('DONATION_REFERENCE_PREFIX'), 'DON');
  }
  return normalizePrefix(env('DONATION_REFERENCE_PREFIX'), 'DON');
}

function resolveDonationClassification(payload: Omit<DonationRecord, 'id'>): {
  paymentDomain: DonationDomain;
  conceptCode: string;
  conceptLabel: string;
} {
  const source = normalizeText(payload.source);
  const donationType = normalizeText(payload.donation_type);
  const projectName = normalizeText(payload.project_name);
  const eventName = normalizeText(payload.event_name);
  const reference = normalizeText(payload.reference);

  const isCumbre =
    Boolean(payload.cumbre_booking_id) ||
    source.includes('cumbre') ||
    source === 'portal-iglesia' ||
    source === 'portal-iglesia-edit' ||
    projectName.includes('cumbre') ||
    eventName.includes('cumbre') ||
    reference.startsWith('mm-evt-cm26');
  if (isCumbre) {
    return { paymentDomain: 'CUMBRE', conceptCode: 'EVENT', conceptLabel: 'Eventos' };
  }

  if (donationType === 'campus' || source.includes('campus')) {
    return { paymentDomain: 'CAMPUS', conceptCode: 'CAMPUS', conceptLabel: 'Campus' };
  }

  if (donationType === 'primicias' || source.includes('primicias')) {
    return { paymentDomain: 'PRIMICIAS', conceptCode: 'OFFERING', conceptLabel: 'Ofrendas' };
  }

  if (donationType === 'diezmos') {
    return { paymentDomain: 'DONATION', conceptCode: 'TITHE', conceptLabel: 'Diezmos' };
  }
  if (donationType === 'ofrendas') {
    return { paymentDomain: 'DONATION', conceptCode: 'OFFERING', conceptLabel: 'Ofrendas' };
  }
  if (donationType === 'misiones') {
    return { paymentDomain: 'DONATION', conceptCode: 'MISSIONS', conceptLabel: 'Misiones' };
  }
  if (donationType === 'peregrinaciones') {
    return { paymentDomain: 'DONATION', conceptCode: 'PILGRIMAGE', conceptLabel: 'Peregrinaciones' };
  }
  if (donationType === 'evento') {
    return { paymentDomain: 'DONATION', conceptCode: 'EVENT', conceptLabel: 'Eventos' };
  }
  if (donationType === 'general') {
    return { paymentDomain: 'DONATION', conceptCode: 'GENERAL', conceptLabel: 'General' };
  }

  return { paymentDomain: 'OTHER', conceptCode: 'OTHER', conceptLabel: 'Otros' };
}

function isMissingColumnError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '').trim();
  const message = String(error.message || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

export function buildDonationReference(options?: {
  domain?: DonationDomain;
  prefix?: string;
}): string {
  const domain = options?.domain ?? 'DONATION';
  const prefix = normalizePrefix(options?.prefix, getDefaultPrefixForDomain(domain));
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${Date.now()}-${rand}`;
}

export async function createDonation(payload: Omit<DonationRecord, 'id'>): Promise<DonationRecord> {
  const supabase = ensureSupabase();
  const classification = resolveDonationClassification(payload);
  const donationInsert = {
    provider: payload.provider,
    status: payload.status,
    amount: payload.amount,
    currency: payload.currency,
    reference: payload.reference,
    provider_tx_id: payload.provider_tx_id ?? null,
    payment_method: payload.payment_method ?? null,
    donation_type: payload.donation_type ?? null,
    project_name: payload.project_name ?? null,
    event_name: payload.event_name ?? null,
    campus: payload.campus ?? null,
    church: payload.church ?? null,
    church_city: payload.church_city ?? null,
    donor_name: payload.donor_name ?? null,
    donor_email: payload.donor_email ?? null,
    donor_phone: payload.donor_phone ?? null,
    donor_document_type: payload.donor_document_type ?? null,
    donor_document_number: payload.donor_document_number ?? null,
    is_recurring: payload.is_recurring ?? null,
    donor_country: payload.donor_country ?? null,
    donor_city: payload.donor_city ?? null,
    donation_description: payload.donation_description ?? null,
    need_certificate: payload.need_certificate ?? null,
    source: payload.source ?? null,
    cumbre_booking_id: payload.cumbre_booking_id ?? null,
    raw_event: payload.raw_event ?? null,
  };
  const enrichedDonationInsert = {
    ...donationInsert,
    concept_code: payload.concept_code ?? classification.conceptCode,
    concept_label: payload.concept_label ?? classification.conceptLabel,
    payment_domain: payload.payment_domain ?? classification.paymentDomain,
    church_id: payload.church_id ?? null,
    user_id: payload.user_id ?? null,
    missionary_id: payload.missionary_id ?? null,
    missionary_name: payload.missionary_name ?? null,
  };

  let { data, error } = await supabase
    .from('donations')
    .insert(enrichedDonationInsert)
    .select('*')
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from('donations')
      .insert(donationInsert)
      .select('*')
      .single());
  }

  if (error || !data) {
    throw new Error('No se pudo crear la donacion');
  }

  return data as DonationRecord;
}

export async function updateDonationByReference(params: {
  provider: string;
  reference: string;
  status?: DonationStatus;
  providerTxId?: string | null;
  paymentMethod?: string | null;
  rawEvent?: unknown;
}): Promise<void> {
  const supabase = ensureSupabase();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (params.status) updates.status = params.status;
  if (params.providerTxId !== undefined) updates.provider_tx_id = params.providerTxId;
  if (params.paymentMethod !== undefined) updates.payment_method = params.paymentMethod;
  if (params.rawEvent !== undefined) updates.raw_event = params.rawEvent;

  const { error } = await supabase
    .from('donations')
    .update(updates)
    .eq('provider', params.provider)
    .eq('reference', params.reference);

  if (error) {
    throw new Error('No se pudo actualizar la donacion');
  }
}

export async function updateDonationById(params: {
  donationId: string;
  status?: DonationStatus;
  providerTxId?: string | null;
  paymentMethod?: string | null;
  rawEvent?: unknown;
}): Promise<void> {
  const supabase = ensureSupabase();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (params.status) updates.status = params.status;
  if (params.providerTxId !== undefined) updates.provider_tx_id = params.providerTxId;
  if (params.paymentMethod !== undefined) updates.payment_method = params.paymentMethod;
  if (params.rawEvent !== undefined) updates.raw_event = params.rawEvent;

  const { error } = await supabase
    .from('donations')
    .update(updates)
    .eq('id', params.donationId);

  if (error) {
    throw new Error('No se pudo actualizar la donacion');
  }
}

export async function getDonationById(id: string): Promise<DonationRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[donations] lookup by id error', error);
    return null;
  }
  return data as DonationRecord | null;
}

export async function getDonationByReference(provider: string, reference: string): Promise<DonationRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donations')
    .select('*')
    .eq('provider', provider)
    .eq('reference', reference)
    .maybeSingle();

  if (error) {
    console.error('[donations] lookup error', error);
    return null;
  }
  return data as DonationRecord | null;
}
