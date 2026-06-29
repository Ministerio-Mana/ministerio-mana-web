import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { enforceRateLimit } from '@lib/rateLimit';
import { resolveBaseUrl } from '@lib/url';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { createStripeDonationSession } from '@lib/stripe';
import { logSecurityEvent } from '@lib/securityEvents';
import { buildPaymentReference, hashToken } from '@lib/cumbre2026';
import {
  countPayments,
  getApprovedPaymentsTotal,
  getBookingById,
  listActivePendingPayments,
  recordPayment,
} from '@lib/cumbreStore';

export const prerender = false;

function acceptsJson(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isValidBookingToken(token: unknown, tokenHash: unknown): boolean {
  const normalizedToken = String(token || '').trim();
  const storedHash = String(tokenHash || '').trim();
  if (!normalizedToken || !storedHash) return false;
  return safeEqual(hashToken(normalizedToken), storedHash);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const contentType = request.headers.get('content-type') || '';
  let payload: any = {};

  try {
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = {
        bookingId: form.get('bookingId'),
        amount: form.get('amount'),
        paymentKind: form.get('paymentKind'),
        token: form.get('token'),
        cfToken: form.get('cf-turnstile-response'),
      };
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = (payload.bookingId || '').toString();
  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = await enforceRateLimit(`cumbre.payments:${clientAddress ?? 'unknown'}`);
  if (!allowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: 'cumbre.payment',
      ip: clientAddress,
      detail: 'Cumbre payment',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const booking = await getBookingById(bookingId);
    if (!booking) {
      return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!isValidBookingToken(payload.token, booking.token_hash)) {
      void logSecurityEvent({
        type: 'webhook_invalid',
        identifier: 'cumbre.payment',
        ip: clientAddress,
        detail: 'Token de reserva invalido en inicio de pago',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Token invalido' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = await getApprovedPaymentsTotal(bookingId);
    const remaining = Math.max(totalAmount - totalPaid, 0);
    if (remaining <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Reserva ya pagada' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const pendingPayments = await listActivePendingPayments({ bookingId });
    if (pendingPayments.length > 0) {
      const pendingAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      return new Response(JSON.stringify({
        ok: false,
        error: 'Ya tienes un pago en verificación. Espera confirmación antes de intentar de nuevo.',
        pendingCount: pendingPayments.length,
        pendingAmount,
      }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    const kind = (payload.paymentKind || 'custom').toString();
    let amount = Number(payload.amount || 0);
    if (!amount || kind === 'full') amount = remaining;
    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Monto invalido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (amount > remaining) {
      amount = remaining;
    }

    const paymentIndex = (await countPayments(bookingId)) + 1;
    const reference = buildPaymentReference(bookingId, paymentIndex);
    const baseUrl = resolveBaseUrl(request);
    const statusUrl = `${baseUrl}/eventos/cumbre-mundial-2026/estado?bookingId=${bookingId}&source=payment`;

    if (booking.currency === 'COP') {
      await recordPayment({
        bookingId,
        provider: 'wompi',
        providerTxId: null,
        reference,
        amount,
        currency: 'COP',
        status: 'PENDING',
      });

      const { url } = buildWompiCheckoutUrl({
        amountInCents: Math.round(amount * 100),
        currency: 'COP',
        description: 'Cumbre Mundial 2026',
        redirectUrl: statusUrl,
        reference,
        email: booking.contact_email || undefined,
      });

      if (acceptsJson(request)) {
        return new Response(JSON.stringify({ ok: true, provider: 'wompi', reference, url }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(null, { status: 303, headers: { location: url } });
    }

    await recordPayment({
      bookingId,
      provider: 'stripe',
      providerTxId: null,
      reference,
      amount,
      currency: 'USD',
      status: 'PENDING',
    });

    const session = await createStripeDonationSession({
      amountUsd: amount,
      currency: 'USD',
      description: 'Cumbre Mundial 2026',
      successUrl: statusUrl,
      cancelUrl: statusUrl,
      metadata: {
        cumbre_booking_id: bookingId,
        cumbre_reference: reference,
        payment_index: String(paymentIndex),
      },
      customerEmail: booking.contact_email || undefined,
    });

    if (!session.url) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear el pago' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (acceptsJson(request)) {
      return new Response(JSON.stringify({ ok: true, provider: 'stripe', reference, url: session.url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(null, { status: 303, headers: { location: session.url } });
  } catch (error: any) {
    console.error('[cumbre.payment] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'cumbre.payment',
      ip: clientAddress,
      detail: error?.message || 'Payment error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error procesando pago' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
