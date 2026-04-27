import type { APIRoute } from 'astro';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizeDescription, validateCopAmount } from '@lib/donations';
import { resolveBaseUrl } from '@lib/url';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { parseDonationFormBase } from '@lib/donationInput';
import { buildDonationReference, createDonation } from '@lib/donationsStore';

export const prerender = false;

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
          identifier: 'wompi.checkout',
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
      console.warn('[WOMPI] Turnstile no configurado: bypass en entorno local/dev');
    }

    const rateKey = `wompi:${clientAddress ?? 'unknown'}`;
    const allowed = await enforceRateLimit(rateKey);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: rateKey,
        ip: clientAddress,
        userAgent,
        detail: 'Wompi checkout',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    const amountInput = Number(data.get('amount') || 0);
    let amountCop: number;
    try {
      amountCop = validateCopAmount(amountInput);
    } catch (error: any) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'Monto inválido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const description = sanitizeDescription(
      (data.get('description') ?? data.get('desc'))?.toString(),
      'Donación',
    );
    let donorInfo;
    try {
      donorInfo = parseDonationFormBase(data, 'CO');
    } catch (error: any) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'Datos inválidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const recurringFlag = String(data.get('isRecurring') || '').toLowerCase();
    const isRecurring = ['true', '1', 'on', 'yes'].includes(recurringFlag);
    const certificateFlag = String(data.get('needCertificate') || '').toLowerCase();
    const needCertificate = ['true', '1', 'on', 'yes'].includes(certificateFlag);

    const baseUrl = resolveBaseUrl(request);
    const reference = buildDonationReference();
    const redirect = new URL(`${baseUrl}/donaciones/gracias`);
    redirect.searchParams.set('ref', reference);
    redirect.searchParams.set('provider', 'wompi');
    redirect.searchParams.set('recurring', isRecurring ? '1' : '0');
    redirect.searchParams.set('type', donorInfo.donationType);
    redirect.searchParams.set('amount', String(amountCop));
    const { url } = buildWompiCheckoutUrl({
      amountInCents: amountCop * 100,
      currency: 'COP',
      description,
      redirectUrl: redirect.toString(),
      reference,
      email: donorInfo.email,
      customerData: {
        country: donorInfo.country,
        city: donorInfo.city,
        'phone-number': donorInfo.phone,
        'full-name': donorInfo.fullName,
        'legal-id': donorInfo.documentNumber,
        'legal-id-type': donorInfo.documentType,
      },
    });

    await createDonation({
      provider: 'wompi',
      status: 'PENDING',
      amount: amountCop,
      currency: 'COP',
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
      is_recurring: isRecurring,
      donor_country: donorInfo.country,
      donor_city: donorInfo.city,
      donation_description: description,
      need_certificate: needCertificate,
      source: 'donaciones-wompi',
      cumbre_booking_id: null,
      raw_event: null,
    });

    void logPaymentEvent('wompi', 'checkout.created', reference, {
      amount: amountCop,
      currency: 'COP',
      country: donorInfo.country,
      checkout_url: url,
    });

    if (acceptsJson(request)) {
      return new Response(JSON.stringify({ ok: true, provider: 'wompi', reference, url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(null, {
      status: 303,
      headers: { location: url },
    });
  } catch (error: any) {
    console.error('[wompi.checkout] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'wompi.checkout',
      ip: clientAddress,
      userAgent,
      detail: error?.message || 'Wompi checkout error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error procesando el pago' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
