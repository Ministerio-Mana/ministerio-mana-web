import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceRateLimit } from '@lib/rateLimit';
import { verifyTurnstile } from '@lib/turnstile';
import { containsBlockedSequence, sanitizePlainText } from '@lib/validation';
import { createEventCheckout, EventCheckoutError, type EventCheckoutProvider } from '@lib/eventCheckout';
import { DEFAULT_EVENT_REGISTRATION_FORM_CONFIG, normalizeEventRegistrationFormConfig } from '@lib/eventRegistrationForm.js';
import { createEvidenceUploadCredential } from '@lib/eventPaymentEvidence';

export const prerender = false;

const MAX_BODY_CHARS = 64_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONLINE_PROVIDERS = new Set(['WOMPI', 'STRIPE']);
const MANUAL_PROVIDERS = new Set(['MANUAL', 'EXTERNAL']);
const PROVIDERS = new Set([...ONLINE_PROVIDERS, ...MANUAL_PROVIDERS]);
const ATTENDEE_AGE_GROUPS = new Set(['0_5', '6_12', '13_17', '18_25', '26_59', '60_PLUS']);
const ATTENDEE_GENDERS = new Set(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']);
const PAYER_PERSON_TYPES = new Set(['NATURAL', 'LEGAL']);
const PAYER_DOCUMENT_TYPES = new Set(['CC', 'CE', 'PPT', 'PASSPORT', 'NIT', 'FOREIGN_ID', 'OTHER']);

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
  if (!supabaseAdmin) return {
    formConfig: DEFAULT_EVENT_REGISTRATION_FORM_CONFIG,
    pricingModel: 'FREE',
    publicRegistrationAllowed: false,
  };
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('registration_form_config,pricing_model,price,status,visibility,registration_mode')
    .eq('id', eventId)
    .maybeSingle();
  // Una instalación sin el contrato completo se cierra de forma segura: no
  // debe aceptar inscripciones públicas sin verificar estado y visibilidad.
  if (error?.code === '42703') return {
    formConfig: DEFAULT_EVENT_REGISTRATION_FORM_CONFIG,
    pricingModel: 'FREE',
    publicRegistrationAllowed: false,
  };
  if (error) throw new Error('No se pudo validar la configuración del formulario.');
  return {
    formConfig: normalizeEventRegistrationFormConfig(data?.registration_form_config),
    pricingModel: String(data?.pricing_model || (Number(data?.price || 0) > 0 ? 'PAID' : 'FREE')).toUpperCase(),
    publicRegistrationAllowed: String(data?.status || '').toUpperCase() === 'PUBLISHED'
      && String(data?.visibility || 'UNLISTED').toUpperCase() !== 'PRIVATE'
      && String(data?.registration_mode || '').toUpperCase() === 'INTERNAL',
  };
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

function readAttendees(value: unknown, quantity: number, formConfig: ReturnType<typeof normalizeEventRegistrationFormConfig>) {
  if (!Array.isArray(value) || value.length !== quantity) {
    throw new Error('La cantidad de fichas no coincide con los asistentes.');
  }
  return value.map((raw, index) => {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const fullNameRaw = String(source.full_name || '');
    const fullName = sanitizePlainText(fullNameRaw, 120);
    const ageGroup = String(source.age_group || '').trim().toUpperCase();
    const gender = String(source.gender || '').trim().toUpperCase();
    if (fullName.length < 3 || containsBlockedSequence(fullNameRaw)) {
      throw new Error(`Escribe el nombre completo del asistente ${index + 1}.`);
    }
    if (formConfig.attendee_age === 'REQUIRED' && !ageGroup) {
      throw new Error(`Selecciona la edad del asistente ${index + 1}.`);
    }
    if (ageGroup && (formConfig.attendee_age === 'HIDDEN' || !ATTENDEE_AGE_GROUPS.has(ageGroup))) {
      throw new Error(`La edad del asistente ${index + 1} no es válida.`);
    }
    if (formConfig.attendee_gender === 'REQUIRED' && !gender) {
      throw new Error(`Selecciona el género del asistente ${index + 1}.`);
    }
    if (gender && (formConfig.attendee_gender === 'HIDDEN' || !ATTENDEE_GENDERS.has(gender))) {
      throw new Error(`El género del asistente ${index + 1} no es válido.`);
    }
    return {
      position: index + 1,
      full_name: fullName,
      age_group: ageGroup || null,
      gender: gender || null,
    };
  });
}

function readPayer(
  value: unknown,
  pricingModel: string,
  formConfig: ReturnType<typeof normalizeEventRegistrationFormConfig>,
) {
  if (pricingModel === 'FREE' || formConfig.payer_document === 'HIDDEN') return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const personType = String(source.person_type || 'NATURAL').trim().toUpperCase();
  const documentType = String(source.document_type || '').trim().toUpperCase();
  const documentNumberRaw = String(source.document_number || '').trim().toUpperCase();
  const documentNumber = documentNumberRaw.replace(/\s+/g, '');
  const documentCountryRaw = String(source.document_country || '');
  const documentCountry = sanitizePlainText(documentCountryRaw, 80);
  const legalNameRaw = String(source.legal_name || '');
  const legalName = sanitizePlainText(legalNameRaw, 160);
  const billingEmail = String(source.billing_email || '').trim().toLowerCase().slice(0, 254);
  if (!PAYER_PERSON_TYPES.has(personType)) throw new Error('Selecciona el tipo de persona que realiza el pago.');
  if (!documentCountry || containsBlockedSequence(documentCountryRaw)) throw new Error('Escribe el país del documento.');
  if (legalName.length < 3 || containsBlockedSequence(legalNameRaw)) throw new Error('Escribe el nombre o razón social del pagador.');
  if (!EMAIL_PATTERN.test(billingEmail) || containsBlockedSequence(billingEmail)) throw new Error('Escribe el correo del pagador.');
  const documentRequired = formConfig.payer_document === 'REQUIRED';
  if (documentRequired && (!documentType || !documentNumber)) throw new Error('Completa la identificación del pagador.');
  if ((documentType || documentNumber) && (!PAYER_DOCUMENT_TYPES.has(documentType) || !/^[A-Z0-9.\-]{3,40}$/.test(documentNumber))) {
    throw new Error('La identificación del pagador no es válida.');
  }
  return {
    is_contact: source.is_contact === true,
    person_type: personType,
    document_type: documentType || null,
    document_number: documentNumber || null,
    document_country: documentCountry,
    legal_name: legalName,
    billing_email: billingEmail,
    tax_document_requested: source.tax_document_requested === true,
  };
}

async function persistRegistrationPeople(params: {
  eventId: string;
  registrationId: string;
  payer: Record<string, unknown> | null;
  attendees: Array<Record<string, unknown>>;
}) {
  if (!supabaseAdmin) throw new Error('La inscripción no está disponible.');
  const { error } = await supabaseAdmin.rpc('save_event_registration_people_secure', {
    p_event_id: params.eventId,
    p_registration_id: params.registrationId,
    p_payer: params.payer,
    p_attendees: params.attendees,
  });
  if (error) {
    console.error('[events.register] people persistence failed', { code: error.code, message: error.message });
    throw new Error('No se pudieron guardar las fichas de los asistentes.');
  }
}

type EvidenceUploadCredentialResult = {
  required: boolean;
  token: string | null;
  expires_at: string | null;
};

async function issueEvidenceUploadCredential(
  paymentId: string,
  paymentOptionId: string | null,
  eventId: string,
): Promise<EvidenceUploadCredentialResult> {
  const notRequired = { required: false, token: null, expires_at: null };
  if (!supabaseAdmin || !paymentOptionId) return notRequired;
  const { data: option, error: optionError } = await supabaseAdmin
    .from('event_payment_options')
    .select('requires_evidence')
    .eq('id', paymentOptionId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (optionError) {
    console.error('[events.register] evidence requirement lookup failed', optionError);
    return { required: true, token: null, expires_at: null };
  }
  if (!option?.requires_evidence) return notRequired;

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('event_payments')
    .select('provider_payload,status')
    .eq('id', paymentId)
    .maybeSingle();
  if (paymentError || payment?.status !== 'UNDER_REVIEW') {
    if (paymentError) console.error('[events.register] evidence payment lookup failed', paymentError);
    return { required: true, token: null, expires_at: null };
  }

  const credential = createEvidenceUploadCredential();
  const currentPayload = payment.provider_payload && typeof payment.provider_payload === 'object'
    ? payment.provider_payload as Record<string, unknown>
    : {};
  const { error: updateError } = await supabaseAdmin
    .from('event_payments')
    .update({
      provider_payload: {
        ...currentPayload,
        evidence_upload_sha256: credential.sha256,
        evidence_upload_expires_at: credential.expiresAt,
      },
    })
    .eq('id', paymentId)
    .eq('status', 'UNDER_REVIEW');
  if (updateError) {
    console.error('[events.register] evidence credential persistence failed', updateError);
    return { required: true, token: null, expires_at: null };
  }
  return {
    required: true,
    token: credential.token,
    expires_at: credential.expiresAt,
  };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readCustomResponses(value: unknown, formConfig: ReturnType<typeof normalizeEventRegistrationFormConfig>) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const saved: Record<string, unknown> = {};
  for (const field of formConfig.fields) {
    const raw = source[field.id];
    let response: string | string[] | null = null;
    if (field.type === 'MULTIPLE_CHOICE') {
      const values = Array.isArray(raw) ? raw : [];
      const allowed = new Set(field.options);
      const unique = [...new Set(values.map((item) => String(item).trim()))]
        .filter((item) => allowed.has(item))
        .slice(0, field.options.length);
      if (values.length !== unique.length) {
        throw new Error(`La respuesta de “${field.label}” no es válida.`);
      }
      response = unique;
    } else if (field.type === 'YES_NO') {
      const normalized = raw === true ? 'Sí' : raw === false ? 'No' : String(raw || '').trim();
      if (normalized && !['Sí', 'No'].includes(normalized)) {
        throw new Error(`La respuesta de “${field.label}” no es válida.`);
      }
      response = normalized || null;
    } else {
      const maxLength = field.type === 'LONG_TEXT' ? 1_000 : field.type === 'DATE' ? 10 : 160;
      const rawText = String(raw || '');
      if (rawText.length > maxLength || containsBlockedSequence(rawText)) {
        throw new Error(`La respuesta de “${field.label}” no es válida.`);
      }
      const text = sanitizePlainText(rawText, maxLength);
      if (field.type === 'DATE' && text && !isIsoDate(text)) {
        throw new Error(`La fecha de “${field.label}” no es válida.`);
      }
      if (['SINGLE_CHOICE'].includes(field.type) && text && !field.options.includes(text)) {
        throw new Error(`La respuesta de “${field.label}” no es válida.`);
      }
      response = text || null;
    }
    const isEmpty = Array.isArray(response) ? response.length === 0 : !response;
    if (field.required && isEmpty) throw new Error(`Responde “${field.label}”.`);
    if (!isEmpty) {
      saved[field.id] = { label: field.label, type: field.type, value: response };
    }
  }
  return saved;
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
  let pricingModel = 'FREE';
  let publicRegistrationAllowed = false;
  let attendees: Array<Record<string, unknown>> = [];
  let payer: Record<string, unknown> | null = null;
  try {
    const settings = await getRegistrationFormConfig(eventId);
    formConfig = settings.formConfig;
    pricingModel = settings.pricingModel;
    publicRegistrationAllowed = settings.publicRegistrationAllowed;
  } catch {
    return json({ ok: false, error: 'No se pudo consultar la configuración del evento.' }, 503);
  }
  if (!publicRegistrationAllowed) {
    return json({ ok: false, error: 'El formulario público no está disponible.' }, 404);
  }
  try {
    attendees = readAttendees(body.attendees, quantity, formConfig);
    payer = readPayer(body.payer, pricingModel, formConfig);
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'No se pudo validar el formulario.' }, 400);
  }
  if (formConfig.phone === 'REQUIRED' && !contactPhone) {
    return json({ ok: false, error: 'Escribe tu número de WhatsApp o teléfono.' }, 400);
  }
  const formResponses: Record<string, unknown> = {};
  if (formConfig.church && requestedChurch) formResponses.church = requestedChurch;
  if (formConfig.whatsapp_updates) formResponses.whatsapp_updates = body.whatsapp_updates === true;
  try {
    const customFields = readCustomResponses(body.custom_responses, formConfig);
    if (Object.keys(customFields).length) formResponses.custom_fields = customFields;
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'Revisa las preguntas del formulario.' }, 400);
  }

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
    try {
      await persistRegistrationPeople({
        eventId,
        registrationId: String(manualRegistration.registration_id),
        payer,
        attendees,
      });
      if (!manualRegistration.reused) {
        await persistRegistrationResponses(String(manualRegistration.registration_id), formResponses);
      }
    } catch (peopleError: any) {
      return json({ ok: false, error: peopleError?.message || 'No se pudieron guardar los asistentes.' }, 503);
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
    const evidenceCredential = await issueEvidenceUploadCredential(
      String(manualRegistration.payment_id),
      paymentOptionId,
      eventId,
    );
    return json({
      ok: true,
      registration_id: manualRegistration.registration_id,
      payment_id: manualRegistration.payment_id,
      reference: manualRegistration.payment_reference,
      status: manualRegistration.registration_status,
      requires_payment: false,
      requires_manual_review: true,
      requires_evidence: evidenceCredential.required,
      evidence_upload_token: evidenceCredential.token,
      evidence_upload_expires_at: evidenceCredential.expires_at,
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
  try {
    await persistRegistrationPeople({
      eventId,
      registrationId: String(registration.registration_id),
      payer,
      attendees,
    });
    if (!registration.reused) {
      await persistRegistrationResponses(String(registration.registration_id), formResponses);
    }
  } catch (peopleError: any) {
    return json({ ok: false, error: peopleError?.message || 'No se pudieron guardar los asistentes.' }, 503);
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
