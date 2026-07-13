import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceRateLimit } from '@lib/rateLimit';
import { verifyTurnstile } from '@lib/turnstile';
import { containsBlockedSequence, sanitizePlainText } from '@lib/validation';
import { createEventCheckout, EventCheckoutError, type EventCheckoutProvider } from '@lib/eventCheckout';
import { DEFAULT_EVENT_REGISTRATION_FORM_CONFIG, normalizeEventRegistrationFormConfig } from '@lib/eventRegistrationForm.js';

export const prerender = false;

const MAX_BODY_CHARS = 6_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONLINE_PROVIDERS = new Set(['WOMPI', 'STRIPE']);
const MANUAL_PROVIDERS = new Set(['MANUAL', 'EXTERNAL']);
const PROVIDERS = new Set([...ONLINE_PROVIDERS, ...MANUAL_PROVIDERS]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function registrationErrorMessage(message: string): { status: number; message: string } {
  if (message.includes('EVENT_NOT_FOUND')) return { status: 404, message: 'El evento no existe.' };
  if (message.includes('EVENT_REGISTRATION_NOT_OPEN')) return { status: 409, message: 'Las inscripciones todavía no están abiertas.' };
  if (message.includes('EVENT_REGISTRATION_CLOSED')) return { status: 409, message: 'Las inscripciones están cerradas.' };
  if (message.includes('EVENT_CAPACITY_EXCEEDED')) return { status: 409, message: 'No hay cupos suficientes para esta inscripción.' };
  if (message.includes('PAYMENT_OPTION')) return { status: 409, message: 'El método de pago ya no está disponible.' };
  if (message.includes('INVALID_DONATION_AMOUNT')) return { status: 400, message: 'Ingresa un aporte válido.' };
  if (message.includes('INVALID_QUANTITY')) return { status: 400, message: 'La cantidad de asistentes no es válida.' };
  if (message.includes('IDEMPOTENCY_KEY_CONFLICT')) return { status: 409, message: 'La inscripción ya fue procesada.' };
  if (message.includes('create_event_registration_secure')) {
    return { status: 503, message: 'La inscripción interna todavía no está activada.' };
  }
  return { status: 500, message: 'No se pudo crear la inscripción.' };
}

async function getRegistrationFormConfig(eventId: string) {
  if (!supabaseAdmin) return DEFAULT_EVENT_REGISTRATION_FORM_CONFIG;
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('registration_form_config')
    .eq('id', eventId)
    .maybeSingle();
  // El formulario básico sigue funcionando mientras una instalación antigua
  // termina de aplicar la migración de campos configurables.
  if (error?.code === '42703') return DEFAULT_EVENT_REGISTRATION_FORM_CONFIG;
  if (error) throw new Error('No se pudo validar la configuración del formulario.');
  return normalizeEventRegistrationFormConfig(data?.registration_form_config);
}

async function persistRegistrationResponses(registrationId: string, responses: Record<string, unknown>) {
  if (!supabaseAdmin || !Object.keys(responses).length) return;
  const { error } = await supabaseAdmin
    .from('event_registrations')
    .update({ form_responses: responses })
    .eq('id', registrationId);
  if (error && error.code !== '42703') {
    console.error('[events.register] optional responses persistence failed', error);
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);

  const allowed = await enforceRateLimit(`events.register:${clientAddress || 'unknown'}`, 600, 8, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiados intentos. Espera unos minutos.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const eventId = String(body.event_id || '').trim();
  const registrationId = String(body.registration_id || '').trim();
  const clientKey = String(body.idempotency_key || '').trim();
  const paymentOptionId = String(body.payment_option_id || '').trim() || null;
  const provider = String(body.provider || '').trim().toUpperCase();
  const contactName = sanitizePlainText(String(body.contact_name || ''), 120);
  const contactEmail = String(body.contact_email || '').trim().toLowerCase().slice(0, 254);
  const contactPhone = sanitizePlainText(String(body.contact_phone || ''), 40);
  const requestedChurch = sanitizePlainText(String(body.church || ''), 120);
  const quantity = Number(body.quantity || 1);
  const donationAmount = body.donation_amount == null || body.donation_amount === ''
    ? null
    : Number(body.donation_amount);
  const privacyAccepted = body.privacy_accepted === true;
  const manualReference = sanitizePlainText(String(body.manual_reference || ''), 120);

  if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(registrationId)) {
    return json({ ok: false, error: 'Identificador de evento inválido.' }, 400);
  }
  if (!/^[A-Za-z0-9._:-]{16,120}$/.test(clientKey)) {
    return json({ ok: false, error: 'Identificador de solicitud inválido.' }, 400);
  }
  if (!contactName || contactName.length < 3 || containsBlockedSequence(String(body.contact_name || ''))) {
    return json({ ok: false, error: 'Escribe el nombre completo.' }, 400);
  }
  if (!EMAIL_PATTERN.test(contactEmail) || containsBlockedSequence(contactEmail)) {
    return json({ ok: false, error: 'Escribe un correo válido.' }, 400);
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return json({ ok: false, error: 'La cantidad de asistentes no es válida.' }, 400);
  }
  if (donationAmount !== null && (!Number.isFinite(donationAmount) || donationAmount <= 0 || donationAmount > 1_000_000_000)) {
    return json({ ok: false, error: 'Ingresa un aporte válido.' }, 400);
  }
  if (!privacyAccepted) return json({ ok: false, error: 'Debes autorizar el tratamiento de datos.' }, 400);

  let formConfig;
  try {
    formConfig = await getRegistrationFormConfig(eventId);
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'No se pudo validar el formulario.' }, 503);
  }
  if (formConfig.phone === 'REQUIRED' && !contactPhone) {
    return json({ ok: false, error: 'Escribe tu número de WhatsApp o teléfono.' }, 400);
  }
  const formResponses: Record<string, unknown> = {};
  if (formConfig.church && requestedChurch) formResponses.church = requestedChurch;
  if (formConfig.whatsapp_updates) formResponses.whatsapp_updates = body.whatsapp_updates === true;

  const turnstileConfigured = Boolean(
    import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
  );
  if (!import.meta.env.DEV && !turnstileConfigured) {
    return json({ ok: false, error: 'La verificación de seguridad no está disponible.' }, 503);
  }
  if (turnstileConfigured) {
    const token = String(body.turnstile_token || body['cf-turnstile-response'] || '');
    if (!(await verifyTurnstile(token, clientAddress))) {
      return json({ ok: false, error: 'No se pudo validar la verificación de seguridad.' }, 403);
    }
  }

  if (paymentOptionId && !UUID_PATTERN.test(paymentOptionId)) {
    return json({ ok: false, error: 'Método de pago inválido.' }, 400);
  }
  if (provider && !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'Proveedor de pago inválido.' }, 400);
  }
  if ((paymentOptionId && !PROVIDERS.has(provider)) || (provider && !paymentOptionId)) {
    return json({ ok: false, error: 'Selecciona un método de pago válido.' }, 400);
  }

  const registrationKey = `event-registration:${eventId}:${clientKey}`;
  const cleanup = await supabaseAdmin.rpc('expire_event_manual_holds_secure', { p_event_id: eventId });
  if (cleanup.error && !['42883', 'PGRST202'].includes(String(cleanup.error.code || ''))) {
    console.error('[events.register] stale manual hold cleanup failed', cleanup.error);
  }
  if (MANUAL_PROVIDERS.has(provider)) {
    if (!manualReference || manualReference.length < 3 || containsBlockedSequence(String(body.manual_reference || ''))) {
      return json({ ok: false, error: 'Escribe la referencia o descripción de la transferencia.' }, 400);
    }
    const paymentId = crypto.randomUUID();
    const { data: manualData, error: manualError } = await supabaseAdmin.rpc('create_event_manual_registration_secure', {
      p_event_id: eventId,
      p_registration_id: registrationId,
      p_payment_id: paymentId,
      p_idempotency_key: registrationKey,
      p_contact_name: contactName,
      p_contact_email: contactEmail,
      p_contact_phone: contactPhone || '',
      p_quantity: quantity,
      p_donation_amount: donationAmount,
      p_payment_option_id: paymentOptionId,
      p_reported_reference: manualReference,
    });
    if (manualError) {
      console.error('[events.register] manual registration rpc failed', manualError);
      const mapped = manualError.message?.includes('create_event_manual_registration_secure')
        ? { status: 503, message: 'El pago manual todavía no está activado.' }
        : registrationErrorMessage(manualError.message || '');
      return json({ ok: false, error: mapped.message }, mapped.status);
    }
    const manualRegistration = Array.isArray(manualData) ? manualData[0] : manualData;
    if (!manualRegistration?.registration_id || !manualRegistration?.payment_id) {
      return json({ ok: false, error: 'No se pudo registrar el pago reportado.' }, 500);
    }
    if (!manualRegistration.reused) {
      await persistRegistrationResponses(String(manualRegistration.registration_id), formResponses);
    }
    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: eventId,
      registration_id: manualRegistration.registration_id,
      payment_id: manualRegistration.payment_id,
      action: manualRegistration.reused ? 'MANUAL_PAYMENT_REPORT_REUSED' : 'MANUAL_PAYMENT_REPORTED',
      after_data: {
        status: manualRegistration.registration_status,
        quantity,
        total_amount: manualRegistration.total_amount,
        currency: manualRegistration.currency,
      },
    });
    return json({
      ok: true,
      registration_id: manualRegistration.registration_id,
      payment_id: manualRegistration.payment_id,
      reference: manualRegistration.payment_reference,
      status: manualRegistration.registration_status,
      requires_payment: false,
      requires_manual_review: true,
      review_expires_at: manualRegistration.expires_at,
      reused: manualRegistration.reused,
    }, manualRegistration.reused ? 200 : 201);
  }

  const { data, error } = await supabaseAdmin.rpc('create_event_registration_secure', {
    p_event_id: eventId,
    p_registration_id: registrationId,
    p_idempotency_key: registrationKey,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
    p_contact_phone: contactPhone || '',
    p_quantity: quantity,
    p_donation_amount: donationAmount,
    p_payment_option_id: paymentOptionId,
    p_payment_provider: provider || null,
  });
  if (error) {
    console.error('[events.register] registration rpc failed', error);
    const mapped = registrationErrorMessage(error.message || '');
    return json({ ok: false, error: mapped.message }, mapped.status);
  }

  const registration = Array.isArray(data) ? data[0] : data;
  if (!registration?.registration_id) {
    return json({ ok: false, error: 'No se pudo confirmar la inscripción.' }, 500);
  }
  if (!registration.reused) {
    await persistRegistrationResponses(String(registration.registration_id), formResponses);
  }

  await supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: eventId,
    registration_id: registration.registration_id,
    action: registration.reused ? 'PUBLIC_REGISTRATION_REUSED' : 'PUBLIC_REGISTRATION_CREATED',
    after_data: {
      status: registration.registration_status,
      quantity,
      total_amount: registration.total_amount,
      currency: registration.currency,
    },
  });

  if (Number(registration.total_amount || 0) <= 0) {
    return json({
      ok: true,
      registration_id: registration.registration_id,
      status: registration.registration_status,
      requires_payment: false,
    }, registration.reused ? 200 : 201);
  }

  if (!paymentOptionId || !ONLINE_PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'Selecciona un método de pago.' }, 400);
  }

  try {
    const checkout = await createEventCheckout({
      request,
      registrationId: registration.registration_id,
      provider: provider as EventCheckoutProvider,
      idempotencyKey: `event-public-checkout:${registration.registration_id}:${clientKey}`,
    });
    return json({
      ok: true,
      registration_id: registration.registration_id,
      payment_id: checkout.paymentId,
      reference: checkout.reference,
      checkout_url: checkout.checkoutUrl,
      requires_payment: true,
      reused: checkout.reused,
    }, registration.reused ? 200 : 201);
  } catch (checkoutError) {
    await supabaseAdmin
      .from('event_registrations')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('id', registration.registration_id)
      .eq('status', 'PENDING_PAYMENT');
    const status = checkoutError instanceof EventCheckoutError ? checkoutError.status : 500;
    const message = checkoutError instanceof EventCheckoutError
      ? checkoutError.message
      : 'No se pudo abrir el proveedor de pago.';
    return json({ ok: false, error: message, retry_new_registration: true }, status);
  }
};
