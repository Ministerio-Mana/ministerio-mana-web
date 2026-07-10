import Stripe from 'stripe';

const API_VERSION: Stripe.StripeConfig['apiVersion'] = '2023-10-16';

function getSecret(): string {
  const secret = import.meta.env?.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error('STRIPE_SECRET_KEY no está configurado');
  }
  return secret;
}

function getWebhookSecret(): string {
  const secret = import.meta.env?.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET no está configurado');
  }
  return secret;
}

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) {
    client = new Stripe(getSecret(), { apiVersion: API_VERSION });
  }
  return client;
}

export interface StripeSessionParams {
  amountUsd: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  clientReferenceId?: string;
  idempotencyKey?: string;
  allowPromotionCodes?: boolean;
  customerEmail?: string;
  customerId?: string;
}

export async function createStripeDonationSession(params: StripeSessionParams): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const amountInMinor = Math.round(params.amountUsd * 100);
  const customerParams = params.customerId
    ? { customer: params.customerId }
    : params.customerEmail
      ? { customer_email: params.customerEmail }
      : {};

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    allow_promotion_codes: params.allowPromotionCodes ?? true,
    metadata: params.metadata,
    client_reference_id: params.clientReferenceId,
    payment_intent_data: params.metadata ? { metadata: params.metadata } : undefined,
    ...customerParams,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: amountInMinor,
          product_data: {
            name: params.description,
          },
        },
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
}

export async function createStripeInstallmentSession(params: {
  amount: number;
  currency: string;
  description: string;
  interval: 'month' | 'week' | 'year';
  intervalCount: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  customerId?: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const amountInMinor = Math.round(params.amount * 100);
  const customerParams = params.customerId
    ? { customer: params.customerId }
    : params.customerEmail
      ? { customer_email: params.customerEmail }
      : {};

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    allow_promotion_codes: true,
    metadata: params.metadata,
    ...customerParams,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: amountInMinor,
          recurring: {
            interval: params.interval,
            interval_count: params.intervalCount,
          },
          product_data: {
            name: params.description,
          },
        },
      },
    ],
    subscription_data: {
      metadata: params.metadata,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export async function createStripeCustomer(params: {
  email: string;
  name?: string | null;
  metadata?: Record<string, string>;
}): Promise<Stripe.Customer> {
  const stripe = getStripeClient();
  return stripe.customers.create({
    email: params.email,
    name: params.name || undefined,
    metadata: params.metadata,
  });
}

export async function createStripeBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripeClient();
  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export async function pauseStripeSubscription(params: {
  subscriptionId: string;
  pauseUntil?: string | null;
}): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  const resumesAt = params.pauseUntil
    ? Math.floor(new Date(`${params.pauseUntil}T23:59:59Z`).getTime() / 1000)
    : undefined;
  return stripe.subscriptions.update(params.subscriptionId, {
    pause_collection: {
      behavior: 'void',
      ...(resumesAt && Number.isFinite(resumesAt) ? { resumes_at: resumesAt } : {}),
    },
  });
}

export async function resumeStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    pause_collection: null,
  });
}

export async function cancelStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.cancel(subscriptionId);
}

export function verifyStripeWebhook(payload: string, signature: string | null): Stripe.Event {
  if (!signature) {
    throw new Error('Stripe-Signature ausente');
  }
  const webhookSecret = getWebhookSecret();
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
