import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWebhookFailureTransition } from '../src/lib/paymentReliability.ts';

test('registra el primer fallo y aumenta una sola vez el contador', () => {
  assert.deepEqual(resolveWebhookFailureTransition({
    status: 'PROCESSING',
    providerReference: null,
    incomingReference: 'invoice_001',
    attemptCount: 2,
  }), {
    shouldUpdate: true,
    nextAttemptCount: 3,
  });
});

test('ignora la repetición del mismo webhook fallido', () => {
  assert.deepEqual(resolveWebhookFailureTransition({
    status: 'FAILED',
    providerReference: 'invoice_001',
    incomingReference: 'invoice_001',
    attemptCount: 3,
  }), {
    shouldUpdate: false,
    nextAttemptCount: 3,
  });
});

test('un intento nuevo conserva la posibilidad de reintento legítimo', () => {
  assert.deepEqual(resolveWebhookFailureTransition({
    status: 'FAILED',
    providerReference: 'invoice_001',
    incomingReference: 'invoice_002',
    attemptCount: 3,
  }), {
    shouldUpdate: true,
    nextAttemptCount: 4,
  });
});
