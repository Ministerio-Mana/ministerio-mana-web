import { createWompiPaymentSource } from './wompi';
import { logSecurityEvent } from './securityEvents';
import { updateDonationByReference } from './donationsStore';
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

export async function processWompiDonationTransaction(params: {
  event: any;
  transaction: any;
}): Promise<{ processed: boolean; reference: string | null; status: WompiDonationStatus | null }> {
  const { event, transaction } = params;
  const reference = transaction?.reference ? String(transaction.reference) : null;
  if (!reference) return { processed: false, reference: null, status: null };

  const status = normalizeWompiDonationStatus(transaction?.status);
  const paymentMethodType = transaction?.payment_method?.type ?? transaction?.payment_method_type ?? null;
  const paymentMethodToken = transaction?.payment_method?.token ?? null;
  const paymentSourceId = transaction?.payment_source_id ?? null;

  await updateDonationByReference({
    provider: 'wompi',
    reference,
    status,
    providerTxId: transaction?.id ? String(transaction.id) : null,
    paymentMethod: paymentMethodType ? String(paymentMethodType) : null,
    rawEvent: event,
  });

  const donationSubscription = await getDonationRecurringSubscriptionByProviderReference('wompi', reference).catch(() => null);
  if (donationSubscription) {
    await processDonationRecurringWompiSource({
      event,
      reference,
      status,
      paymentMethodType,
      paymentMethodToken,
      paymentSourceId,
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
      subscription: campusSubscription,
    });
  }

  return { processed: true, reference, status };
}

async function processDonationRecurringWompiSource(params: {
  event: any;
  reference: string;
  status: WompiDonationStatus;
  paymentMethodType: unknown;
  paymentMethodToken: unknown;
  paymentSourceId: unknown;
  subscription: DonationRecurringRecord;
}): Promise<void> {
  const {
    event,
    reference,
    status,
    paymentMethodType,
    paymentMethodToken,
    paymentSourceId,
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
        detail: sourceError,
        meta: { donationSubscriptionId: subscription.id, reference },
      });
    }
  }

  const periodStart = new Date();
  const periodEnd = addDonationFrequencyIso(periodStart, subscription.frequency);
  await updateDonationRecurringSubscriptionById(subscription.id, {
    status: status === 'APPROVED'
      ? sourceId ? 'ACTIVE' : 'PENDING_SETUP'
      : status === 'FAILED'
        ? 'PAYMENT_FAILED'
        : subscription.status,
    provider_payment_source_id: sourceId || subscription.provider_payment_source_id,
    provider_payment_method_id: sourceId || subscription.provider_payment_method_id,
    current_period_start: status === 'APPROVED' ? periodStart.toISOString() : subscription.current_period_start,
    current_period_end: status === 'APPROVED' ? periodEnd : subscription.current_period_end,
    next_charge_at: status === 'APPROVED' && sourceId ? periodEnd : status === 'FAILED' ? null : subscription.next_charge_at,
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
  subscription: CampusSubscriptionRecord;
}): Promise<void> {
  const {
    event,
    reference,
    status,
    paymentMethodType,
    paymentMethodToken,
    paymentSourceId,
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
        detail: sourceError,
        meta: { campusSubscriptionId: subscription.id, reference },
      });
    }
  }

  const periodStart = new Date();
  const periodEnd = addMonthsIso(periodStart, 1);
  await updateCampusSubscriptionById(subscription.id, {
    status: status === 'APPROVED'
      ? sourceId ? 'ACTIVE' : 'PENDING_SETUP'
      : status === 'FAILED'
        ? 'PAYMENT_FAILED'
        : subscription.status,
    provider_payment_source_id: sourceId || subscription.provider_payment_source_id,
    provider_payment_method_id: sourceId || subscription.provider_payment_method_id,
    current_period_start: status === 'APPROVED' ? periodStart.toISOString() : subscription.current_period_start,
    current_period_end: status === 'APPROVED' ? periodEnd : subscription.current_period_end,
    next_charge_at: status === 'APPROVED' && sourceId ? periodEnd : status === 'FAILED' ? null : subscription.next_charge_at,
    last_charge_status: status,
    last_charge_error: status === 'FAILED'
      ? 'Wompi payment failed'
      : sourceId
        ? null
        : sourceError || 'Pago aprobado, falta activar fuente de pago automatica Wompi',
    raw_provider_data: event,
  });
}
