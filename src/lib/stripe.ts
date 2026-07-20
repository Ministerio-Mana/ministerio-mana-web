import Stripe from 'stripe';
import {
  buildStripeAccountingMetadata,
  buildStripePaymentDescription,
  mergeStripeAccountingMetadata,
  type StripeAccountingDescriptor,
} from './stripeAccounting';

const API_VERSION = '2023-10-16' as Stripe.StripeConfig['apiVersion'];

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
const fundProductCache = new Map<string, Promise<string | null>>();
const ZERO_DECIMAL_CURRENCIES = new Set(['CLP']);

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
  accounting: StripeAccountingDescriptor;
  lineItems?: StripeSessionLineItem[];
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  clientReferenceId?: string;
  idempotencyKey?: string;
  allowPromotionCodes?: boolean;
  expiresAt?: number;
  customerEmail?: string;
  customerId?: string;
}

export interface StripeSessionLineItem {
  amount: number;
  description?: string;
  accounting: StripeAccountingDescriptor;
}

function amountToMinor(amount: number, currency: string): number {
  const normalizedCurrency = String(currency || '').toUpperCase();
  return Math.round(Number(amount || 0) * (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 1 : 100));
}

function checkoutSubmitType(accounting: StripeAccountingDescriptor): 'donate' | 'pay' {
  return accounting.paymentDomain === 'EVENT' ? 'pay' : 'donate';
}

async function findOrCreateFundProduct(
  stripe: Stripe,
  accounting: StripeAccountingDescriptor,
): Promise<string | null> {
  const cached = fundProductCache.get(accounting.fundCode);
  if (cached) return cached;

  const lookup = (async () => {
    try {
      const existing = await stripe.products.search({
        query: `active:'true' AND metadata['mana_fund_code']:'${accounting.fundCode}'`,
        limit: 1,
      });
      if (existing.data[0]?.id) return existing.data[0].id;

      const product = await stripe.products.create({
        name: accounting.productName,
        description: `Fondo contable · ${accounting.fundLabel}`.slice(0, 500),
        metadata: {
          ...buildStripeAccountingMetadata(accounting),
          mana_fund_code: accounting.fundCode,
        },
      }, {
        idempotencyKey: `mana-fund-product-v1:${accounting.fundCode}`,
      });
      return product.id;
    } catch (error) {
      console.error('[stripe.accounting] fund product resolution failed', {
        fundCode: accounting.fundCode,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  fundProductCache.set(accounting.fundCode, lookup);
  const productId = await lookup;
  if (!productId) fundProductCache.delete(accounting.fundCode);
  return productId;
}

async function buildStripeLineItems(params: {
  stripe: Stripe;
  amount: number;
  currency: string;
  description: string;
  accounting: StripeAccountingDescriptor;
  lineItems?: StripeSessionLineItem[];
  recurring?: { interval: 'month' | 'week' | 'year'; intervalCount: number };
}): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
  const items = params.lineItems?.length
    ? params.lineItems
    : [{ amount: params.amount, description: params.description, accounting: params.accounting }];
  const expectedMinor = amountToMinor(params.amount, params.currency);
  const actualMinor = items.reduce((sum, item) => sum + amountToMinor(item.amount, params.currency), 0);
  if (actualMinor !== expectedMinor || actualMinor <= 0) {
    throw new Error('El desglose contable de Stripe no coincide con el total del pago.');
  }

  return Promise.all(items.map(async (item) => {
    const unitAmount = amountToMinor(item.amount, params.currency);
    if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
      throw new Error('El monto de un fondo de Stripe no es válido.');
    }
    const productId = await findOrCreateFundProduct(params.stripe, item.accounting);
    const recurring = params.recurring
      ? {
          recurring: {
            interval: params.recurring.interval,
            interval_count: params.recurring.intervalCount,
          },
        }
      : {};
    const product = productId
      ? { product: productId }
      : {
          product_data: {
            name: item.accounting.productName,
            description: `Fondo contable · ${item.accounting.fundLabel}`.slice(0, 500),
            metadata: {
              ...buildStripeAccountingMetadata(item.accounting),
              mana_fund_code: item.accounting.fundCode,
            },
          },
        };
    return {
      quantity: 1,
      price_data: {
        currency: params.currency.toLowerCase(),
        unit_amount: unitAmount,
        ...recurring,
        ...product,
      },
    } as Stripe.Checkout.SessionCreateParams.LineItem;
  }));
}

export async function createStripeDonationSession(params: StripeSessionParams): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const metadata = mergeStripeAccountingMetadata(params.accounting, params.metadata);
  const lineItems = await buildStripeLineItems({
    stripe,
    amount: params.amountUsd,
    currency: params.currency,
    description: params.description,
    accounting: params.accounting,
    lineItems: params.lineItems,
  });
  const customerParams = params.customerId
    ? { customer: params.customerId }
    : params.customerEmail
      ? { customer_email: params.customerEmail }
      : {};

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    submit_type: checkoutSubmitType(params.accounting),
    allow_promotion_codes: params.allowPromotionCodes ?? true,
    expires_at: params.expiresAt,
    metadata,
    client_reference_id: params.clientReferenceId,
    payment_intent_data: {
      description: buildStripePaymentDescription(params.accounting),
      metadata,
    },
    ...customerParams,
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
}

export async function createStripeInstallmentSession(params: {
  amount: number;
  currency: string;
  description: string;
  accounting: StripeAccountingDescriptor;
  lineItems?: StripeSessionLineItem[];
  interval: 'month' | 'week' | 'year';
  intervalCount: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  customerEmail?: string;
  customerId?: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  const metadata = mergeStripeAccountingMetadata(params.accounting, params.metadata);
  const lineItems = await buildStripeLineItems({
    stripe,
    amount: params.amount,
    currency: params.currency,
    description: params.description,
    accounting: params.accounting,
    lineItems: params.lineItems,
    recurring: { interval: params.interval, intervalCount: params.intervalCount },
  });
  const customerParams = params.customerId
    ? { customer: params.customerId }
    : params.customerEmail
      ? { customer_email: params.customerEmail }
      : {};

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    currency: params.currency.toLowerCase(),
    submit_type: checkoutSubmitType(params.accounting),
    allow_promotion_codes: true,
    metadata,
    ...customerParams,
    line_items: lineItems,
    subscription_data: {
      metadata,
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
