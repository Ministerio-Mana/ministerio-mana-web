import type { APIRoute } from 'astro';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizeDescription, validateUsdAmount } from '@lib/donations';
import { resolveBaseUrl } from '@lib/url';
import { createStripeCustomer, createStripeDonationSession, createStripeInstallmentSession } from '@lib/stripe';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { stripeSupportedCurrencyCodes } from '@lib/geo';
import { DOCUMENT_TYPES_ANY, parseDonationFormBase } from '@lib/donationInput';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile } from '@lib/portalAuth';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  createDonationRecurringSubscription,
  parseDonationFrequency,
} from '@lib/donationRecurringSubscriptions';

export const prerender = false;

const SUPPORTED_CURRENCIES = new Set(stripeSupportedCurrencyCodes());

function acceptsJson(request: Request): boolean {
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

function buildReturnUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(`${baseUrl}/donaciones/gracias`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildLoginRedirect(baseUrl: string, params: {
  donationType?: string;
  amount?: number;
  frequency?: string;
} = {}): string {
  const url = new URL(`${baseUrl}/portal/ingresar`);
  const next = new URL(`${baseUrl}/donaciones/`);
  next.searchParams.set('recurring', '1');
  if (params.donationType) next.searchParams.set('type', params.donationType);
  if (params.amount) next.searchParams.set('amount', String(params.amount));
  if (params.frequency) next.searchParams.set('frequency', params.frequency);
  url.searchParams.set('next', `${next.pathname}${next.search}`);
  url.searchParams.set('reason', 'recurring-donation');
  return url.toString();
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
      donorInfo = parseDonationFormBase(data, 'UN', {
        requireDocument: false,
        allowedDocumentTypes: DOCUMENT_TYPES_ANY,
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'Datos inválidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const recurringFlag = String(data.get('isRecurring') || '').toLowerCase();
    const isRecurring = ['true', '1', 'on', 'yes'].includes(recurringFlag);
    const frequencyConfig = parseDonationFrequency(data.get('frequency'));
    if (isRecurring && currency !== 'USD') {
      return new Response(JSON.stringify({ ok: false, error: 'Las donaciones recurrentes internacionales se procesan en USD.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const certificateFlag = String(data.get('needCertificate') || '').toLowerCase();
    const needCertificate = ['true', '1', 'on', 'yes'].includes(certificateFlag);

    const baseUrl = resolveBaseUrl(request);
    const user = isRecurring ? await getUserFromRequest(request) : null;
    if (isRecurring && (!user?.id || !user.email)) {
      if (acceptsJson(request)) {
        return new Response(JSON.stringify({
          ok: false,
          requiresAccount: true,
          redirect: buildLoginRedirect(baseUrl, {
            donationType: donorInfo.donationType,
            amount: amountUsd,
            frequency: frequencyConfig.value,
          }),
          error: 'Para una donacion recurrente necesitas iniciar sesion o crear una cuenta.',
        }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: buildLoginRedirect(baseUrl, {
            donationType: donorInfo.donationType,
            amount: amountUsd,
            frequency: frequencyConfig.value,
          }),
        },
      });
    }

    const profile = user ? await ensureUserProfile(user) : null;
    const donorEmail = isRecurring && user?.email ? user.email.toLowerCase() : donorInfo.email;

    if (user?.id && supabaseAdmin) {
      const profileUpdates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (donorInfo.fullName) profileUpdates.full_name = donorInfo.fullName;
      if (donorInfo.phone) profileUpdates.phone = donorInfo.phone;
      if (donorInfo.city) profileUpdates.city = donorInfo.city;
      if (donorInfo.country) profileUpdates.country = donorInfo.country;
      if (donorInfo.documentType) profileUpdates.document_type = donorInfo.documentType;
      if (donorInfo.documentNumber) profileUpdates.document_number = donorInfo.documentNumber;
      if (donorInfo.church) profileUpdates.church_name = donorInfo.church;

      await supabaseAdmin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', user.id);
    }

    const reference = buildDonationReference();
    const successUrl = buildReturnUrl(baseUrl, {
      ref: reference,
      provider: 'stripe',
      recurring: isRecurring ? '1' : '0',
      type: donorInfo.donationType,
      amount: String(amountUsd),
    });
    const cancelUrl = (import.meta.env?.STRIPE_CANCEL_URL ?? process.env.STRIPE_CANCEL_URL) || `${baseUrl}/donaciones`;
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
      donor_email: donorEmail,
      donor_phone: donorInfo.phone,
      donor_document_type: donorInfo.documentType,
      donor_document_number: donorInfo.documentNumber,
      is_recurring: isRecurring,
      donor_country: donorInfo.country,
      donor_city: donorInfo.city,
      donation_description: description,
      need_certificate: needCertificate,
      source: 'donaciones-stripe',
      cumbre_booking_id: null,
      raw_event: {
        frequency: isRecurring ? frequencyConfig.value : null,
      },
    });

    let recurringSubscriptionId = '';
    let stripeCustomerId = '';
    let session;
    if (isRecurring) {
      const customer = await createStripeCustomer({
        email: donorEmail,
        name: donorInfo.fullName,
        metadata: {
          portal_user_id: user?.id || '',
          source: 'donation-recurring',
        },
      });
      stripeCustomerId = customer.id;
      const subscription = await createDonationRecurringSubscription({
        userId: user!.id,
        status: 'PENDING',
        provider: 'stripe',
        amount: amountUsd,
        currency: currency as 'USD',
        frequency: frequencyConfig.value,
        donationType: donorInfo.donationType,
        projectName: donorInfo.projectName,
        eventName: donorInfo.eventName,
        campus: donorInfo.campus,
        church: donorInfo.church || profile?.church_name || '',
        donorName: donorInfo.fullName,
        donorEmail,
        donorPhone: donorInfo.phone,
        donorDocumentType: donorInfo.documentType,
        donorDocumentNumber: donorInfo.documentNumber,
        donorCity: donorInfo.city,
        donorCountry: donorInfo.country || profile?.country || '',
        donationDescription: description,
        needCertificate,
        providerCustomerId: stripeCustomerId,
        providerReference: reference,
        lastDonationId: donation.id,
        metadata: {
          source: 'donations-form',
          frequency_label: frequencyConfig.label,
        },
      });
      recurringSubscriptionId = subscription.id;

      session = await createStripeInstallmentSession({
        amount: amountUsd,
        currency,
        description,
        interval: frequencyConfig.stripeInterval,
        intervalCount: frequencyConfig.stripeIntervalCount,
        successUrl,
        cancelUrl,
        metadata: {
          country: donorInfo.country,
          source: 'donations_form',
          donation_reference: reference,
          donation_id: donation.id,
          donation_subscription_id: recurringSubscriptionId,
          portal_user_id: user?.id || '',
          frequency: frequencyConfig.value,
        },
        customerId: stripeCustomerId,
      });
    } else {
      session = await createStripeDonationSession({
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
        customerEmail: donorEmail,
      });
    }

    void logPaymentEvent('stripe', 'checkout.created', session.id, {
      amount: amountUsd,
      currency,
      country: donorInfo.country,
      donation_reference: reference,
      session_id: session.id,
      payment_status: session.payment_status,
      donation_subscription_id: recurringSubscriptionId || null,
    });

    if (!session.url) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la sesión de pago' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (acceptsJson(request)) {
      return new Response(JSON.stringify({
        ok: true,
        provider: 'stripe',
        sessionId: session.id,
        url: session.url,
        donationSubscriptionId: recurringSubscriptionId || null,
      }), {
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
