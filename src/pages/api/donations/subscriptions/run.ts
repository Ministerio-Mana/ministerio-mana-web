import type { APIRoute } from 'astro';
import { buildDonationReference, createDonation, getDonationById, updateDonationById } from '@lib/donationsStore';
import { createWompiCharge } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';
import { logSecurityEvent } from '@lib/securityEvents';
import { isCronRequestAuthorized } from '@lib/cronAuth';
import {
  addDonationFrequencyIso,
  claimDueWompiDonationRecurringSubscription,
  listDueWompiDonationRecurringSubscriptions,
  listPendingSetupWompiDonationRecurringSubscriptions,
  updateDonationRecurringSubscriptionById,
  type DonationRecurringRecord,
} from '@lib/donationRecurringSubscriptions';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function validateCron(request: Request): boolean {
  return isCronRequestAuthorized(request, {
    secrets: [
      env('DONATION_SUBSCRIPTION_CRON_SECRET'),
      env('DONATION_REMINDER_CRON_SECRET'),
      env('CAMPUS_CRON_SECRET'),
      env('CRON_SECRET'),
    ],
    production: isProduction(),
  });
}

function normalizeWompiStatus(status: string | null | undefined): 'PENDING' | 'APPROVED' | 'FAILED' {
  const value = String(status || '').toUpperCase();
  if (value === 'APPROVED') return 'APPROVED';
  if (['DECLINED', 'VOIDED', 'ERROR', 'FAILED'].includes(value)) return 'FAILED';
  return 'PENDING';
}

function buildProjectName(subscription: DonationRecurringRecord): string {
  return subscription.project_name || subscription.event_name || 'Donacion recurrente';
}

export const POST: APIRoute = async ({ request }) => {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'donations.subscriptions.run',
      detail: 'Cron secret invalido',
    });
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const pendingSetup = await listPendingSetupWompiDonationRecurringSubscriptions({ limit: 50 });
  const due = await listDueWompiDonationRecurringSubscriptions({ nowIso, limit: 50 });
  let reconciled = 0;
  let processed = 0;
  let charged = 0;
  let skipped = 0;
  let errors = 0;

  for (const subscription of pendingSetup) {
    if (!subscription.last_donation_id) {
      skipped += 1;
      continue;
    }

    const donation = await getDonationById(subscription.last_donation_id);
    const rawEvent: any = donation?.raw_event || null;
    const transaction = rawEvent?.data?.transaction || null;
    if (!transaction || String(transaction?.status || '').toUpperCase() !== 'APPROVED') {
      skipped += 1;
      continue;
    }

    try {
      const result = await processWompiDonationTransaction({ event: rawEvent, transaction });
      if (result.processed && result.status === 'APPROVED') {
        reconciled += 1;
      } else {
        skipped += 1;
      }
    } catch (error: any) {
      errors += 1;
      await updateDonationRecurringSubscriptionById(subscription.id, {
        last_charge_error: error?.message || 'No se pudo reconciliar la fuente Wompi',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'donations.subscriptions.reconcile',
        detail: error?.message || 'No se pudo reconciliar la fuente Wompi',
        meta: { donationSubscriptionId: subscription.id, donationId: subscription.last_donation_id },
      });
    }
  }

  for (const subscription of due) {
    processed += 1;
    const paymentSourceId = subscription.provider_payment_source_id || subscription.provider_payment_method_id;
    const amount = Number(subscription.amount || 0);

    if (subscription.currency !== 'COP' || !amount || amount <= 0) {
      skipped += 1;
      continue;
    }

    if (!paymentSourceId) {
      skipped += 1;
      await updateDonationRecurringSubscriptionById(subscription.id, {
        status: 'PENDING_SETUP',
        last_charge_status: 'SKIPPED',
        last_charge_error: 'Sin fuente de pago Wompi para cobro automatico',
      });
      continue;
    }

    const reference = buildDonationReference();
    const claimedSubscription = await claimDueWompiDonationRecurringSubscription({
      id: subscription.id,
      nowIso,
      reference,
      scheduledAtIso: nowIso,
    });

    if (!claimedSubscription) {
      skipped += 1;
      continue;
    }

    let donation;
    try {
      donation = await createDonation({
        provider: 'wompi',
        status: 'PENDING',
        amount,
        currency: 'COP',
        reference,
        provider_tx_id: null,
        payment_method: 'CARD',
        donation_type: claimedSubscription.donation_type || 'general',
        project_name: buildProjectName(claimedSubscription),
        event_name: claimedSubscription.event_name || 'Donaciones Mana',
        campus: claimedSubscription.campus || '',
        church: claimedSubscription.church || '',
        church_city: claimedSubscription.donor_city || '',
        donor_name: claimedSubscription.donor_name || '',
        donor_email: claimedSubscription.donor_email,
        donor_phone: claimedSubscription.donor_phone || '',
        donor_document_type: claimedSubscription.donor_document_type || '',
        donor_document_number: claimedSubscription.donor_document_number || '',
        is_recurring: true,
        donor_country: claimedSubscription.donor_country || 'CO',
        donor_city: claimedSubscription.donor_city || '',
        donation_description: claimedSubscription.donation_description || 'Donacion recurrente Ministerio Mana',
        need_certificate: Boolean(claimedSubscription.need_certificate),
        source: 'donaciones-recurrentes-wompi',
        cumbre_booking_id: null,
        raw_event: {
          donationSubscriptionId: claimedSubscription.id,
          scheduledAt: nowIso,
          frequency: claimedSubscription.frequency,
        },
      });
    } catch (error: any) {
      errors += 1;
      await updateDonationRecurringSubscriptionById(claimedSubscription.id, {
        status: 'ACTIVE',
        provider_reference: null,
        last_charge_status: 'FAILED',
        last_charge_error: error?.message || 'No se pudo crear la donacion recurrente',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'donations.subscriptions.prepare',
        detail: error?.message || 'No se pudo crear la donacion recurrente',
        meta: { donationSubscriptionId: claimedSubscription.id, reference },
      });
      continue;
    }

    await updateDonationRecurringSubscriptionById(claimedSubscription.id, {
      last_donation_id: donation.id,
      raw_provider_data: {
        scheduledAt: nowIso,
        reference,
        donationId: donation.id,
      },
    });

    try {
      const tx = await createWompiCharge({
        amountInCents: Math.round(amount * 100),
        currency: 'COP',
        reference,
        customerEmail: claimedSubscription.donor_email,
        paymentSourceId,
        recurrent: true,
      });
      const status = normalizeWompiStatus(tx?.status);
      await updateDonationById({
        donationId: donation.id,
        status,
        providerTxId: tx?.id ?? null,
        paymentMethod: 'CARD',
        rawEvent: tx,
      });

      if (status === 'APPROVED') {
        const nextChargeAt = addDonationFrequencyIso(now, claimedSubscription.frequency);
        await updateDonationRecurringSubscriptionById(claimedSubscription.id, {
          status: 'ACTIVE',
          current_period_start: nowIso,
          current_period_end: nextChargeAt,
          next_charge_at: nextChargeAt,
          last_charge_status: 'APPROVED',
          last_charge_error: null,
          raw_provider_data: tx,
        });
      } else if (status === 'FAILED') {
        await updateDonationRecurringSubscriptionById(claimedSubscription.id, {
          status: 'PAYMENT_FAILED',
          next_charge_at: null,
          last_charge_status: 'FAILED',
          last_charge_error: 'Wompi recurring charge failed',
          raw_provider_data: tx,
        });
      }

      charged += 1;
    } catch (error: any) {
      errors += 1;
      await updateDonationById({
        donationId: donation.id,
        status: 'FAILED',
        providerTxId: null,
        paymentMethod: 'CARD',
        rawEvent: { error: error?.message || 'Wompi recurring charge failed' },
      });
      await updateDonationRecurringSubscriptionById(claimedSubscription.id, {
        status: 'PAYMENT_FAILED',
        next_charge_at: null,
        last_charge_status: 'FAILED',
        last_charge_error: error?.message || 'Wompi recurring charge failed',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'donations.subscriptions.run',
        detail: error?.message || 'Wompi recurring charge failed',
        meta: { donationSubscriptionId: claimedSubscription.id, reference },
      });
    }
  }

  return json({ ok: true, reconciled, processed, charged, skipped, errors });
};

export const GET = POST;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
