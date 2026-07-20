import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { MISIONEROS } from '@data/misioneros';
import { isCronRequestAuthorized } from '@lib/cronAuth';
import {
  buildStripePaymentDescription,
  getFixedStripeAccountingCatalog,
  resolveCampusStripeAccounting,
  resolveCumbreStripeAccounting,
  resolveEventStripeAccounting,
  type StripeAccountingDescriptor,
} from '@lib/stripeAccounting';
import {
  buildHistoricalStripeMetadata,
  resolveHistoricalStripeAccounting,
  type HistoricalStripeEvidence,
  type HistoricalStripeResolution,
} from '@lib/stripeAccountingMigration';
import { ensureStripeFundProduct, getStripeClient } from '@lib/stripe';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;
export const maxDuration = 60;

const MAX_PAGE_SIZE = 10;
const DONATION_SELECT = [
  'id',
  'source',
  'donation_type',
  'project_name',
  'event_name',
  'campus',
  'cumbre_booking_id',
  'payment_domain',
  'reference',
  'provider_tx_id',
].join(',');

type MigrationAction = 'status' | 'seed_catalog' | 'payment_intents' | 'charges' | 'subscriptions';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function objectId(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'id' in value) return text((value as { id?: unknown }).id);
  return '';
}

function pageSize(value: unknown): number {
  const parsed = Math.floor(Number(value || MAX_PAGE_SIZE));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_PAGE_SIZE, parsed)) : MAX_PAGE_SIZE;
}

function excludedFundCodes(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value
    .slice(0, 50)
    .map((entry) => text(entry).toUpperCase())
    .filter((entry) => /^[A-Z0-9_-]{1,100}$/.test(entry)));
}

function publicSiteUrl(): string {
  const raw = text(env('PUBLIC_SITE_URL')) || 'https://ministeriomana.org';
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return 'https://ministeriomana.org';
  }
}

function publicImageUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = raw.startsWith('/') ? new URL(raw, publicSiteUrl()) : new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function productImagesForFund(fundCode: string): string[] {
  const paths: Record<string, string> = {
    DONATION_GENERAL: '/images/cumbre/fishermen-bg-highres.jpg',
    DONATION_TITHE: '/images/cumbre/fishermen-bg-highres.jpg',
    DONATION_OFFERING: '/images/cumbre/fishermen-sunset.jpg',
    DONATION_MISSIONS: '/images/campus/misioneros/GRUPO-COMPLETO.jpg',
    PRIMICIAS: '/images/cumbre/fishermen-sunset.jpg',
    CAMPUS_GENERAL: '/images/campus/misioneros/GRUPO-COMPLETO.jpg',
    EVENT_CUMBRE_2026: '/images/cumbre/bienvenida-og.jpg',
    PILGRIMAGE_TURQUIA_ISLAS_GRIEGAS_2026: '/images/peregrinaciones/turquia-islas-griegas-2026-hero.jpg',
  };
  const image = publicImageUrl(paths[fundCode]);
  return image ? [image] : [];
}

async function findDonation(metadata: Record<string, unknown>, providerObjectIds: string[]) {
  if (!supabaseAdmin) return null;
  const donationId = text(metadata.donation_id);
  const reference = text(metadata.donation_reference);
  const attempts: Array<() => PromiseLike<any>> = [];
  if (donationId) {
    attempts.push(() => supabaseAdmin!.from('donations').select(DONATION_SELECT).eq('id', donationId).maybeSingle());
  }
  if (reference) {
    attempts.push(() => supabaseAdmin!.from('donations').select(DONATION_SELECT).eq('provider', 'stripe').eq('reference', reference).maybeSingle());
  }
  for (const id of providerObjectIds.filter(Boolean)) {
    attempts.push(() => supabaseAdmin!.from('donations').select(DONATION_SELECT).eq('provider', 'stripe').eq('provider_tx_id', id).limit(1).maybeSingle());
  }
  for (const attempt of attempts) {
    const result = await attempt();
    if (!result.error && result.data) return result.data;
  }
  return null;
}

async function findCampusDestinations(donationId: string | undefined) {
  if (!supabaseAdmin || !donationId) return [];
  const { data, error } = await supabaseAdmin
    .from('campus_donation_allocations')
    .select('missionary_slug, missionary_name')
    .eq('donation_id', donationId);
  if (error) return [];
  return (data || [])
    .map((row) => ({ slug: text(row.missionary_slug), name: text(row.missionary_name) }))
    .filter((row) => row.slug && row.name);
}

async function findEvent(metadata: Record<string, unknown>, providerObjectIds: string[]) {
  if (!supabaseAdmin) return null;
  let eventId = text(metadata.event_id);
  if (!eventId) {
    const paymentId = text(metadata.event_payment_id);
    const paymentReference = text(metadata.event_payment_reference);
    const attempts: Array<() => PromiseLike<any>> = [];
    if (paymentId) {
      attempts.push(() => supabaseAdmin!.from('event_payments').select('event_id').eq('id', paymentId).maybeSingle());
    }
    if (paymentReference) {
      attempts.push(() => supabaseAdmin!.from('event_payments').select('event_id').eq('provider', 'STRIPE').eq('reference', paymentReference).maybeSingle());
    }
    for (const id of providerObjectIds.filter(Boolean)) {
      attempts.push(() => supabaseAdmin!.from('event_payments').select('event_id').eq('provider', 'STRIPE').eq('provider_tx_id', id).limit(1).maybeSingle());
    }
    for (const attempt of attempts) {
      const result = await attempt();
      if (!result.error && result.data?.event_id) {
        eventId = text(result.data.event_id);
        break;
      }
    }
  }
  if (!eventId) return null;
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, title')
    .eq('id', eventId)
    .maybeSingle();
  return error ? null : data;
}

async function expandInvoiceMetadata(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  metadata: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const invoiceId = objectId((intent as any).invoice);
  if (!invoiceId) return metadata;
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const raw = invoice as any;
    const subscriptionId = objectId(raw.subscription || raw.parent?.subscription_details?.subscription);
    let subscriptionMetadata: Record<string, string> = {};
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      subscriptionMetadata = subscription.metadata || {};
    }
    return {
      ...subscriptionMetadata,
      ...(raw.subscription_details?.metadata || {}),
      ...(raw.parent?.subscription_details?.metadata || {}),
      ...metadata,
    };
  } catch {
    return metadata;
  }
}

async function expandCheckoutEvidenceMetadata(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
  metadata: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 10 });
    const sessionMetadata: Record<string, unknown> = {};
    const lineItemNames: string[] = [];
    for (const session of sessions.data) {
      Object.assign(sessionMetadata, session.metadata || {});
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ['data.price.product'],
      });
      for (const item of lineItems.data) {
        const product = item.price?.product;
        const productName = product && typeof product !== 'string' && !('deleted' in product)
          ? text(product.name)
          : '';
        const name = productName || text(item.description);
        if (name) lineItemNames.push(name);
      }
    }
    return {
      ...sessionMetadata,
      ...(lineItemNames.length ? { event_name: lineItemNames.join(' · ').slice(0, 500) } : {}),
      ...metadata,
    };
  } catch {
    return metadata;
  }
}

async function buildEvidence(params: {
  metadata: Record<string, unknown>;
  providerObjectIds: string[];
}): Promise<HistoricalStripeEvidence> {
  const [donation, event] = await Promise.all([
    findDonation(params.metadata, params.providerObjectIds),
    findEvent(params.metadata, params.providerObjectIds),
  ]);
  const campusDestinations = await findCampusDestinations(donation?.id);
  return { metadata: params.metadata, donation, event, campusDestinations };
}

async function resolveIntent(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
): Promise<{ resolution: HistoricalStripeResolution; metadata: Record<string, unknown> }> {
  const metadata: Record<string, unknown> = { ...(intent.metadata || {}) };
  let evidenceMetadata = metadata;
  let evidence = await buildEvidence({
    metadata: evidenceMetadata,
    providerObjectIds: [intent.id, objectId(intent.latest_charge)],
  });
  let resolution = resolveHistoricalStripeAccounting(evidence);
  if (resolution.confidence === 'UNASSIGNED') {
    evidenceMetadata = await expandInvoiceMetadata(stripe, intent, evidenceMetadata);
    evidence = await buildEvidence({
      metadata: evidenceMetadata,
      providerObjectIds: [intent.id, objectId(intent.latest_charge)],
    });
    resolution = resolveHistoricalStripeAccounting(evidence);
  }
  if (resolution.confidence === 'UNASSIGNED') {
    evidenceMetadata = await expandCheckoutEvidenceMetadata(stripe, intent, evidenceMetadata);
    evidence = await buildEvidence({
      metadata: evidenceMetadata,
      providerObjectIds: [intent.id, objectId(intent.latest_charge)],
    });
    resolution = resolveHistoricalStripeAccounting(evidence);
    if (resolution.confidence === 'EXACT_METADATA') {
      resolution = { ...resolution, reason: `checkout_session:${resolution.reason}` };
    }
  }
  return { resolution, metadata };
}

async function applyIntentAccounting(params: {
  stripe: Stripe;
  intent: Stripe.PaymentIntent;
  accounting: StripeAccountingDescriptor;
  metadata: Record<string, unknown>;
  confidence: 'EXACT_INTERNAL' | 'EXACT_METADATA';
}): Promise<{ productId: string | null; chargeUpdated: boolean; sessionsMatched: number }> {
  const product = await ensureStripeFundProduct({
    accounting: params.accounting,
    imageUrls: productImagesForFund(params.accounting.fundCode),
  });
  if (!product) throw new Error(`No se pudo preparar el producto ${params.accounting.fundCode}`);
  const metadata = buildHistoricalStripeMetadata({
    accounting: params.accounting,
    currentMetadata: params.metadata,
    productId: product?.id,
    confidence: params.confidence,
  });
  const description = buildStripePaymentDescription(params.accounting);
  const chargeId = objectId(params.intent.latest_charge);
  let chargeUpdated = false;
  if (chargeId) {
    await params.stripe.charges.update(chargeId, { description, metadata });
    chargeUpdated = true;
  }
  await params.stripe.paymentIntents.update(params.intent.id, { description, metadata });
  const sessions = await params.stripe.checkout.sessions.list({ payment_intent: params.intent.id, limit: 10 });
  return { productId: product?.id || null, chargeUpdated, sessionsMatched: sessions.data.length };
}

async function runPaymentIntentPage(params: {
  apply: boolean;
  limit: number;
  cursor: string;
}) {
  const stripe = getStripeClient();
  const page = await stripe.paymentIntents.list({
    limit: params.limit,
    ...(params.cursor ? { starting_after: params.cursor } : {}),
  });
  const rows: Array<Record<string, unknown>> = [];
  for (const intent of page.data) {
    if (intent.status !== 'succeeded') {
      rows.push({ id: intent.id, status: intent.status, outcome: 'SKIPPED_NOT_SUCCEEDED' });
      continue;
    }
    const { resolution, metadata } = await resolveIntent(stripe, intent);
    const base = {
      id: intent.id,
      status: intent.status,
      created: new Date(intent.created * 1000).toISOString(),
      amount_minor: intent.amount_received || intent.amount,
      currency: intent.currency.toUpperCase(),
      confidence: resolution.confidence,
      reason: resolution.reason,
      fund_code: resolution.accounting?.fundCode || text(metadata.fund_code) || null,
      product_name: resolution.accounting?.productName || null,
    };
    if (!params.apply || !resolution.accounting || !['EXACT_INTERNAL', 'EXACT_METADATA'].includes(resolution.confidence)) {
      rows.push({ ...base, outcome: resolution.confidence === 'ALREADY_CLASSIFIED' ? 'ALREADY_CLASSIFIED' : 'DRY_RUN' });
      continue;
    }
    const applied = await applyIntentAccounting({
      stripe,
      intent,
      accounting: resolution.accounting,
      metadata,
      confidence: resolution.confidence as 'EXACT_INTERNAL' | 'EXACT_METADATA',
    });
    rows.push({ ...base, outcome: 'UPDATED', ...applied });
  }
  return {
    rows,
    has_more: page.has_more,
    next_cursor: page.has_more ? page.data.at(-1)?.id || null : null,
  };
}

async function runChargePage(params: { apply: boolean; limit: number; cursor: string }) {
  const stripe = getStripeClient();
  const page = await stripe.charges.list({
    limit: params.limit,
    ...(params.cursor ? { starting_after: params.cursor } : {}),
  });
  const rows: Array<Record<string, unknown>> = [];
  for (const charge of page.data) {
    if (objectId(charge.payment_intent)) {
      rows.push({ id: charge.id, outcome: 'SKIPPED_HAS_PAYMENT_INTENT' });
      continue;
    }
    if (!charge.paid || charge.status !== 'succeeded') {
      rows.push({ id: charge.id, status: charge.status, outcome: 'SKIPPED_NOT_SUCCEEDED' });
      continue;
    }
    const metadata: Record<string, unknown> = { ...(charge.metadata || {}) };
    const evidence = await buildEvidence({ metadata, providerObjectIds: [charge.id] });
    const resolution = resolveHistoricalStripeAccounting(evidence);
    const base = {
      id: charge.id,
      status: charge.status,
      created: new Date(charge.created * 1000).toISOString(),
      amount_minor: charge.amount,
      currency: charge.currency.toUpperCase(),
      confidence: resolution.confidence,
      reason: resolution.reason,
      fund_code: resolution.accounting?.fundCode || text(metadata.fund_code) || null,
      product_name: resolution.accounting?.productName || null,
    };
    if (!params.apply || !resolution.accounting || !['EXACT_INTERNAL', 'EXACT_METADATA'].includes(resolution.confidence)) {
      rows.push({ ...base, outcome: resolution.confidence === 'ALREADY_CLASSIFIED' ? 'ALREADY_CLASSIFIED' : 'DRY_RUN' });
      continue;
    }
    const product = await ensureStripeFundProduct({
      accounting: resolution.accounting,
      imageUrls: productImagesForFund(resolution.accounting.fundCode),
    });
    if (!product) throw new Error(`No se pudo preparar el producto ${resolution.accounting.fundCode}`);
    const nextMetadata = buildHistoricalStripeMetadata({
      accounting: resolution.accounting,
      currentMetadata: metadata,
      productId: product?.id,
      confidence: resolution.confidence as 'EXACT_INTERNAL' | 'EXACT_METADATA',
    });
    await stripe.charges.update(charge.id, {
      description: buildStripePaymentDescription(resolution.accounting),
      metadata: nextMetadata,
    });
    rows.push({ ...base, outcome: 'UPDATED', productId: product?.id || null });
  }
  return {
    rows,
    has_more: page.has_more,
    next_cursor: page.has_more ? page.data.at(-1)?.id || null : null,
  };
}

async function resolveSubscription(
  subscription: Stripe.Subscription,
): Promise<{ resolution: HistoricalStripeResolution; metadata: Record<string, unknown> }> {
  const metadata: Record<string, unknown> = { ...(subscription.metadata || {}) };
  if (supabaseAdmin) {
    const donationSubscriptionId = text(metadata.donation_subscription_id);
    const donationQuery = supabaseAdmin
      .from('donation_recurring_subscriptions')
      .select('id, donation_type, project_name, event_name, campus')
      .eq('provider', 'stripe');
    const donationSubscription = donationSubscriptionId
      ? await donationQuery.eq('id', donationSubscriptionId).maybeSingle()
      : await donationQuery.eq('provider_subscription_id', subscription.id).maybeSingle();
    if (!donationSubscription.error && donationSubscription.data) {
      return {
        resolution: resolveHistoricalStripeAccounting({
          metadata,
          donation: { ...donationSubscription.data, source: 'donaciones-stripe' },
        }),
        metadata,
      };
    }

    const campusSubscriptionId = text(metadata.campus_subscription_id);
    const campusQuery = supabaseAdmin
      .from('campus_donation_subscriptions')
      .select('id')
      .eq('provider', 'stripe');
    const campusSubscription = campusSubscriptionId
      ? await campusQuery.eq('id', campusSubscriptionId).maybeSingle()
      : await campusQuery.eq('provider_subscription_id', subscription.id).maybeSingle();
    if (!campusSubscription.error && campusSubscription.data?.id) {
      const { data: allocations } = await supabaseAdmin
        .from('campus_donation_subscription_allocations')
        .select('missionary_slug, missionary_name')
        .eq('subscription_id', campusSubscription.data.id);
      return {
        resolution: resolveHistoricalStripeAccounting({
          metadata,
          donation: { id: campusSubscription.data.id, source: 'campus-checkout', donation_type: 'campus' },
          campusDestinations: (allocations || []).map((row) => ({
            slug: text(row.missionary_slug),
            name: text(row.missionary_name),
          })),
        }),
        metadata,
      };
    }

    const { data: cumbrePlan, error: cumbrePlanError } = await supabaseAdmin
      .from('cumbre_payment_plans')
      .select('id')
      .eq('provider', 'stripe')
      .eq('provider_subscription_id', subscription.id)
      .maybeSingle();
    if (!cumbrePlanError && cumbrePlan?.id) {
      return {
        resolution: {
          accounting: resolveCumbreStripeAccounting(),
          confidence: 'EXACT_INTERNAL',
          reason: 'cumbre_payment_plans:provider_subscription_id',
        },
        metadata,
      };
    }
  }
  const evidence = await buildEvidence({
    metadata,
    providerObjectIds: [subscription.id],
  });
  return { resolution: resolveHistoricalStripeAccounting(evidence), metadata };
}

async function runSubscriptionPage(params: { apply: boolean; limit: number; cursor: string }) {
  const stripe = getStripeClient();
  const page = await stripe.subscriptions.list({
    status: 'all',
    limit: params.limit,
    ...(params.cursor ? { starting_after: params.cursor } : {}),
  });
  const rows: Array<Record<string, unknown>> = [];
  for (const subscription of page.data) {
    const { resolution, metadata } = await resolveSubscription(subscription);
    const base = {
      id: subscription.id,
      status: subscription.status,
      confidence: resolution.confidence,
      reason: resolution.reason,
      fund_code: resolution.accounting?.fundCode || text(metadata.fund_code) || null,
      product_name: resolution.accounting?.productName || null,
    };
    if (!params.apply || !resolution.accounting || !['EXACT_INTERNAL', 'EXACT_METADATA'].includes(resolution.confidence)) {
      rows.push({ ...base, outcome: resolution.confidence === 'ALREADY_CLASSIFIED' ? 'ALREADY_CLASSIFIED' : 'DRY_RUN' });
      continue;
    }
    const product = await ensureStripeFundProduct({
      accounting: resolution.accounting,
      imageUrls: productImagesForFund(resolution.accounting.fundCode),
    });
    if (!product) throw new Error(`No se pudo preparar el producto ${resolution.accounting.fundCode}`);
    const nextMetadata = buildHistoricalStripeMetadata({
      accounting: resolution.accounting,
      currentMetadata: metadata,
      productId: product?.id,
      confidence: resolution.confidence as 'EXACT_INTERNAL' | 'EXACT_METADATA',
    });
    await stripe.subscriptions.update(subscription.id, {
      description: buildStripePaymentDescription(resolution.accounting),
      metadata: nextMetadata,
    });
    rows.push({ ...base, outcome: 'UPDATED', productId: product?.id || null });
  }
  return {
    rows,
    has_more: page.has_more,
    next_cursor: page.has_more ? page.data.at(-1)?.id || null : null,
  };
}

function dedupeCatalog(items: Array<{ accounting: StripeAccountingDescriptor; imageUrls: string[] }>) {
  const byFund = new Map<string, { accounting: StripeAccountingDescriptor; imageUrls: string[] }>();
  for (const item of items) byFund.set(item.accounting.fundCode, item);
  return [...byFund.values()];
}

async function buildCatalog() {
  const items = getFixedStripeAccountingCatalog().map((accounting) => ({
    accounting,
    imageUrls: productImagesForFund(accounting.fundCode),
  }));
  for (const missionary of MISIONEROS) {
    const accounting = resolveCampusStripeAccounting([{ slug: missionary.slug, name: missionary.nombre }]);
    const image = publicImageUrl(missionary.foto);
    items.push({ accounting, imageUrls: image ? [image] : [] });
  }
  if (supabaseAdmin) {
    const { data: options } = await supabaseAdmin
      .from('event_payment_options')
      .select('event_id')
      .eq('provider', 'STRIPE')
      .eq('kind', 'ONLINE')
      .eq('is_active', true);
    const eventIds = Array.from(new Set((options || []).map((option) => text(option.event_id)).filter(Boolean)));
    if (eventIds.length) {
      const { data: events } = await supabaseAdmin
        .from('events')
        .select('id, title, banner_url')
        .in('id', eventIds);
      for (const event of events || []) {
        const accounting = resolveEventStripeAccounting({ eventId: event.id, eventTitle: event.title });
        const image = publicImageUrl(event.banner_url);
        items.push({ accounting, imageUrls: image ? [image] : [] });
      }
    }
  }
  return dedupeCatalog(items);
}

async function seedCatalog(apply: boolean, excluded = new Set<string>()) {
  const catalog = (await buildCatalog()).filter((item) => !excluded.has(item.accounting.fundCode));
  const rows = [];
  for (const item of catalog) {
    if (!apply) {
      rows.push({ fund_code: item.accounting.fundCode, product_name: item.accounting.productName, outcome: 'DRY_RUN' });
      continue;
    }
    const product = await ensureStripeFundProduct(item);
    rows.push({
      fund_code: item.accounting.fundCode,
      product_name: item.accounting.productName,
      product_id: product?.id || null,
      outcome: product?.id ? 'READY' : 'FAILED',
    });
  }
  return { total: rows.length, rows };
}

async function status() {
  const stripe = getStripeClient();
  const account = await stripe.accounts.retrieve();
  let productCount = 0;
  for await (const _product of stripe.products.list({ limit: 100 })) productCount += 1;
  return {
    account: {
      id: account.id,
      name: account.business_profile?.name || account.company?.name || null,
      country: account.country,
      live_mode: text(env('STRIPE_SECRET_KEY')).startsWith('sk_live_'),
    },
    product_count: productCount,
    catalog: await seedCatalog(false),
  };
}

export const POST: APIRoute = async ({ request }) => {
  const production = import.meta.env.PROD || process.env.NODE_ENV === 'production';
  const authorized = isCronRequestAuthorized(request, {
    secrets: [env('STRIPE_ACCOUNTING_MIGRATION_SECRET')],
    production,
    allowWithoutSecretInDevelopment: false,
  });
  if (!authorized) return json({ ok: false, error: 'Not found' }, 404);
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 503);

  const raw = await request.text();
  if (raw.length > 2_000) return json({ ok: false, error: 'Solicitud demasiado grande' }, 413);
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: 'Solicitud inválida' }, 400);
  }
  const action = text(body.action) as MigrationAction;
  const apply = body.apply === true;
  const limit = pageSize(body.limit);
  const cursor = text(body.cursor);
  const excluded = excludedFundCodes(body.exclude_fund_codes);

  try {
    if (action === 'status') return json({ ok: true, action, ...(await status()) });
    if (action === 'seed_catalog') {
      return json({
        ok: true,
        action,
        apply,
        excluded_fund_codes: [...excluded],
        ...(await seedCatalog(apply, excluded)),
      });
    }
    if (action === 'payment_intents') {
      return json({ ok: true, action, apply, ...(await runPaymentIntentPage({ apply, limit, cursor })) });
    }
    if (action === 'charges') {
      return json({ ok: true, action, apply, ...(await runChargePage({ apply, limit, cursor })) });
    }
    if (action === 'subscriptions') {
      return json({ ok: true, action, apply, ...(await runSubscriptionPage({ apply, limit, cursor })) });
    }
    return json({ ok: false, error: 'Acción inválida' }, 400);
  } catch (error) {
    console.error('[stripe-accounting-migration] operation failed', {
      action,
      apply,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: 'No se pudo completar la operación contable' }, 500);
  }
};
