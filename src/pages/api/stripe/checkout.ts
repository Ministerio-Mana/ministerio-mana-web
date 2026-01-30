import type { APIRoute } from 'astro';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizeDescription, validateUsdAmount } from '@lib/donations';
import { resolveBaseUrl } from '@lib/url';
import { createStripeDonationSession } from '@lib/stripe';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { stripeSupportedCurrencyCodes } from '@lib/geo';
import { parseDonationFormBase } from '@lib/donationInput';
import { buildDonationReference, createDonation } from '@lib/donationsStore';

export const prerender = false;

const SUPPORTED_CURRENCIES = new Set(stripeSupportedCurrencyCodes());

function acceptsJson(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const userAgent = request.headers.get('user-agent') || '';
  try {
    const data = await request.formData();
    const captchaToken = data.get('cf-turnstile-response')?.toString();
    const turnstileConfigured = Boolean(
      import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
    );
    if (turnstileConfigured) {
      const okCaptcha = await verifyTurnstile(captchaToken, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'stripe.checkout',
          ip: clientAddress,
          userAgent,
          detail: 'Turnstile inválido',
        });
        return new Response(JSON.stringify({ ok: false, error: 'Captcha inválido' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
    } else {
      // Solo bypass en entornos sin llaves (dev/local). En prod debe estar configurado.
      console.warn('[STRIPE] Turnstile no configurado: bypass en entorno local/dev');
    }

    const rateKey = `stripe:${clientAddress ?? 'unknown'}`;
    const allowed = await enforceRateLimit(rateKey);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: rateKey,
        ip: clientAddress,
        userAgent,
        detail: 'Stripe checkout',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    // El formulario envía "amount"; dejamos compatibilidad con "amountUsd" por si se usa desde otro lugar.
    const amountInput = Number(data.get('amountUsd') ?? data.get('amount') ?? 0);
    let amountUsd: number;
    try {
      amountUsd = validateUsdAmount(amountInput);
    } catch (error: any) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'Monto inválido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const currency = String(data.get('currency') || 'USD').toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      return new Response(JSON.stringify({ ok: false, error: 'Moneda no soportada' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const description = sanitizeDescription(
      (data.get('description') ?? data.get('desc'))?.toString(),
      'Donation',
    );
    let donorInfo;
    try {
      donorInfo = parseDonationFormBase(data, 'UN');
    } catch (error: any) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'Datos inválidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const baseUrl = resolveBaseUrl(request);
    const successUrl = (import.meta.env?.STRIPE_SUCCESS_URL ?? process.env.STRIPE_SUCCESS_URL) || `${baseUrl}/donaciones/gracias`;
    const cancelUrl = (import.meta.env?.STRIPE_CANCEL_URL ?? process.env.STRIPE_CANCEL_URL) || `${baseUrl}/donaciones`;

    const reference = buildDonationReference();
    const donation = await createDonation({
      provider: 'stripe',
      status: 'PENDING',
      amount: amountUsd,
      currency,
      reference,
      provider_tx_id: null,
      payment_method: null,
      donation_type: donorInfo.donationType,
      project_name: donorInfo.projectName,
      event_name: donorInfo.eventName,
      campus: donorInfo.campus,
      church: donorInfo.church,
      church_city: donorInfo.city,
      donor_name: donorInfo.fullName,
      donor_email: donorInfo.email,
      donor_phone: donorInfo.phone,
      donor_document_type: donorInfo.documentType,
      donor_document_number: donorInfo.documentNumber,
      donor_country: donorInfo.country,
      donor_city: donorInfo.city,
      source: 'donaciones-stripe',
      cumbre_booking_id: null,
      raw_event: null,
    });

    const session = await createStripeDonationSession({
      amountUsd,
      currency,
      description,
      successUrl,
      cancelUrl,
      metadata: {
        country: donorInfo.country,
        source: 'donations_form',
        donation_reference: reference,
        donation_id: donation.id,
      },
      customerEmail: donorInfo.email,
    });

    void logPaymentEvent('stripe', 'checkout.created', session.id, {
      amount: amountUsd,
      currency,
      country: donorInfo.country,
      donation_reference: reference,
      session_id: session.id,
      payment_status: session.payment_status,
    });

    if (!session.url) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la sesión de pago' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (acceptsJson(request)) {
      return new Response(JSON.stringify({ ok: true, provider: 'stripe', sessionId: session.id, url: session.url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(null, {
      status: 303,
      headers: { location: session.url },
    });
  } catch (error: any) {
    console.error('[stripe.checkout] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'stripe.checkout',
      ip: clientAddress,
      userAgent,
      detail: error?.message || 'Stripe checkout error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error procesando el pago' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
