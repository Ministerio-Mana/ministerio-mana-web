import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceRateLimit } from '@lib/rateLimit';
import { resolveBaseUrl } from '@lib/url';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { createStripeDonationSession } from '@lib/stripe';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { buildEventPaymentReference, createEventPaymentId } from '@lib/eventFinance';

export const prerender = false;

const PROVIDERS = new Set(['WOMPI', 'STRIPE']);
const MAX_BODY_CHARS = 2_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function normalizeIdempotencyKey(request: Request, registrationId: string): string {
  const raw = String(request.headers.get('idempotency-key') || '').trim();
  const key = /^[A-Za-z0-9._:-]{16,120}$/.test(raw) ? raw : createEventPaymentId();
  return `event-checkout:${registrationId}:${key}`;
}

function eventIsOpen(event: any): boolean {
  if (String(event?.status || '').toUpperCase() !== 'PUBLISHED') return false;
  const end = new Date(event?.end_date || event?.start_date || '').getTime();
  return !Number.isFinite(end) || end >= Date.now();
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);

  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }

  const allowed = await enforceRateLimit(`event-checkout:${ctx.userId}`, 60, 20, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const registrationId = String(body.registration_id || '').trim();
  const provider = String(body.provider || '').trim().toUpperCase();
  if (!registrationId || !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'Inscripción o proveedor inválido.' }, 400);
  }

  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('event_registrations')
    .select('id, event_id, contact_name, contact_email, total_amount, currency, status')
    .eq('id', registrationId)
    .maybeSingle();
  if (registrationError) return json({ ok: false, error: 'No se pudo consultar la inscripción.' }, 500);
  if (!registration) return json({ ok: false, error: 'Inscripción no encontrada.' }, 404);
  if (['CANCELLED', 'REFUNDED', 'EXPIRED'].includes(String(registration.status || '').toUpperCase())) {
    return json({ ok: false, error: 'La inscripción ya no admite pagos.' }, 409);
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, title, slug, scope, church_id, region_id, country, status, start_date, end_date')
    .eq('id', registration.event_id)
    .maybeSingle();
  if (eventError) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }
  if (!eventIsOpen(event)) {
    return json({ ok: false, error: 'El evento no está abierto para nuevos cobros.' }, 409);
  }

  const currency = String(registration.currency || '').toUpperCase();
  if (provider === 'WOMPI' && currency !== 'COP') {
    return json({ ok: false, error: 'Wompi solo puede cobrar este evento en COP.' }, 400);
  }
  if (provider === 'STRIPE' && !['USD', 'EUR', 'COP'].includes(currency)) {
    return json({ ok: false, error: 'Stripe no está habilitado para esta moneda.' }, 400);
  }

  const { data: paymentOption, error: paymentOptionError } = await supabaseAdmin
    .from('event_payment_options')
    .select('id, provider, currency, kind, is_active')
    .eq('event_id', event.id)
    .eq('provider', provider)
    .eq('currency', currency)
    .eq('kind', 'ONLINE')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (paymentOptionError) return json({ ok: false, error: 'No se pudo validar el método de pago.' }, 500);
  if (!paymentOption) {
    return json({ ok: false, error: `Activa ${provider === 'WOMPI' ? 'Wompi' : 'Stripe'} para este evento antes de generar el cobro.` }, 409);
  }

  const { data: approvedPayments, error: approvedError } = await supabaseAdmin
    .from('event_payments')
    .select('amount')
    .eq('registration_id', registration.id)
    .eq('status', 'APPROVED');
  if (approvedError) return json({ ok: false, error: 'No se pudo calcular el saldo.' }, 500);
  const paid = (approvedPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const amount = Number(registration.total_amount || 0) - paid;
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ ok: false, error: 'La inscripción no tiene saldo pendiente.' }, 409);
  }

  const idempotencyKey = normalizeIdempotencyKey(request, registration.id);
  const { data: existing } = await supabaseAdmin
    .from('event_payments')
    .select('id, registration_id, provider, reference, status, provider_payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) {
    if (existing.registration_id !== registration.id || existing.provider !== provider) {
      return json({ ok: false, error: 'La clave de idempotencia ya fue utilizada.' }, 409);
    }
    const checkoutUrl = (existing.provider_payload as any)?.checkout_url;
    if (checkoutUrl && existing.status === 'PENDING') {
      return json({ ok: true, payment_id: existing.id, reference: existing.reference, checkout_url: checkoutUrl, reused: true });
    }
    return json({ ok: false, error: 'Este intento de pago ya fue procesado.' }, 409);
  }

  const paymentId = createEventPaymentId();
  const reference = buildEventPaymentReference(paymentId);
  const now = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin.from('event_payments').insert({
    id: paymentId,
    event_id: event.id,
    registration_id: registration.id,
    payment_option_id: paymentOption.id,
    provider,
    reference,
    amount,
    currency,
    status: 'PENDING',
    idempotency_key: idempotencyKey,
    provider_payload: {},
    created_at: now,
    updated_at: now,
  });
  if (insertError) return json({ ok: false, error: 'No se pudo crear el intento de pago.' }, 500);

  const baseUrl = resolveBaseUrl(request);
  const publicIdentifier = String(event.slug || event.id);
  const returnBase = `${baseUrl}/eventos/${encodeURIComponent(publicIdentifier)}`;
  let checkoutUrl = '';
  let providerCheckoutId: string | null = null;

  try {
    if (provider === 'WOMPI') {
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
      const session = await createStripeDonationSession({
        amountUsd: amount,
        currency,
        description: `Inscripción · ${String(event.title || 'Evento').slice(0, 100)}`,
        successUrl: `${returnBase}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${returnBase}?payment=cancelled`,
        customerEmail: registration.contact_email || undefined,
        clientReferenceId: registration.id,
        idempotencyKey,
        allowPromotionCodes: false,
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

    if (registration.status === 'DRAFT') {
      await supabaseAdmin
        .from('event_registrations')
        .update({ status: 'PENDING_PAYMENT', updated_at: now })
        .eq('id', registration.id);
    }
    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: event.id,
      registration_id: registration.id,
      payment_id: paymentId,
      actor_user_id: ctx.userId,
      action: 'CHECKOUT_CREATED',
      after_data: { provider, amount, currency, reference, checkout_id: providerCheckoutId },
    });

    return json({ ok: true, payment_id: paymentId, reference, checkout_url: checkoutUrl, reused: false });
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
      actor_user_id: ctx.userId,
      action: 'CHECKOUT_FAILED',
      after_data: { provider, reference, error: String(error?.message || 'Provider error').slice(0, 500) },
    });
    console.error('[event.checkout] provider error', error);
    return json({ ok: false, error: 'No se pudo abrir el proveedor de pago.' }, 502);
  }
};
