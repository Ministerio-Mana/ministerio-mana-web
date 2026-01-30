import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin';

export type DonationStatus = 'PENDING' | 'APPROVED' | 'FAILED';

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
  donor_country: string | null;
  donor_city: string | null;
  source: string | null;
  cumbre_booking_id: string | null;
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

export function buildDonationReference(): string {
  const prefixRaw = env('DONATION_REFERENCE_PREFIX') || 'DON';
  const prefix = prefixRaw.replace(/[^A-Z0-9_-]/gi, '').toUpperCase() || 'DON';
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${Date.now()}-${rand}`;
}

export async function createDonation(payload: Omit<DonationRecord, 'id'>): Promise<DonationRecord> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donations')
    .insert({
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
      donor_country: payload.donor_country ?? null,
      donor_city: payload.donor_city ?? null,
      source: payload.source ?? null,
      cumbre_booking_id: payload.cumbre_booking_id ?? null,
      raw_event: payload.raw_event ?? null,
    })
    .select('*')
    .single();

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
