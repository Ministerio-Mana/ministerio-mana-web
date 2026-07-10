import type { APIRoute } from 'astro';
import { verifyWompiWebhook } from '@lib/wompi';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';
import { markWompiEventProcessed, storeWompiEvent } from '@lib/wompiEventInbox';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.text();
  const signature = request.headers.get('x-event-checksum') || request.headers.get('x-wompi-signature');
  let verified = false;
  let bodySha256 = '';

  try {
    const valid = verifyWompiWebhook(payload, signature);
    if (!valid) {
      throw new Error('Firma Wompi inválida');
    }
    verified = true;
    const event = JSON.parse(payload);
    const eventName = event?.event ?? 'wompi.webhook';
    const transaction = event?.data?.transaction;
    const reference = transaction?.reference ?? null;
    const storedEvent = await storeWompiEvent({ payload, event, source: 'DIRECT' });
    bodySha256 = storedEvent.bodySha256;
    if (!storedEvent.stored) {
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'wompi.webhook.inbox',
        detail: 'No se pudo guardar el evento Wompi en el buzón',
        meta: { reference, transactionId: transaction?.id ? String(transaction.id) : null },
      });
    }

    await logPaymentEvent('wompi', eventName, reference, event);

    const result = await processWompiDonationTransaction({ event, transaction });
    const processingStatus = result.outcome === 'PROCESSED'
      ? 'PROCESSED'
      : result.outcome === 'REJECTED'
        ? 'REJECTED'
        : 'IGNORED';
    await markWompiEventProcessed({
      bodySha256,
      status: processingStatus,
      error: result.reason || null,
    });
    return json({ ok: true, processed: result.processed, outcome: result.outcome }, 200);
  } catch (error: any) {
    console.error('[wompi.webhook] error', error);
    if (verified && bodySha256) {
      await markWompiEventProcessed({
        bodySha256,
        status: 'FAILED',
        error: error?.message || 'Wompi webhook processing error',
      });
    }
    void logSecurityEvent({
      type: verified ? 'payment_error' : 'webhook_invalid',
      identifier: 'wompi',
      detail: error?.message || 'Wompi webhook error',
    });
    return verified
      ? json({ ok: false, error: 'No se pudo procesar el evento' }, 500)
      : json({ ok: false, error: 'Firma inválida' }, 401);
  }
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
