import type { APIRoute } from 'astro';
import { getDonationByReference } from '@lib/donationsStore';
import { enforceRateLimit } from '@lib/rateLimit';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { getWompiTransaction } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';

export const prerender = false;

function isValidTransactionId(value: string): boolean {
  return /^[A-Za-z0-9-]{8,100}$/.test(value);
}

function isValidReference(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const allowed = await enforceRateLimit(`wompi-reconcile:${clientAddress || 'unknown'}`);
  if (!allowed) {
    return json({ ok: false, error: 'Demasiadas solicitudes' }, 429);
  }

  const body = await request.json().catch(() => null);
  const transactionId = String(body?.transactionId || '').trim();
  const reference = String(body?.reference || '').trim();
  if (!isValidTransactionId(transactionId) || !isValidReference(reference)) {
    return json({ ok: false, error: 'Datos incompletos' }, 400);
  }

  const donation = await getDonationByReference('wompi', reference);
  if (!donation) {
    return json({ ok: false, error: 'Pago no encontrado' }, 404);
  }

  try {
    const transaction = await getWompiTransaction(transactionId);
    if (!transaction) {
      return json({ ok: false, error: 'Transacción no encontrada' }, 404);
    }

    const event = {
      event: 'transaction.reconciled',
      timestamp: Date.now(),
      source: 'wompi_api_return',
      data: { transaction },
    };
    const result = await processWompiDonationTransaction({ event, transaction });
    if (result.outcome === 'REJECTED') {
      return json({ ok: false, error: 'La transacción no coincide con el pago' }, 409);
    }
    if (!result.processed) {
      return json({ ok: false, error: 'No se pudo conciliar el pago' }, 409);
    }

    await logPaymentEvent('wompi', 'transaction.reconciled', reference, {
      transactionId,
      status: result.status,
      source: 'checkout-return',
    });
    return json({ ok: true, status: result.status }, 200);
  } catch (error: any) {
    console.error('[wompi.reconcile] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'wompi.reconcile',
      detail: error?.message || 'No se pudo conciliar Wompi',
      meta: { reference, transactionId },
    });
    return json({ ok: false, error: 'No se pudo consultar Wompi' }, 502);
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
