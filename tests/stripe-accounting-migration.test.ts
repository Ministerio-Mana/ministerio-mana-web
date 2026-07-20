import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getFixedStripeAccountingCatalog,
  resolvePilgrimageStripeAccounting,
} from '../src/lib/stripeAccounting.ts';
import {
  buildHistoricalStripeMetadata,
  resolveHistoricalStripeAccounting,
} from '../src/lib/stripeAccountingMigration.ts';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('el catálogo fijo es estable, único y cubre los fondos administrativos', () => {
  const catalog = getFixedStripeAccountingCatalog();
  const codes = catalog.map((item) => item.fundCode);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of [
    'DONATION_GENERAL',
    'DONATION_TITHE',
    'DONATION_OFFERING',
    'DONATION_MISSIONS',
    'DONATION_EVENT',
    'DONATION_PILGRIMAGE',
    'PRIMICIAS',
    'CAMPUS_GENERAL',
    'EVENT_CUMBRE_2026',
    'PILGRIMAGE_TURQUIA_ISLAS_GRIEGAS_2026',
  ]) assert.ok(codes.includes(code), `falta ${code}`);
});

test('Peregrinación tiene producto propio sin cambiar el dominio bancario', () => {
  const pilgrimage = resolvePilgrimageStripeAccounting({
    pilgrimageId: 'turquia-2026',
    pilgrimageTitle: 'Turquía 2026',
  });
  assert.equal(pilgrimage.fundCode, 'PILGRIMAGE_TURQUIA-2026');
  assert.equal(pilgrimage.paymentDomain, 'DONATION');
  assert.equal(pilgrimage.conceptCode, 'PILGRIMAGE');
  assert.equal(pilgrimage.productName, 'Peregrinación · Turquía 2026');
});

test('los registros internos prevalecen sobre texto libre histórico', () => {
  const event = resolveHistoricalStripeAccounting({
    metadata: { project_name: 'texto libre' },
    event: { id: 'event-1', title: 'Congreso regional' },
  });
  assert.equal(event.confidence, 'EXACT_INTERNAL');
  assert.equal(event.accounting?.fundCode, 'EVENT_EVENT-1');

  const campus = resolveHistoricalStripeAccounting({
    donation: { id: 'don-1', source: 'campus-checkout', donation_type: 'campus' },
    campusDestinations: [{ slug: 'ariel-guzman', name: 'Ariel Guzmán' }],
  });
  assert.equal(campus.confidence, 'EXACT_INTERNAL');
  assert.equal(campus.accounting?.fundCode, 'CAMPUS_ARIEL-GUZMAN');

  const tithe = resolveHistoricalStripeAccounting({
    donation: { id: 'don-2', source: 'donaciones-stripe', donation_type: 'diezmos' },
  });
  assert.equal(tithe.accounting?.fundCode, 'DONATION_TITHE');
});

test('metadatos antiguos identifican Cumbre, Campus y donaciones sin PII', () => {
  assert.equal(resolveHistoricalStripeAccounting({
    metadata: { cumbre_booking_id: 'booking-1' },
  }).accounting?.fundCode, 'EVENT_CUMBRE_2026');
  assert.equal(resolveHistoricalStripeAccounting({
    metadata: { source: 'campus-multi-donation', missionaries: 'ariel-guzman,amaury-padilla' },
  }).accounting?.fundCode, 'CAMPUS_SPLIT');
  assert.equal(resolveHistoricalStripeAccounting({
    metadata: { source: 'donations_form', donation_type: 'ofrendas' },
  }).accounting?.fundCode, 'DONATION_OFFERING');
  assert.equal(resolveHistoricalStripeAccounting({
    metadata: { project_name: 'Peregrinación Turquía 2026' },
  }).accounting?.fundCode, 'PILGRIMAGE_TURQUIA_ISLAS_GRIEGAS_2026');
  assert.equal(resolveHistoricalStripeAccounting({ metadata: {} }).confidence, 'UNASSIGNED');
});

test('un pago ya clasificado nunca se vuelve a escribir', () => {
  const result = resolveHistoricalStripeAccounting({
    metadata: { mana_schema: 'mana_fund_v1', fund_code: 'DONATION_TITHE' },
  });
  assert.equal(result.confidence, 'ALREADY_CLASSIFIED');
  assert.equal(result.accounting, null);
});

test('el backfill conserva referencias y agrega versión, confianza y producto', () => {
  const accounting = getFixedStripeAccountingCatalog().find((item) => item.fundCode === 'DONATION_TITHE')!;
  const metadata = buildHistoricalStripeMetadata({
    accounting,
    currentMetadata: { donation_reference: 'DON-123', fund_code: 'incorrecto' },
    productId: 'prod_123',
    confidence: 'EXACT_INTERNAL',
  });
  assert.equal(metadata.donation_reference, 'DON-123');
  assert.equal(metadata.fund_code, 'DONATION_TITHE');
  assert.equal(metadata.stripe_product_id, 'prod_123');
  assert.equal(metadata.backfill_confidence, 'EXACT_INTERNAL');
  assert.match(metadata.historical_backfill, /^mana_fund_v1_/);

  const crowdedMetadata = buildHistoricalStripeMetadata({
    accounting,
    currentMetadata: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`legacy_${index}`, index])),
    productId: 'prod_crowded',
    confidence: 'EXACT_METADATA',
  });
  assert.equal(crowdedMetadata.stripe_product_id, 'prod_crowded');
  assert.equal(crowdedMetadata.backfill_confidence, 'EXACT_METADATA');
});

test('la operación remota falla cerrada, pagina y no cambia importes ni precios', () => {
  const endpoint = source('../src/pages/api/internal/stripe-accounting.ts');
  const stripe = source('../src/lib/stripe.ts');
  const eventOptions = source('../src/pages/api/portal/event-payments/options.ts');
  assert.match(endpoint, /STRIPE_ACCOUNTING_MIGRATION_SECRET/);
  assert.match(endpoint, /allowWithoutSecretInDevelopment:\s*false/);
  assert.match(endpoint, /const apply = body\.apply === true/);
  assert.match(endpoint, /exclude_fund_codes/);
  assert.match(endpoint, /\^\[A-Z0-9_-\]\{1,100\}\$/);
  assert.match(endpoint, /MAX_PAGE_SIZE = 10/);
  assert.match(endpoint, /intent\.status !== 'succeeded'/);
  assert.match(endpoint, /paymentIntents\.update\([^,]+, \{ description, metadata \}\)/);
  assert.match(endpoint, /charges\.update\([^,]+, \{ description, metadata \}\)/);
  assert.match(endpoint, /SKIPPED_HAS_PAYMENT_INTENT/);
  assert.match(endpoint, /checkout\.sessions\.listLineItems/);
  assert.match(endpoint, /checkout_session:\$\{resolution\.reason\}/);
  assert.match(endpoint, /const metadata: Record<string, unknown> = \{ \.\.\.\(intent\.metadata \|\| \{\}\) \}/);
  const subscriptionUpdate = endpoint.match(/subscriptions\.update\(subscription\.id, \{([\s\S]*?)\n    \}\);/)?.[1] || '';
  assert.ok(subscriptionUpdate, 'falta la actualización controlada de suscripción');
  assert.doesNotMatch(subscriptionUpdate, /\bitems\s*:/);
  assert.doesNotMatch(subscriptionUpdate, /\bprice\s*:/);
  assert.match(stripe, /products\.search/);
  assert.match(stripe, /products\.update/);
  assert.match(stripe, /images/);
  assert.match(eventOptions, /ensureEventStripeProduct/);
});
