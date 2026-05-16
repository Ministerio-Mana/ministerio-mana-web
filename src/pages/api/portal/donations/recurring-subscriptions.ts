import type { APIRoute } from 'astro';
import { getUserFromRequest } from '@lib/supabaseAuth';
import {
  cancelStripeSubscription,
  createStripeBillingPortalSession,
  pauseStripeSubscription,
  resumeStripeSubscription,
} from '@lib/stripe';
import { voidWompiPaymentSource } from '@lib/wompi';
import { resolveBaseUrl } from '@lib/url';
import {
  getDonationRecurringSubscriptionByIdForUser,
  resolveStripeDonationPeriod,
  updateDonationRecurringSubscriptionById,
} from '@lib/donationRecurringSubscriptions';

export const prerender = false;

const ACTIONS = new Set(['pause', 'resume', 'cancel', 'manage']);

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getResumeChargeDate(subscriptionNextChargeAt?: string | null): string {
  if (subscriptionNextChargeAt) {
    const date = new Date(subscriptionNextChargeAt);
    if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) {
      return subscriptionNextChargeAt;
    }
  }
  return new Date().toISOString();
}

export const POST: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user?.id || !user.email) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Payload invalido' }, 400);
  }

  const id = String(body.id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const pauseUntil = String(body.pauseUntil || '').trim();
  if (!id || !ACTIONS.has(action)) {
    return json({ ok: false, error: 'Datos incompletos' }, 400);
  }
  if (pauseUntil && !isValidDateOnly(pauseUntil)) {
    return json({ ok: false, error: 'Usa fecha YYYY-MM-DD para la pausa' }, 400);
  }

  const subscription = await getDonationRecurringSubscriptionByIdForUser(id, user.id);
  if (!subscription) {
    return json({ ok: false, error: 'Suscripcion no encontrada' }, 404);
  }

  if (action === 'manage') {
    if (subscription.provider !== 'stripe' || !subscription.provider_customer_id) {
      return json({ ok: false, error: 'Esta donacion se gestiona desde el portal Mana.' }, 400);
    }
    const baseUrl = resolveBaseUrl(request);
    const portal = await createStripeBillingPortalSession({
      customerId: subscription.provider_customer_id,
      returnUrl: `${baseUrl}/portal?tab=resumen`,
    });
    return json({ ok: true, url: portal.url });
  }

  if (action === 'pause') {
    let period = { currentPeriodStart: null, currentPeriodEnd: null, nextChargeAt: null };
    if (subscription.provider === 'stripe' && subscription.provider_subscription_id) {
      const stripeSub = await pauseStripeSubscription({
        subscriptionId: subscription.provider_subscription_id,
        pauseUntil: pauseUntil || null,
      });
      period = resolveStripeDonationPeriod(stripeSub);
    }

    const updated = await updateDonationRecurringSubscriptionById(subscription.id, {
      status: 'PAUSED',
      paused_at: new Date().toISOString(),
      pause_until: pauseUntil ? new Date(`${pauseUntil}T23:59:59Z`).toISOString() : null,
      current_period_start: period.currentPeriodStart,
      current_period_end: period.currentPeriodEnd,
      next_charge_at: pauseUntil ? new Date(`${pauseUntil}T23:59:59Z`).toISOString() : null,
    });
    return json({ ok: true, subscription: updated });
  }

  if (action === 'resume') {
    let period = { currentPeriodStart: null, currentPeriodEnd: null, nextChargeAt: null };
    if (subscription.provider === 'stripe' && subscription.provider_subscription_id) {
      const stripeSub = await resumeStripeSubscription(subscription.provider_subscription_id);
      period = resolveStripeDonationPeriod(stripeSub);
    }
    if (
      subscription.provider === 'wompi'
      && !subscription.provider_payment_source_id
      && !subscription.provider_payment_method_id
    ) {
      return json({ ok: false, error: 'Esta donacion todavia no tiene fuente de pago automatica en Wompi.' }, 400);
    }
    const nextChargeAt = subscription.provider === 'wompi'
      ? getResumeChargeDate(subscription.next_charge_at)
      : period.nextChargeAt || subscription.next_charge_at;

    const updated = await updateDonationRecurringSubscriptionById(subscription.id, {
      status: 'ACTIVE',
      paused_at: null,
      pause_until: null,
      current_period_start: period.currentPeriodStart,
      current_period_end: period.currentPeriodEnd,
      next_charge_at: nextChargeAt,
      last_charge_error: null,
    });
    return json({ ok: true, subscription: updated });
  }

  if (action === 'cancel') {
    let rawProviderData: unknown = null;
    if (subscription.provider === 'stripe' && subscription.provider_subscription_id) {
      rawProviderData = await cancelStripeSubscription(subscription.provider_subscription_id);
    }
    if (subscription.provider === 'wompi') {
      const sourceId = subscription.provider_payment_source_id || subscription.provider_payment_method_id;
      if (sourceId) {
        rawProviderData = await voidWompiPaymentSource(sourceId);
      }
    }
    const updated = await updateDonationRecurringSubscriptionById(subscription.id, {
      status: 'CANCELLED',
      canceled_at: new Date().toISOString(),
      cancel_reason: 'Cancelado por el donante desde el portal',
      next_charge_at: null,
      provider_payment_source_id: subscription.provider === 'wompi' ? null : subscription.provider_payment_source_id,
      provider_payment_method_id: subscription.provider === 'wompi' ? null : subscription.provider_payment_method_id,
      raw_provider_data: rawProviderData,
    });
    return json({ ok: true, subscription: updated });
  }

  return json({ ok: false, error: 'Accion no soportada' }, 400);
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
