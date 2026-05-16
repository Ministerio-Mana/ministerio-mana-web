import { supabaseAdmin } from './supabaseAdmin';

function ensureSupabase() {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }
  return supabaseAdmin;
}

export type DonationRecurringStatus =
  | 'PENDING'
  | 'PENDING_SETUP'
  | 'ACTIVE'
  | 'PAUSED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED'
  | 'INCOMPLETE';

export type DonationFrequency =
  | 'biweekly'
  | 'monthly'
  | 'every_two_months'
  | 'semiannual'
  | 'annual';

export type DonationRecurringRecord = {
  id: string;
  user_id: string;
  status: DonationRecurringStatus | string;
  provider: 'wompi' | 'stripe';
  amount: number;
  currency: 'COP' | 'USD';
  frequency: DonationFrequency | string;
  donation_type: string | null;
  project_name: string | null;
  event_name: string | null;
  campus: string | null;
  church: string | null;
  donor_name: string | null;
  donor_email: string;
  donor_phone: string | null;
  donor_document_type: string | null;
  donor_document_number: string | null;
  donor_city: string | null;
  donor_country: string | null;
  donation_description: string | null;
  need_certificate: boolean | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_payment_source_id: string | null;
  provider_payment_method_id: string | null;
  provider_reference: string | null;
  last_donation_id: string | null;
  next_charge_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  paused_at: string | null;
  pause_until: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  last_charge_status: string | null;
  last_charge_error: string | null;
  metadata: Record<string, unknown> | null;
  raw_provider_data: unknown;
  created_at: string;
  updated_at: string;
};

export type DonationFrequencyConfig = {
  value: DonationFrequency;
  label: string;
  stripeInterval: 'week' | 'month' | 'year';
  stripeIntervalCount: number;
  months?: number;
  weeks?: number;
};

export const DONATION_FREQUENCY_CONFIG: Record<DonationFrequency, DonationFrequencyConfig> = {
  biweekly: {
    value: 'biweekly',
    label: 'Cada 15 dias',
    stripeInterval: 'week',
    stripeIntervalCount: 2,
    weeks: 2,
  },
  monthly: {
    value: 'monthly',
    label: 'Cada mes',
    stripeInterval: 'month',
    stripeIntervalCount: 1,
    months: 1,
  },
  every_two_months: {
    value: 'every_two_months',
    label: 'Cada dos meses',
    stripeInterval: 'month',
    stripeIntervalCount: 2,
    months: 2,
  },
  semiannual: {
    value: 'semiannual',
    label: 'Cada semestre',
    stripeInterval: 'month',
    stripeIntervalCount: 6,
    months: 6,
  },
  annual: {
    value: 'annual',
    label: 'Cada ano',
    stripeInterval: 'year',
    stripeIntervalCount: 1,
    months: 12,
  },
};

function missingRecurringTable(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || message.includes('donation_recurring_subscriptions');
}

function toIsoFromUnix(value: unknown): string | null {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function parseDonationFrequency(raw: unknown): DonationFrequencyConfig {
  const value = String(raw || 'monthly').trim().toLowerCase();
  if (value in DONATION_FREQUENCY_CONFIG) {
    return DONATION_FREQUENCY_CONFIG[value as DonationFrequency];
  }
  return DONATION_FREQUENCY_CONFIG.monthly;
}

export function addDonationFrequencyIso(date = new Date(), frequencyRaw: unknown = 'monthly'): string {
  const config = parseDonationFrequency(frequencyRaw);
  const next = new Date(date.getTime());

  if (config.weeks) {
    next.setUTCDate(next.getUTCDate() + config.weeks * 7);
    return next.toISOString();
  }

  const months = config.months ?? 1;
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() < day) {
    next.setUTCDate(0);
  }
  return next.toISOString();
}

export function resolveStripeDonationPeriod(subscription: any): {
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
} {
  const currentPeriodStart = toIsoFromUnix(subscription?.current_period_start);
  const currentPeriodEnd = toIsoFromUnix(subscription?.current_period_end);
  return {
    currentPeriodStart,
    currentPeriodEnd,
    nextChargeAt: currentPeriodEnd,
  };
}

export async function createDonationRecurringSubscription(params: {
  userId: string;
  status: DonationRecurringStatus;
  provider: 'wompi' | 'stripe';
  amount: number;
  currency: 'COP' | 'USD';
  frequency: DonationFrequency;
  donationType?: string | null;
  projectName?: string | null;
  eventName?: string | null;
  campus?: string | null;
  church?: string | null;
  donorName: string;
  donorEmail: string;
  donorPhone?: string | null;
  donorDocumentType?: string | null;
  donorDocumentNumber?: string | null;
  donorCity?: string | null;
  donorCountry?: string | null;
  donationDescription?: string | null;
  needCertificate?: boolean | null;
  providerCustomerId?: string | null;
  providerReference?: string | null;
  lastDonationId?: string | null;
  nextChargeAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<DonationRecurringRecord> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .insert({
      user_id: params.userId,
      status: params.status,
      provider: params.provider,
      amount: params.amount,
      currency: params.currency,
      frequency: params.frequency,
      donation_type: params.donationType ?? null,
      project_name: params.projectName ?? null,
      event_name: params.eventName ?? null,
      campus: params.campus ?? null,
      church: params.church ?? null,
      donor_name: params.donorName,
      donor_email: params.donorEmail,
      donor_phone: params.donorPhone ?? null,
      donor_document_type: params.donorDocumentType ?? null,
      donor_document_number: params.donorDocumentNumber ?? null,
      donor_city: params.donorCity ?? null,
      donor_country: params.donorCountry ?? null,
      donation_description: params.donationDescription ?? null,
      need_certificate: params.needCertificate ?? false,
      provider_customer_id: params.providerCustomerId ?? null,
      provider_reference: params.providerReference ?? null,
      last_donation_id: params.lastDonationId ?? null,
      next_charge_at: params.nextChargeAt ?? null,
      metadata: params.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    if (missingRecurringTable(error)) {
      throw new Error('Falta ejecutar docs/sql/donation_recurring_subscriptions.sql en Supabase.');
    }
    throw new Error('No se pudo crear la suscripcion recurrente.');
  }

  return data as DonationRecurringRecord;
}

export async function getDonationRecurringSubscriptionByIdForUser(
  id: string,
  userId: string,
): Promise<DonationRecurringRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (missingRecurringTable(error)) {
      throw new Error('Falta ejecutar docs/sql/donation_recurring_subscriptions.sql en Supabase.');
    }
    throw new Error('No se pudo cargar la suscripcion recurrente.');
  }
  return data as DonationRecurringRecord | null;
}

export async function getDonationRecurringSubscriptionByProviderSubscription(
  provider: 'stripe' | 'wompi',
  providerSubscriptionId: string,
): Promise<DonationRecurringRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .select('*')
    .eq('provider', provider)
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle();
  if (error) {
    if (missingRecurringTable(error)) return null;
    throw new Error('No se pudo cargar la suscripcion recurrente.');
  }
  return data as DonationRecurringRecord | null;
}

export async function getDonationRecurringSubscriptionByProviderReference(
  provider: 'stripe' | 'wompi',
  providerReference: string,
): Promise<DonationRecurringRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .select('*')
    .eq('provider', provider)
    .eq('provider_reference', providerReference)
    .maybeSingle();
  if (error) {
    if (missingRecurringTable(error)) return null;
    throw new Error('No se pudo cargar la suscripcion recurrente.');
  }
  return data as DonationRecurringRecord | null;
}

export async function updateDonationRecurringSubscriptionById(
  id: string,
  updates: Partial<DonationRecurringRecord>,
): Promise<DonationRecurringRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (missingRecurringTable(error)) {
      throw new Error('Falta ejecutar docs/sql/donation_recurring_subscriptions.sql en Supabase.');
    }
    throw new Error('No se pudo actualizar la suscripcion recurrente.');
  }
  return data as DonationRecurringRecord | null;
}

export async function updateDonationRecurringSubscriptionByProviderSubscription(params: {
  provider: 'stripe' | 'wompi';
  providerSubscriptionId: string;
  updates: Partial<DonationRecurringRecord>;
}): Promise<DonationRecurringRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .update({
      ...params.updates,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', params.provider)
    .eq('provider_subscription_id', params.providerSubscriptionId)
    .select('*')
    .maybeSingle();
  if (error) {
    if (missingRecurringTable(error)) return null;
    throw new Error('No se pudo actualizar la suscripcion recurrente.');
  }
  return data as DonationRecurringRecord | null;
}

export async function listDueWompiDonationRecurringSubscriptions(params: {
  nowIso: string;
  limit?: number;
}): Promise<DonationRecurringRecord[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .select('*')
    .eq('provider', 'wompi')
    .eq('status', 'ACTIVE')
    .lte('next_charge_at', params.nowIso)
    .order('next_charge_at', { ascending: true })
    .limit(params.limit ?? 50);
  if (error) {
    if (missingRecurringTable(error)) {
      throw new Error('Falta ejecutar docs/sql/donation_recurring_subscriptions.sql en Supabase.');
    }
    throw new Error('No se pudieron cargar las suscripciones vencidas.');
  }
  return (data ?? []) as DonationRecurringRecord[];
}

export async function listPendingSetupWompiDonationRecurringSubscriptions(params?: {
  limit?: number;
}): Promise<DonationRecurringRecord[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_recurring_subscriptions')
    .select('*')
    .eq('provider', 'wompi')
    .eq('status', 'PENDING_SETUP')
    .not('last_donation_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(params?.limit ?? 50);
  if (error) {
    if (missingRecurringTable(error)) {
      throw new Error('Falta ejecutar docs/sql/donation_recurring_subscriptions.sql en Supabase.');
    }
    throw new Error('No se pudieron cargar suscripciones pendientes.');
  }
  return (data ?? []) as DonationRecurringRecord[];
}
