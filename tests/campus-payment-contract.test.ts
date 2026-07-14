import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCampusAllocationAmounts,
  normalizeCampusMoneyAmount,
  resolveCampusPaymentProvider,
} from '../src/lib/campusPaymentContract.ts';

test('normaliza COP entero y USD con centavos sin mezclar convenciones', () => {
  assert.equal(normalizeCampusMoneyAmount('$ 100.000', 'COP'), 100000);
  assert.equal(normalizeCampusMoneyAmount('25,50', 'USD'), 25.5);
  assert.equal(normalizeCampusMoneyAmount('1,234.56', 'USD'), 1234.56);
});

test('asigna únicamente misioneros seleccionados y evidencia montos faltantes', () => {
  assert.deepEqual(buildCampusAllocationAmounts({
    selectedSlugs: ['ana', 'juan'],
    allocations: [
      { slug: 'ana', amount: '50.000' },
      { slug: 'desconocido', amount: '90.000' },
    ],
    amount: null,
    currency: 'COP',
  }), [
    { slug: 'ana', amount: 50000 },
    { slug: 'juan', amount: 0 },
  ]);
});

test('mantiene el contrato COP/Wompi y USD/Stripe', () => {
  assert.deepEqual(resolveCampusPaymentProvider('COP'), {
    provider: 'wompi',
    financeProvider: 'WOMPI',
  });
  assert.deepEqual(resolveCampusPaymentProvider('USD'), {
    provider: 'stripe',
    financeProvider: 'STRIPE',
  });
});
