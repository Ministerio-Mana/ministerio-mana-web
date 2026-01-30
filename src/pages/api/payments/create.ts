import type { APIRoute } from 'astro';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { resolveBaseUrl } from '@lib/url';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { createStripeDonationSession } from '@lib/stripe';
import { logSecurityEvent } from '@lib/securityEvents';
import { buildPaymentReference } from '@lib/cumbre2026';
import { countPayments, getBookingById, recordPayment } from '@lib/cumbreStore';

export const prerender = false;

function acceptsJson(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isTestModeAllowed(runtimeEnv: string): boolean {
  if (runtimeEnv === 'production') return false;
  const flag = env('CUMBRE_TEST_MODE') ?? env('PUBLIC_CUMBRE_TEST_MODE');
  return flag === 'true';
}

function getTestAmount(currency: string): number {
  const raw = currency === 'COP'
    ? env('CUMBRE_TEST_AMOUNT_COP') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_COP')
    : env('CUMBRE_TEST_AMOUNT_USD') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_USD');
  const fallback = currency === 'COP' ? 5000 : 1;
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

  const runtimeEnv =
    import.meta.env?.VERCEL_ENV ?? process.env?.VERCEL_ENV ?? process.env?.NODE_ENV ?? 'development';
  const allowTestMode = isTestModeAllowed(runtimeEnv);
  const enforceTurnstile = runtimeEnv === 'production';
  const turnstileConfigured = enforceTurnstile && Boolean(
    import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
  );
  if (turnstileConfigured) {
    const token = payload.cfToken?.toString() || payload['cf-turnstile-response'];
    if (token) {
      const okCaptcha = await verifyTurnstile(token, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'cumbre.payment',
          ip: clientAddress,
          detail: 'Turnstile invalido',
        });
        return new Response(JSON.stringify({ ok: false, error: 'Captcha invalido' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
    } else {
      console.warn('[CUMBRE] Turnstile sin token en pago: se omite validacion');
    }
  } else {
    console.warn('[CUMBRE] Turnstile no configurado: bypass en entorno local/dev');
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

    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    const remaining = Math.max(totalAmount - totalPaid, 0);
    if (remaining <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Reserva ya pagada' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const kind = (payload.paymentKind || 'custom').toString();
    const testMode = Boolean(payload.testMode) && allowTestMode;
    let amount = Number(payload.amount || 0);
    if (!amount || kind === 'full') amount = remaining;
    if (testMode) {
      amount = getTestAmount(booking.currency);
    }
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
    const tokenParam = payload.token ? `&token=${encodeURIComponent(payload.token)}` : '';
    const statusUrl = `${baseUrl}/eventos/cumbre-mundial-2026/estado?bookingId=${bookingId}${tokenParam}`;
    const registerUrl = `${baseUrl}/eventos/cumbre-mundial-2026/registro?bookingId=${bookingId}${tokenParam}`;

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
        redirectUrl: registerUrl,
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
      successUrl: registerUrl,
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
