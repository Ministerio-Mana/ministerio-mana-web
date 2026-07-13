import { supabaseAdmin } from '@lib/supabaseAdmin';
import { resolveBaseUrl } from '@lib/url';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { createStripeDonationSession } from '@lib/stripe';
import { buildEventPaymentReference, createEventPaymentId } from '@lib/eventFinance';
import {
  getRequiredEventProviderCurrency,
  isValidEventProviderCurrency,
} from '@lib/eventPaymentContract.js';

export type EventCheckoutProvider = 'WOMPI' | 'STRIPE';

export class EventCheckoutError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'EventCheckoutError';
    this.status = status;
  }
}

function eventIsOpen(event: any): boolean {
  if (String(event?.status || '').toUpperCase() !== 'PUBLISHED') return false;
  if (String(event?.registration_mode || '').toUpperCase() !== 'INTERNAL') return false;
  const now = Date.now();
  const end = new Date(event?.end_date || event?.start_date || '').getTime();
  if (Number.isFinite(end) && end < now) return false;
  const opensAt = new Date(event?.registration_opens_at || '').getTime();
  if (Number.isFinite(opensAt) && opensAt > now) return false;
  const closesAt = new Date(event?.registration_closes_at || '').getTime();
  return !Number.isFinite(closesAt) || closesAt >= now;
}

export async function createEventCheckout(params: {
  request: Request;
  registrationId: string;
  provider: EventCheckoutProvider;
  idempotencyKey: string;
  actorUserId?: string | null;
  authorizeEvent?: (event: any) => Promise<boolean>;
}): Promise<{
  paymentId: string;
  reference: string;
  checkoutUrl: string;
  reused: boolean;
  eventId: string;
}> {
  if (!supabaseAdmin) throw new EventCheckoutError('Server Config Error', 500);

  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('event_registrations')
    .select('id, event_id, contact_name, contact_email, total_amount, currency, status, expires_at')
    .eq('id', params.registrationId)
    .maybeSingle();
  if (registrationError) throw new EventCheckoutError('No se pudo consultar la inscripción.', 500);
  if (!registration) throw new EventCheckoutError('Inscripción no encontrada.', 404);
  if (['CANCELLED', 'REFUNDED', 'EXPIRED'].includes(String(registration.status || '').toUpperCase())) {
    throw new EventCheckoutError('La inscripción ya no admite pagos.', 409);
  }
  const expiry = new Date(registration.expires_at || '').getTime();
  if (Number.isFinite(expiry) && expiry <= Date.now()) {
    await supabaseAdmin
      .from('event_registrations')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('id', registration.id)
      .eq('status', 'PENDING_PAYMENT');
    throw new EventCheckoutError('La reserva de cupo venció. Inicia una nueva inscripción.', 409);
  }
  if (params.provider === 'STRIPE' && Number.isFinite(expiry) && expiry - Date.now() < 30 * 60 * 1000) {
    await supabaseAdmin
      .from('event_registrations')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('id', registration.id)
      .eq('status', 'PENDING_PAYMENT');
    throw new EventCheckoutError('La reserva está por vencer. Inicia una nueva inscripción.', 409);
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, title, slug, scope, church_id, region_id, country, status, registration_mode, registration_opens_at, registration_closes_at, start_date, end_date')
    .eq('id', registration.event_id)
    .maybeSingle();
  if (eventError) throw new EventCheckoutError('No se pudo consultar el evento.', 500);
  if (!event) throw new EventCheckoutError('Evento no encontrado.', 404);
  if (params.authorizeEvent && !(await params.authorizeEvent(event))) {
    throw new EventCheckoutError('No tienes permisos financieros para este evento.', 403);
  }
  if (!eventIsOpen(event)) throw new EventCheckoutError('El evento no está abierto para nuevos cobros.', 409);

  const currency = String(registration.currency || '').toUpperCase();
  if (!isValidEventProviderCurrency(params.provider, currency)) {
    const providerLabel = params.provider === 'WOMPI' ? 'Wompi' : 'Stripe';
    const requiredCurrency = getRequiredEventProviderCurrency(params.provider);
    throw new EventCheckoutError(`${providerLabel} solo puede cobrar este evento en ${requiredCurrency}.`);
  }

  const { data: paymentOption, error: paymentOptionError } = await supabaseAdmin
    .from('event_payment_options')
    .select('id, provider, currency, kind, is_active')
    .eq('event_id', event.id)
    .eq('provider', params.provider)
    .eq('currency', currency)
    .eq('kind', 'ONLINE')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (paymentOptionError) throw new EventCheckoutError('No se pudo validar el método de pago.', 500);
  if (!paymentOption) {
    throw new EventCheckoutError(`Activa ${params.provider === 'WOMPI' ? 'Wompi' : 'Stripe'} para este evento antes de generar el cobro.`, 409);
  }

  const { data: approvedPayments, error: approvedError } = await supabaseAdmin
    .from('event_payments')
    .select('amount')
    .eq('registration_id', registration.id)
    .eq('status', 'APPROVED');
  if (approvedError) throw new EventCheckoutError('No se pudo calcular el saldo.', 500);
  const paid = (approvedPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const amount = Number(registration.total_amount || 0) - paid;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new EventCheckoutError('La inscripción no tiene saldo pendiente.', 409);
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('event_payments')
    .select('id, registration_id, payment_option_id, provider, reference, amount, currency, status, provider_payload')
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new EventCheckoutError('No se pudo validar el intento de pago.', 500);
  let paymentId = createEventPaymentId();
  let reference = buildEventPaymentReference(paymentId);
  let resumedAttempt = false;
  if (existing) {
    if (existing.registration_id !== registration.id || existing.provider !== params.provider) {
      throw new EventCheckoutError('La clave de idempotencia ya fue utilizada.', 409);
    }
    const checkoutUrl = (existing.provider_payload as any)?.checkout_url;
    if (checkoutUrl && existing.status === 'PENDING') {
      return {
        paymentId: existing.id,
        reference: existing.reference,
        checkoutUrl,
        reused: true,
        eventId: event.id,
      };
    }
    const existingMatches = existing.status === 'PENDING'
      && existing.payment_option_id === paymentOption.id
      && Math.abs(Number(existing.amount || 0) - amount) < 0.005
      && String(existing.currency || '').toUpperCase() === currency;
    if (!existingMatches) throw new EventCheckoutError('Este intento de pago ya fue procesado.', 409);
    paymentId = existing.id;
    reference = existing.reference;
    resumedAttempt = true;
  }

  const now = new Date().toISOString();
  if (!resumedAttempt) {
    const { error: insertError } = await supabaseAdmin.from('event_payments').insert({
      id: paymentId,
      event_id: event.id,
      registration_id: registration.id,
      payment_option_id: paymentOption.id,
      provider: params.provider,
      reference,
      amount,
      currency,
      status: 'PENDING',
      idempotency_key: params.idempotencyKey,
      provider_payload: {},
      created_at: now,
      updated_at: now,
    });
    if (insertError) throw new EventCheckoutError('No se pudo crear el intento de pago.', 500);
  }

  const baseUrl = resolveBaseUrl(params.request);
  const publicIdentifier = String(event.slug || event.id);
  const returnBase = `${baseUrl}/eventos/${encodeURIComponent(publicIdentifier)}`;
  let checkoutUrl = '';
  let providerCheckoutId: string | null = null;

  try {
    if (params.provider === 'WOMPI') {
      const checkout = buildWompiCheckoutUrl({
        amountInCents: Math.round(amount * 100),
        currency: 'COP',
        description: `Inscripción · ${String(event.title || 'Evento').slice(0, 100)}`,
        redirectUrl: `${returnBase}?payment=return&reference=${encodeURIComponent(reference)}`,
        reference,
        email: registration.contact_email || undefined,
      });
      checkoutUrl = checkout.url;
    } else {
      const expiresAt = Number.isFinite(expiry)
        ? Math.floor(expiry / 1000)
        : Math.floor(Date.now() / 1000) + 30 * 60;
      const session = await createStripeDonationSession({
        amountUsd: amount,
        currency,
        description: `Inscripción · ${String(event.title || 'Evento').slice(0, 100)}`,
        successUrl: `${returnBase}?payment=success&reference=${encodeURIComponent(reference)}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${returnBase}?payment=cancelled&reference=${encodeURIComponent(reference)}`,
        customerEmail: registration.contact_email || undefined,
        clientReferenceId: registration.id,
        idempotencyKey: params.idempotencyKey,
        allowPromotionCodes: false,
        expiresAt,
        metadata: {
          payment_domain: 'EVENT',
          event_id: event.id,
          event_registration_id: registration.id,
          event_payment_id: paymentId,
          event_payment_reference: reference,
        },
      });
      checkoutUrl = session.url || '';
      providerCheckoutId = session.id;
    }
    if (!checkoutUrl) throw new Error('El proveedor no devolvió un enlace de pago');

    const { error: paymentUpdateError } = await supabaseAdmin
      .from('event_payments')
      .update({
        provider_payload: {
          checkout_id: providerCheckoutId,
          checkout_url: checkoutUrl,
          checkout_created_at: now,
        },
        updated_at: now,
      })
      .eq('id', paymentId);
    if (paymentUpdateError) throw paymentUpdateError;

    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: event.id,
      registration_id: registration.id,
      payment_id: paymentId,
      actor_user_id: params.actorUserId || null,
      action: resumedAttempt ? 'CHECKOUT_RECOVERED' : 'CHECKOUT_CREATED',
      after_data: { provider: params.provider, amount, currency, reference, checkout_id: providerCheckoutId },
    });

    return { paymentId, reference, checkoutUrl, reused: resumedAttempt, eventId: event.id };
  } catch (error: any) {
    await supabaseAdmin
      .from('event_payments')
      .update({
        status: 'FAILED',
        provider_payload: { checkout_error: String(error?.message || 'Provider error').slice(0, 500) },
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);
    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: event.id,
      registration_id: registration.id,
      payment_id: paymentId,
      actor_user_id: params.actorUserId || null,
      action: 'CHECKOUT_FAILED',
      after_data: { provider: params.provider, reference, error: String(error?.message || 'Provider error').slice(0, 500) },
    });
    console.error('[event.checkout] provider error', error);
    throw new EventCheckoutError('No se pudo abrir el proveedor de pago.', 502);
  }
}
