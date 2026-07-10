import { createWompiPaymentSource } from './wompi';
import { logSecurityEvent } from './securityEvents';
import {
  getDonationByReference,
  updateDonationByReference,
  type DonationRecord,
} from './donationsStore';
import {
  addDonationFrequencyIso,
  getDonationRecurringSubscriptionByProviderReference,
  updateDonationRecurringSubscriptionById,
  type DonationRecurringRecord,
} from './donationRecurringSubscriptions';
import {
  getCampusSubscriptionByProviderReference,
  updateCampusSubscriptionById,
  type CampusSubscriptionRecord,
} from './campusSubscriptions';

type WompiDonationStatus = 'PENDING' | 'APPROVED' | 'FAILED';

export type WompiDonationProcessResult = {
  processed: boolean;
  reference: string | null;
  status: WompiDonationStatus | null;
  outcome: 'PROCESSED' | 'IGNORED' | 'REJECTED';
  reason?: string;
};

function addMonthsIso(date = new Date(), months = 1): string {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() < day) {
    next.setUTCDate(0);
  }
  return next.toISOString();
}

function normalizeWompiDonationStatus(statusRaw: unknown): WompiDonationStatus {
  const status = String(statusRaw || '').toUpperCase();
  if (status === 'APPROVED') return 'APPROVED';
  if (['DECLINED', 'VOIDED', 'ERROR', 'FAILED'].includes(status)) return 'FAILED';
  return 'PENDING';
}

function expectedAmountInCents(donation: DonationRecord): number | null {
  const amount = Number(donation.amount);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

export function validateWompiTransactionMatchesDonation(params: {
  transaction: any;
  donation: DonationRecord;
}): { ok: true } | { ok: false; reason: string; detail: Record<string, unknown> } {
  const expectedReference = String(params.donation.reference || '').trim();
  const transactionReference = String(params.transaction?.reference || '').trim();
  if (!expectedReference || transactionReference !== expectedReference) {
    return {
      ok: false,
      reason: 'REFERENCE_MISMATCH',
      detail: { expectedReference, transactionReference: transactionReference || null },
    };
  }

  const expectedCurrency = String(params.donation.currency || '').trim().toUpperCase();
  const transactionCurrency = String(params.transaction?.currency || '').trim().toUpperCase();
  if (!expectedCurrency || transactionCurrency !== expectedCurrency) {
    return {
      ok: false,
      reason: 'CURRENCY_MISMATCH',
      detail: { expectedCurrency, transactionCurrency: transactionCurrency || null },
    };
  }

  const expectedAmount = expectedAmountInCents(params.donation);
  const transactionAmount = Number(params.transaction?.amount_in_cents);
  if (
    expectedAmount == null
    || !Number.isFinite(transactionAmount)
    || Math.round(transactionAmount) !== expectedAmount
  ) {
    return {
      ok: false,
      reason: 'AMOUNT_MISMATCH',
      detail: {
        expectedAmountInCents: expectedAmount,
        transactionAmountInCents: Number.isFinite(transactionAmount) ? Math.round(transactionAmount) : null,
      },
    };
  }
  return { ok: true };
}

function resolveEffectiveStatus(
  currentStatus: WompiDonationStatus,
  incomingStatus: WompiDonationStatus,
): WompiDonationStatus {
  if (incomingStatus === 'PENDING' && currentStatus !== 'PENDING') {
    return currentStatus;
  }
  return incomingStatus;
}

function resolveTransactionDate(transaction: any, event: any): Date {
  const candidates = [transaction?.finalized_at, transaction?.created_at, event?.sent_at];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const eventTimestamp = Number(event?.timestamp);
  if (Number.isFinite(eventTimestamp) && eventTimestamp > 0) {
    const milliseconds = eventTimestamp < 1_000_000_000_000 ? eventTimestamp * 1_000 : eventTimestamp;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export async function processWompiDonationTransaction(params: {
  event: any;
  transaction: any;
}): Promise<WompiDonationProcessResult> {
  const { event, transaction } = params;
  const reference = transaction?.reference ? String(transaction.reference) : null;
  if (!reference) {
    return { processed: false, reference: null, status: null, outcome: 'IGNORED', reason: 'REFERENCE_MISSING' };
  }

  const donation = await getDonationByReference('wompi', reference);
  if (!donation) {
    return { processed: false, reference, status: null, outcome: 'IGNORED', reason: 'DONATION_NOT_FOUND' };
  }

  const match = validateWompiTransactionMatchesDonation({ transaction, donation });
  if (!match.ok) {
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'wompi.transaction-mismatch',
      detail: match.reason,
      meta: {
        reference,
        transactionId: transaction?.id ? String(transaction.id) : null,
        ...match.detail,
      },
    });
    return {
      processed: false,
      reference,
      status: donation.status,
      outcome: 'REJECTED',
      reason: match.reason,
    };
  }

  const incomingStatus = normalizeWompiDonationStatus(transaction?.status);
  const status = resolveEffectiveStatus(donation.status, incomingStatus);
  const paymentMethodType = transaction?.payment_method?.type ?? transaction?.payment_method_type ?? null;
  const paymentMethodToken = transaction?.payment_method?.token ?? null;
  const paymentSourceId = transaction?.payment_source_id ?? null;
  const transactionDate = resolveTransactionDate(transaction, event);

  const updatedRows = await updateDonationByReference({
    provider: 'wompi',
    reference,
    status,
    providerTxId: transaction?.id ? String(transaction.id) : null,
    paymentMethod: paymentMethodType ? String(paymentMethodType) : null,
    rawEvent: event,
  });
  if (updatedRows !== 1) {
    throw new Error(`Actualizacion Wompi ambigua para ${reference}: ${updatedRows} donaciones`);
  }

  const donationSubscription = await getDonationRecurringSubscriptionByProviderReference('wompi', reference).catch(() => null);
  if (donationSubscription) {
    await processDonationRecurringWompiSource({
      event,
      reference,
      status,
      paymentMethodType,
      paymentMethodToken,
      paymentSourceId,
      transactionDate,
      subscription: donationSubscription,
    });
  }

  const campusSubscription = await getCampusSubscriptionByProviderReference('wompi', reference).catch(() => null);
  if (campusSubscription) {
    await processCampusRecurringWompiSource({
      event,
      reference,
      status,
      paymentMethodType,
      paymentMethodToken,
      paymentSourceId,
      transactionDate,
      subscription: campusSubscription,
    });
  }

  return { processed: true, reference, status, outcome: 'PROCESSED' };
}

async function processDonationRecurringWompiSource(params: {
  event: any;
  reference: string;
  status: WompiDonationStatus;
  paymentMethodType: unknown;
  paymentMethodToken: unknown;
  paymentSourceId: unknown;
  transactionDate: Date;
  subscription: DonationRecurringRecord;
}): Promise<void> {
  const {
    event,
    reference,
    status,
    paymentMethodType,
    paymentMethodToken,
    paymentSourceId,
    transactionDate,
    subscription,
  } = params;
  let sourceId = subscription.provider_payment_source_id || subscription.provider_payment_method_id || null;
  let sourceError: string | null = null;

  if (status === 'APPROVED' && paymentSourceId) {
    sourceId = String(paymentSourceId);
  } else if (
    status === 'APPROVED'
    && !sourceId
    && String(paymentMethodType || '').toUpperCase() === 'CARD'
    && paymentMethodToken
    && subscription.donor_email
  ) {
    try {
      sourceId = await createWompiPaymentSource({
        token: String(paymentMethodToken),
        customerEmail: subscription.donor_email,
      });
    } catch (error: any) {
      sourceError = error?.message || 'No se pudo crear fuente de pago Wompi';
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'donations.wompi.payment-source',
        detail: sourceError || undefined,
        meta: { donationSubscriptionId: subscription.id, reference },
      });
    }
  }

  const shouldAdvancePeriod = status === 'APPROVED' && subscription.last_charge_status !== 'APPROVED';
  const periodStart = transactionDate;
  const periodEnd = shouldAdvancePeriod
    ? addDonationFrequencyIso(periodStart, subscription.frequency)
    : subscription.current_period_end;
  await updateDonationRecurringSubscriptionById(subscription.id, {
    status: status === 'APPROVED'
      ? sourceId ? 'ACTIVE' : 'PENDING_SETUP'
      : status === 'FAILED'
        ? 'PAYMENT_FAILED'
        : subscription.status,
    provider_payment_source_id: sourceId || subscription.provider_payment_source_id,
    provider_payment_method_id: sourceId || subscription.provider_payment_method_id,
    current_period_start: shouldAdvancePeriod ? periodStart.toISOString() : subscription.current_period_start,
    current_period_end: shouldAdvancePeriod ? periodEnd : subscription.current_period_end,
    next_charge_at: status === 'APPROVED' && sourceId
      ? periodEnd || subscription.next_charge_at
      : status === 'FAILED'
        ? null
        : subscription.next_charge_at,
    last_charge_status: status,
    last_charge_error: status === 'FAILED'
      ? 'Wompi payment failed'
      : sourceId
        ? null
        : sourceError || 'Pago aprobado, falta activar fuente de pago automatica Wompi',
    raw_provider_data: event,
  });
}

async function processCampusRecurringWompiSource(params: {
  event: any;
  reference: string;
  status: WompiDonationStatus;
  paymentMethodType: unknown;
  paymentMethodToken: unknown;
  paymentSourceId: unknown;
  transactionDate: Date;
  subscription: CampusSubscriptionRecord;
}): Promise<void> {
  const {
    event,
    reference,
    status,
    paymentMethodType,
    paymentMethodToken,
    paymentSourceId,
    transactionDate,
    subscription,
  } = params;
  let sourceId = subscription.provider_payment_source_id || subscription.provider_payment_method_id || null;
  let sourceError: string | null = null;

  if (status === 'APPROVED' && paymentSourceId) {
    sourceId = String(paymentSourceId);
  } else if (
    status === 'APPROVED'
    && !sourceId
    && String(paymentMethodType || '').toUpperCase() === 'CARD'
    && paymentMethodToken
    && subscription.donor_email
  ) {
    try {
      sourceId = await createWompiPaymentSource({
        token: String(paymentMethodToken),
        customerEmail: subscription.donor_email,
      });
    } catch (error: any) {
      sourceError = error?.message || 'No se pudo crear fuente de pago Wompi';
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'campus.wompi.payment-source',
        detail: sourceError || undefined,
        meta: { campusSubscriptionId: subscription.id, reference },
      });
    }
  }

  const shouldAdvancePeriod = status === 'APPROVED' && subscription.last_charge_status !== 'APPROVED';
  const periodStart = transactionDate;
  const periodEnd = shouldAdvancePeriod ? addMonthsIso(periodStart, 1) : subscription.current_period_end;
  await updateCampusSubscriptionById(subscription.id, {
    status: status === 'APPROVED'
      ? sourceId ? 'ACTIVE' : 'PENDING_SETUP'
      : status === 'FAILED'
        ? 'PAYMENT_FAILED'
        : subscription.status,
    provider_payment_source_id: sourceId || subscription.provider_payment_source_id,
    provider_payment_method_id: sourceId || subscription.provider_payment_method_id,
    current_period_start: shouldAdvancePeriod ? periodStart.toISOString() : subscription.current_period_start,
    current_period_end: shouldAdvancePeriod ? periodEnd : subscription.current_period_end,
    next_charge_at: status === 'APPROVED' && sourceId
      ? periodEnd || subscription.next_charge_at
      : status === 'FAILED'
        ? null
        : subscription.next_charge_at,
    last_charge_status: status,
    last_charge_error: status === 'FAILED'
      ? 'Wompi payment failed'
      : sourceId
        ? null
        : sourceError || 'Pago aprobado, falta activar fuente de pago automatica Wompi',
    raw_provider_data: event,
  });
}
