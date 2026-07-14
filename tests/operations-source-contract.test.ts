import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('el cron de donaciones reclama la suscripción antes de crear el cobro', () => {
  const recurringSource = source('../src/pages/api/donations/subscriptions/run.ts');
  assert.match(recurringSource, /claimDueWompiDonationRecurringSubscription/);
  assert.ok(
    recurringSource.indexOf('claimDueWompiDonationRecurringSubscription({')
      < recurringSource.indexOf('donation = await createDonation({'),
  );
});

test('los crons centralizan autenticación y los de donaciones no aceptan token en URL', () => {
  const cronPaths = [
    '../src/pages/api/donations/reminders/run.ts',
    '../src/pages/api/donations/subscriptions/run.ts',
    '../src/pages/api/campus/subscriptions/run.ts',
    '../src/pages/api/security/alerts/run.ts',
    '../src/pages/api/wompi/reconcile-pending.ts',
    '../src/pages/api/events/payment-evidence/retention/run.ts',
    '../src/pages/api/cumbre2026/installments/run.ts',
    '../src/pages/api/cumbre2026/installments/reminders/run.ts',
  ];
  cronPaths.forEach((path) => assert.match(source(path), /isCronRequestAuthorized/));
  assert.doesNotMatch(source(cronPaths[0]), /searchParams\.get\(['"]token/);
  assert.doesNotMatch(source(cronPaths[1]), /searchParams\.get\(['"]token/);
});

test('Cumbre deduplica fallos y avisos de webhooks por referencia', () => {
  const stripeSource = source('../src/pages/api/stripe/webhook.ts');
  const wompiSource = source('../src/pages/api/wompi/events-forwarded.ts');
  assert.match(stripeSource, /resolveWebhookFailureTransition/);
  assert.match(wompiSource, /resolveWebhookFailureTransition/);
  assert.match(wompiSource, /hasApprovedPaymentByReference/);
  assert.match(wompiSource, /!alreadyApproved/);
});
