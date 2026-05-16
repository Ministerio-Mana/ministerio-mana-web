import type { APIRoute } from 'astro';
import { buildDonationReference, createDonation, getDonationById, updateDonationById } from '@lib/donationsStore';
import { createWompiCharge } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';
import { logSecurityEvent } from '@lib/securityEvents';
import {
  addDonationFrequencyIso,
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

function getCronSecrets(): string[] {
  return [
    env('DONATION_SUBSCRIPTION_CRON_SECRET'),
    env('DONATION_REMINDER_CRON_SECRET'),
    env('CAMPUS_CRON_SECRET'),
    env('CRON_SECRET'),
  ].filter((value): value is string => Boolean(value));
}

function validateCron(request: Request): boolean {
  const secrets = getCronSecrets();
  if (!secrets.length) return !isProduction();

  const header = request.headers.get('x-cron-secret');
  if (header && secrets.includes(header)) return true;

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (secrets.includes(bearerToken)) return true;
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && secrets.includes(token));
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
  const pendingSetup = await listPendingSetupWompiDonationRecurringSubscriptions({ limit: 50 });
  const due = await listDueWompiDonationRecurringSubscriptions({ nowIso: now.toISOString(), limit: 50 });
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
    const donation = await createDonation({
      provider: 'wompi',
      status: 'PENDING',
      amount,
      currency: 'COP',
      reference,
      provider_tx_id: null,
      payment_method: 'CARD',
      donation_type: subscription.donation_type || 'general',
      project_name: buildProjectName(subscription),
      event_name: subscription.event_name || 'Donaciones Mana',
      campus: subscription.campus || '',
      church: subscription.church || '',
      church_city: subscription.donor_city || '',
      donor_name: subscription.donor_name || '',
      donor_email: subscription.donor_email,
      donor_phone: subscription.donor_phone || '',
      donor_document_type: subscription.donor_document_type || '',
      donor_document_number: subscription.donor_document_number || '',
      is_recurring: true,
      donor_country: subscription.donor_country || 'CO',
      donor_city: subscription.donor_city || '',
      donation_description: subscription.donation_description || 'Donacion recurrente Ministerio Mana',
      need_certificate: Boolean(subscription.need_certificate),
      source: 'donaciones-recurrentes-wompi',
      cumbre_booking_id: null,
      raw_event: {
        donationSubscriptionId: subscription.id,
        scheduledAt: now.toISOString(),
        frequency: subscription.frequency,
      },
    });

    await updateDonationRecurringSubscriptionById(subscription.id, {
      status: 'PENDING',
      provider_reference: reference,
      last_donation_id: donation.id,
      last_charge_status: 'PENDING',
      last_charge_error: null,
      raw_provider_data: {
        scheduledAt: now.toISOString(),
        reference,
      },
    });

    try {
      const tx = await createWompiCharge({
        amountInCents: Math.round(amount * 100),
        currency: 'COP',
        reference,
        customerEmail: subscription.donor_email,
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
        const nextChargeAt = addDonationFrequencyIso(now, subscription.frequency);
        await updateDonationRecurringSubscriptionById(subscription.id, {
          status: 'ACTIVE',
          current_period_start: now.toISOString(),
          current_period_end: nextChargeAt,
          next_charge_at: nextChargeAt,
          last_charge_status: 'APPROVED',
          last_charge_error: null,
          raw_provider_data: tx,
        });
      } else if (status === 'FAILED') {
        await updateDonationRecurringSubscriptionById(subscription.id, {
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
      await updateDonationRecurringSubscriptionById(subscription.id, {
        status: 'PAYMENT_FAILED',
        next_charge_at: null,
        last_charge_status: 'FAILED',
        last_charge_error: error?.message || 'Wompi recurring charge failed',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'donations.subscriptions.run',
        detail: error?.message || 'Wompi recurring charge failed',
        meta: { donationSubscriptionId: subscription.id, reference },
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
