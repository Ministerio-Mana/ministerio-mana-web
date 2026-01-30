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
  customerEmail?: string;
}

export async function createStripeDonationSession(params: StripeSessionParams): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const amountInMinor = Math.round(params.amountUsd * 100);

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    allow_promotion_codes: true,
    metadata: params.metadata,
    customer_email: params.customerEmail,
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
  });
}

export async function createStripeInstallmentSession(params: {
  amount: number;
  currency: string;
  description: string;
  interval: 'month' | 'week';
  intervalCount: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const amountInMinor = Math.round(params.amount * 100);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    allow_promotion_codes: true,
    metadata: params.metadata,
    customer_email: params.customerEmail,
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

export function verifyStripeWebhook(payload: string, signature: string | null): Stripe.Event {
  if (!signature) {
    throw new Error('Stripe-Signature ausente');
  }
  const webhookSecret = getWebhookSecret();
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
