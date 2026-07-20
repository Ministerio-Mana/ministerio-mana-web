import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildStripeAccountingMetadata,
  mergeStripeAccountingMetadata,
  resolveCampusStripeAccounting,
  resolveCumbreStripeAccounting,
  resolveDonationStripeAccounting,
  resolveEventStripeAccounting,
  sanitizeStripeMetadata,
} from '../src/lib/stripeAccounting.ts';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('separa primicias, diezmos, ofrendas y donación general en fondos estables', () => {
  assert.equal(resolveDonationStripeAccounting({
    source: 'primicias-stripe',
    donationType: 'ofrendas',
    projectName: 'Primicias',
  }).fundCode, 'PRIMICIAS');
  assert.equal(resolveDonationStripeAccounting({
    source: 'primicias-stripe',
    donationType: 'diezmos',
    projectName: 'Diezmos',
  }).fundCode, 'DONATION_TITHE');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'ofrendas' }).fundCode, 'DONATION_OFFERING');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'misiones' }).fundCode, 'DONATION_MISSIONS');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'campus' }).fundCode, 'CAMPUS_GENERAL');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'evento' }).fundCode, 'DONATION_EVENT');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'peregrinaciones' }).fundCode, 'DONATION_PILGRIMAGE');
  assert.equal(resolveDonationStripeAccounting({ donationType: 'general' }).fundCode, 'DONATION_GENERAL');
});

test('un texto libre del donante no puede crear fondos ni productos arbitrarios', () => {
  assert.equal(resolveDonationStripeAccounting({
    donationType: 'ofrendas',
    projectName: 'Producto inventado por un usuario',
  }).fundCode, 'DONATION_OFFERING');
  assert.equal(resolveDonationStripeAccounting({
    donationType: 'valor-no-permitido',
    projectName: 'Producto inventado por un usuario',
  }).fundCode, 'DONATION_GENERAL');
});

test('Campus usa un fondo por misionero y un encabezado de distribución múltiple', () => {
  const ariel = resolveCampusStripeAccounting([{ slug: 'ariel-guzman', name: 'Ariel Guzmán' }]);
  assert.equal(ariel.fundCode, 'CAMPUS_ARIEL-GUZMAN');
  assert.equal(ariel.beneficiaryType, 'MISSIONARY');
  assert.equal(ariel.productName, 'Campus Maná · Ariel Guzmán');

  const split = resolveCampusStripeAccounting([
    { slug: 'ariel-guzman', name: 'Ariel Guzmán' },
    { slug: 'amaury-padilla', name: 'Amaury Padilla' },
  ]);
  assert.equal(split.fundCode, 'CAMPUS_SPLIT');
  assert.equal(split.beneficiaryType, 'MULTIPLE');
  assert.match(split.fundLabel, /2 asignaciones/);
});

test('cada evento tiene fondo propio y Cumbre conserva un fondo reconocible', () => {
  const event = resolveEventStripeAccounting({
    eventId: '614954f2-7708-4d7a-946f-2de04c720a86',
    eventTitle: 'Escuela bíblica',
  });
  assert.equal(event.fundCode, 'EVENT_614954F2-7708-4D7A-946F-2DE04C720A86');
  assert.equal(event.productName, 'Evento · Escuela bíblica');
  assert.equal(resolveCumbreStripeAccounting().fundCode, 'EVENT_CUMBRE_2026');
});

test('los metadatos contables son compactos, sin datos vacíos y no se pueden sobrescribir', () => {
  const accounting = resolveCumbreStripeAccounting();
  const metadata = mergeStripeAccountingMetadata(accounting, {
    payment_domain: 'ALTERED',
    fund_code: 'ALTERED',
    cumbre_booking_id: 'booking-1',
    empty: '',
  });
  assert.deepEqual(buildStripeAccountingMetadata(accounting), {
    mana_schema: 'mana_fund_v1',
    payment_domain: 'EVENT',
    concept_code: 'EVENT',
    concept_label: 'Eventos',
    fund_code: 'EVENT_CUMBRE_2026',
    fund_label: 'Evento · Cumbre Mundial 2026',
    beneficiary_type: 'EVENT',
    beneficiary_code: 'CUMBRE_2026',
    beneficiary_label: 'Cumbre Mundial 2026',
    source: 'cumbre_2026',
  });
  assert.equal(metadata.payment_domain, 'EVENT');
  assert.equal(metadata.fund_code, 'EVENT_CUMBRE_2026');
  assert.equal(metadata.cumbre_booking_id, 'booking-1');
  assert.equal('empty' in metadata, false);

  const sanitized = sanitizeStripeMetadata({
    '[unsafe]': 'x'.repeat(700),
  });
  assert.equal(Object.keys(sanitized)[0], '_unsafe_');
  assert.equal(sanitized._unsafe_.length, 500);
});

test('la clasificación Stripe y la clasificación interna usan el mismo dominio y concepto', () => {
  const checkout = source('../src/pages/api/stripe/checkout.ts');
  assert.match(checkout, /payment_domain:\s*accounting\.paymentDomain/);
  assert.match(checkout, /concept_code:\s*accounting\.conceptCode/);
  assert.match(checkout, /concept_label:\s*accounting\.conceptLabel/);
});

test('Checkout, PaymentIntent, Charge y suscripciones reciben la clasificación contable', () => {
  const stripe = source('../src/lib/stripe.ts');
  const webhook = source('../src/pages/api/stripe/webhook.ts');
  assert.match(stripe, /stripe\.products\.search/);
  assert.match(stripe, /mana_fund_code/);
  assert.match(stripe, /payment_intent_data:[\s\S]*?description:[\s\S]*?metadata/);
  assert.match(stripe, /subscription_data:[\s\S]*?metadata/);
  assert.match(stripe, /lineItems/);
  assert.match(webhook, /syncInvoiceAccountingToPaymentObjects/);
  assert.match(webhook, /stripe\.charges\.update/);
});

test('ningún creador de Checkout Stripe queda sin contexto accounting', () => {
  const paths = [
    '../src/lib/eventCheckout.ts',
    '../src/pages/api/stripe/checkout.ts',
    '../src/pages/api/campus/checkout.ts',
    '../src/pages/api/cumbre2026/installments/create.ts',
    '../src/pages/api/payments/create.ts',
    '../src/pages/cumbre2026/pagar/[token].astro',
  ];
  for (const path of paths) {
    const code = source(path);
    const calls = [...code.matchAll(/createStripe(?:Donation|Installment)Session\(\{([\s\S]*?)\n\s*\}\)/g)];
    assert.ok(calls.length > 0, `${path} debe crear al menos una sesión Stripe`);
    for (const call of calls) {
      assert.match(call[1], /\baccounting\b\s*(?::|,)/, `${path} debe enviar accounting`);
    }
  }
});
