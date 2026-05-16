import { supabaseAdmin } from './supabaseAdmin';

function ensureSupabase() {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }
  return supabaseAdmin;
}

export type CampusSubscriptionStatus =
  | 'PENDING'
  | 'PENDING_SETUP'
  | 'ACTIVE'
  | 'PAUSED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED'
  | 'INCOMPLETE';

export type CampusSubscriptionAllocationInput = {
  missionary_slug: string;
  missionary_name: string;
  missionary_id?: string | null;
  amount: number;
  currency: 'COP' | 'USD';
};

export type CampusSubscriptionRecord = {
  id: string;
  user_id: string;
  status: CampusSubscriptionStatus | string;
  provider: 'wompi' | 'stripe';
  amount: number;
  currency: 'COP' | 'USD';
  frequency: 'monthly';
  donor_name: string | null;
  donor_email: string;
  donor_phone: string | null;
  donor_document_type: string | null;
  donor_document_number: string | null;
  donor_city: string | null;
  donor_country: string | null;
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
  allocations?: CampusSubscriptionAllocationInput[];
  created_at: string;
  updated_at: string;
};

function missingCampusTable(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || message.includes('campus_donation_subscriptions');
}

function toIsoFromUnix(value: unknown): string | null {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function resolveStripePeriod(subscription: any): {
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

export async function createCampusSubscription(params: {
  userId: string;
  status: CampusSubscriptionStatus;
  provider: 'wompi' | 'stripe';
  amount: number;
  currency: 'COP' | 'USD';
  donorName: string;
  donorEmail: string;
  donorPhone?: string | null;
  donorDocumentType?: string | null;
  donorDocumentNumber?: string | null;
  donorCity?: string | null;
  donorCountry?: string | null;
  providerCustomerId?: string | null;
  providerReference?: string | null;
  lastDonationId?: string | null;
  nextChargeAt?: string | null;
  metadata?: Record<string, unknown>;
  allocations: CampusSubscriptionAllocationInput[];
}): Promise<CampusSubscriptionRecord> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .insert({
      user_id: params.userId,
      status: params.status,
      provider: params.provider,
      amount: params.amount,
      currency: params.currency,
      donor_name: params.donorName,
      donor_email: params.donorEmail,
      donor_phone: params.donorPhone ?? null,
      donor_document_type: params.donorDocumentType ?? null,
      donor_document_number: params.donorDocumentNumber ?? null,
      donor_city: params.donorCity ?? null,
      donor_country: params.donorCountry ?? null,
      provider_customer_id: params.providerCustomerId ?? null,
      provider_reference: params.providerReference ?? null,
      last_donation_id: params.lastDonationId ?? null,
      next_charge_at: params.nextChargeAt ?? null,
      metadata: params.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    if (missingCampusTable(error)) {
      throw new Error('Falta ejecutar el SQL de suscripciones Campus en Supabase.');
    }
    throw new Error('No se pudo crear la suscripcion Campus.');
  }

  if (params.allocations.length > 0) {
    const { error: allocationError } = await supabase
      .from('campus_donation_subscription_allocations')
      .insert(params.allocations.map((allocation) => ({
        subscription_id: data.id,
        missionary_slug: allocation.missionary_slug,
        missionary_name: allocation.missionary_name,
        missionary_id: allocation.missionary_id ?? null,
        amount: allocation.amount,
        currency: allocation.currency,
      })));
    if (allocationError) {
      await supabase.from('campus_donation_subscriptions').delete().eq('id', data.id);
      throw new Error('No se pudieron crear las asignaciones de la suscripcion Campus.');
    }
  }

  return data as CampusSubscriptionRecord;
}

export async function getCampusSubscriptionByIdForUser(
  id: string,
  userId: string,
): Promise<CampusSubscriptionRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .select('*, allocations:campus_donation_subscription_allocations(*)')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (missingCampusTable(error)) {
      throw new Error('Falta ejecutar el SQL de suscripciones Campus en Supabase.');
    }
    throw new Error('No se pudo cargar la suscripcion Campus.');
  }
  return data as CampusSubscriptionRecord | null;
}

export async function getCampusSubscriptionByProviderSubscription(
  provider: 'stripe' | 'wompi',
  providerSubscriptionId: string,
): Promise<CampusSubscriptionRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .select('*, allocations:campus_donation_subscription_allocations(*)')
    .eq('provider', provider)
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle();
  if (error) {
    if (missingCampusTable(error)) return null;
    throw new Error('No se pudo cargar la suscripcion Campus.');
  }
  return data as CampusSubscriptionRecord | null;
}

export async function updateCampusSubscriptionById(
  id: string,
  updates: Partial<CampusSubscriptionRecord>,
): Promise<CampusSubscriptionRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (missingCampusTable(error)) {
      throw new Error('Falta ejecutar el SQL de suscripciones Campus en Supabase.');
    }
    throw new Error('No se pudo actualizar la suscripcion Campus.');
  }
  return data as CampusSubscriptionRecord | null;
}

export async function updateCampusSubscriptionByProviderSubscription(params: {
  provider: 'stripe' | 'wompi';
  providerSubscriptionId: string;
  updates: Partial<CampusSubscriptionRecord>;
}): Promise<CampusSubscriptionRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .update({
      ...params.updates,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', params.provider)
    .eq('provider_subscription_id', params.providerSubscriptionId)
    .select('*')
    .maybeSingle();
  if (error) {
    if (missingCampusTable(error)) return null;
    throw new Error('No se pudo actualizar la suscripcion Campus.');
  }
  return data as CampusSubscriptionRecord | null;
}

export async function getCampusSubscriptionByProviderReference(
  provider: 'stripe' | 'wompi',
  providerReference: string,
): Promise<CampusSubscriptionRecord | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .select('*, allocations:campus_donation_subscription_allocations(*)')
    .eq('provider', provider)
    .eq('provider_reference', providerReference)
    .maybeSingle();
  if (error) {
    if (missingCampusTable(error)) return null;
    throw new Error('No se pudo cargar la suscripcion Campus.');
  }
  return data as CampusSubscriptionRecord | null;
}

export async function listDueWompiCampusSubscriptions(params: {
  nowIso: string;
  limit?: number;
}): Promise<CampusSubscriptionRecord[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .select('*, allocations:campus_donation_subscription_allocations(*)')
    .eq('provider', 'wompi')
    .eq('status', 'ACTIVE')
    .lte('next_charge_at', params.nowIso)
    .order('next_charge_at', { ascending: true })
    .limit(params.limit ?? 50);
  if (error) {
    if (missingCampusTable(error)) {
      throw new Error('Falta ejecutar el SQL de suscripciones Campus en Supabase.');
    }
    throw new Error('No se pudieron cargar las suscripciones Campus vencidas.');
  }
  return (data ?? []) as CampusSubscriptionRecord[];
}

export async function listPendingSetupWompiCampusSubscriptions(params?: {
  limit?: number;
}): Promise<CampusSubscriptionRecord[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('campus_donation_subscriptions')
    .select('*, allocations:campus_donation_subscription_allocations(*)')
    .eq('provider', 'wompi')
    .eq('status', 'PENDING_SETUP')
    .not('last_donation_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(params?.limit ?? 50);
  if (error) {
    if (missingCampusTable(error)) {
      throw new Error('Falta ejecutar el SQL de suscripciones Campus en Supabase.');
    }
    throw new Error('No se pudieron cargar las suscripciones Campus pendientes de activacion.');
  }
  return (data ?? []) as CampusSubscriptionRecord[];
}
