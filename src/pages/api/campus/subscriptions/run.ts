import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { buildDonationReference, createDonation, getDonationById, updateDonationById } from '@lib/donationsStore';
import { createWompiCharge } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';
import { logSecurityEvent } from '@lib/securityEvents';
import {
  claimDueWompiCampusSubscription,
  listDueWompiCampusSubscriptions,
  listPendingSetupWompiCampusSubscriptions,
  updateCampusSubscriptionById,
  type CampusSubscriptionAllocationInput,
  type CampusSubscriptionRecord,
} from '@lib/campusSubscriptions';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function getCampusCronSecrets(): string[] {
  return Array.from(new Set([
    env('CAMPUS_CRON_SECRET'),
    env('CRON_SECRET'),
  ].filter((value): value is string => Boolean(value))));
}

function matchesSecret(value: string | null | undefined, secrets: string[]): boolean {
  if (!value) return false;
  const candidate = Buffer.from(value);
  return secrets.some((secret) => {
    const expected = Buffer.from(secret);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

function validateCron(request: Request): boolean {
  const secrets = getCampusCronSecrets();
  if (!secrets.length) return !isProduction();

  const header = request.headers.get('x-cron-secret');
  if (matchesSecret(header, secrets)) return true;

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (matchesSecret(bearerToken, secrets)) return true;
  }

  return false;
}

function addMonthsIso(date = new Date(), months = 1): string {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() < day) {
    next.setUTCDate(0);
  }
  return next.toISOString();
}

function normalizeWompiStatus(status: string | null | undefined): 'PENDING' | 'APPROVED' | 'FAILED' {
  const value = String(status || '').toUpperCase();
  if (value === 'APPROVED') return 'APPROVED';
  if (['DECLINED', 'VOIDED', 'ERROR', 'FAILED'].includes(value)) return 'FAILED';
  return 'PENDING';
}

function getAllocations(subscription: CampusSubscriptionRecord): CampusSubscriptionAllocationInput[] {
  return Array.isArray(subscription.allocations) ? subscription.allocations : [];
}

function getMissionaryName(allocations: CampusSubscriptionAllocationInput[]): string | null {
  if (allocations.length === 1) return allocations[0].missionary_name || null;
  const names = allocations.map((allocation) => allocation.missionary_name).filter(Boolean);
  return names.length ? names.join(', ') : null;
}

function getProjectName(allocations: CampusSubscriptionAllocationInput[]): string {
  const slugs = allocations.map((allocation) => allocation.missionary_slug).filter(Boolean);
  return slugs.length ? `campus-multi:${slugs.join(',')}` : 'Campus Maná';
}

export const POST: APIRoute = async ({ request }) => {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'campus.subscriptions.run',
      detail: 'Cron secret invalido',
    });
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const pendingSetup = await listPendingSetupWompiCampusSubscriptions({ limit: 50 });
  const due = await listDueWompiCampusSubscriptions({ nowIso, limit: 50 });
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
      await updateCampusSubscriptionById(subscription.id, {
        last_charge_error: error?.message || 'No se pudo reconciliar la fuente Wompi',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'campus.subscriptions.reconcile',
        detail: error?.message || 'No se pudo reconciliar la fuente Wompi',
        meta: { campusSubscriptionId: subscription.id, donationId: subscription.last_donation_id },
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
      await updateCampusSubscriptionById(subscription.id, {
        status: 'PENDING_SETUP',
        last_charge_status: 'SKIPPED',
        last_charge_error: 'Sin fuente de pago Wompi para cobro automatico',
      });
      continue;
    }

    const reference = buildDonationReference({ domain: 'CAMPUS' });
    const claimedSubscription = await claimDueWompiCampusSubscription({
      id: subscription.id,
      nowIso,
      reference,
      scheduledAtIso: nowIso,
    });

    if (!claimedSubscription) {
      skipped += 1;
      continue;
    }

    const allocations = getAllocations(claimedSubscription);
    const missionaryName = getMissionaryName(allocations);

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
        donation_type: 'campus',
        project_name: getProjectName(allocations),
        event_name: 'Campus Maná',
        campus: 'Campus Maná',
        church: '',
        church_city: claimedSubscription.donor_city || '',
        donor_name: claimedSubscription.donor_name || '',
        donor_email: claimedSubscription.donor_email,
        donor_phone: claimedSubscription.donor_phone || '',
        donor_document_type: claimedSubscription.donor_document_type || '',
        donor_document_number: claimedSubscription.donor_document_number || '',
        is_recurring: true,
        donor_country: claimedSubscription.donor_country || 'CO',
        donor_city: claimedSubscription.donor_city || '',
        donation_description: 'Siembra mensual Campus Mana',
        need_certificate: false,
        source: 'campus-recurring-wompi',
        cumbre_booking_id: null,
        missionary_id: allocations.length === 1 ? allocations[0].missionary_id || null : null,
        missionary_name: missionaryName,
        raw_event: {
          campusSubscriptionId: claimedSubscription.id,
          scheduledAt: nowIso,
          allocations,
        },
      });
    } catch (error: any) {
      errors += 1;
      await updateCampusSubscriptionById(claimedSubscription.id, {
        status: 'ACTIVE',
        provider_reference: null,
        last_charge_status: 'FAILED',
        last_charge_error: error?.message || 'No se pudo crear la donacion recurrente Campus',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'campus.subscriptions.prepare',
        detail: error?.message || 'No se pudo crear la donacion recurrente Campus',
        meta: { campusSubscriptionId: claimedSubscription.id, reference },
      });
      continue;
    }

    await updateCampusSubscriptionById(claimedSubscription.id, {
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
        const nextChargeAt = addMonthsIso(now, 1);
        await updateCampusSubscriptionById(claimedSubscription.id, {
          status: 'ACTIVE',
          current_period_start: nowIso,
          current_period_end: nextChargeAt,
          next_charge_at: nextChargeAt,
          last_charge_status: 'APPROVED',
          last_charge_error: null,
          raw_provider_data: tx,
        });
      } else if (status === 'FAILED') {
        await updateCampusSubscriptionById(claimedSubscription.id, {
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
      await updateCampusSubscriptionById(claimedSubscription.id, {
        status: 'PAYMENT_FAILED',
        next_charge_at: null,
        last_charge_status: 'FAILED',
        last_charge_error: error?.message || 'Wompi recurring charge failed',
      });
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'campus.subscriptions.run',
        detail: error?.message || 'Wompi recurring charge failed',
        meta: { campusSubscriptionId: claimedSubscription.id, reference },
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
