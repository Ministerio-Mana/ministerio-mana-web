import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  buildEvidenceRegistrationFolder,
  buildEvidenceStoredName,
  cleanEvidenceName,
  MAX_EVIDENCE_INPUT_BYTES,
  preparePaymentEvidence,
  verifyEvidenceUploadCredential,
} from '@lib/eventPaymentEvidence';
import {
  deleteMicrosoftEventDocument,
  isMicrosoftEventsWriteEnabled,
  uploadMicrosoftEventDocument,
} from '@lib/microsoftGraph';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const MAX_REQUEST_BYTES = MAX_EVIDENCE_INPUT_BYTES + 160_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function buildEventFolder(event: { id: string; title?: string | null; slug?: string | null }) {
  const base = cleanEvidenceName(String(event.slug || event.title || 'evento'), 60);
  return `${base}-${event.id.slice(0, 8)}`;
}

function isEvidenceSchemaMissing(error: any): boolean {
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''))
    || /event_payment_evidence/i.test(String(error?.message || ''));
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  if (!isMicrosoftEventsWriteEnabled()) {
    return json({ ok: false, error: 'El almacenamiento privado de comprobantes todavía no está habilitado.' }, 409);
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return json({ ok: false, error: 'El comprobante supera 4 MB.' }, 413);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'No se pudo leer el comprobante.' }, 400);
  }

  const paymentId = String(formData.get('payment_id') || '').trim();
  const registrationId = String(formData.get('registration_id') || '').trim();
  const uploadToken = String(formData.get('upload_token') || '').trim();
  const file = formData.get('file');
  if (!UUID_PATTERN.test(paymentId) || !UUID_PATTERN.test(registrationId) || !(file instanceof File)) {
    return json({ ok: false, error: 'El comprobante no corresponde a una inscripción válida.' }, 400);
  }

  const allowed = await enforceRateLimit(
    `event-payment-evidence:${paymentId}:${clientAddress || 'unknown'}`,
    60 * 60,
    5,
    { failOpen: false },
  );
  if (!allowed) return json({ ok: false, error: 'Demasiados intentos de carga. Espera unos minutos.' }, 429);

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('event_payments')
    .select('id,event_id,registration_id,payment_option_id,provider,status,provider_payload')
    .eq('id', paymentId)
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (paymentError) return json({ ok: false, error: 'No se pudo validar el pago.' }, 500);
  if (!payment?.id || !['MANUAL', 'EXTERNAL'].includes(String(payment.provider || '')) || payment.status !== 'UNDER_REVIEW') {
    return json({ ok: false, error: 'Este pago ya no admite comprobantes.' }, 409);
  }
  const payload = payment.provider_payload && typeof payment.provider_payload === 'object'
    ? payment.provider_payload as Record<string, unknown>
    : {};
  if (!verifyEvidenceUploadCredential(
    uploadToken,
    String(payload.evidence_upload_sha256 || ''),
    String(payload.evidence_upload_expires_at || ''),
  )) {
    return json({ ok: false, error: 'El permiso para subir el comprobante venció. Envía nuevamente el formulario.' }, 403);
  }

  const [optionResult, registrationResult, eventResult, existingResult] = await Promise.all([
    supabaseAdmin
      .from('event_payment_options')
      .select('id,requires_evidence')
      .eq('id', payment.payment_option_id)
      .eq('event_id', payment.event_id)
      .maybeSingle(),
    supabaseAdmin
      .from('event_registrations')
      .select('id,contact_name')
      .eq('id', registrationId)
      .eq('event_id', payment.event_id)
      .maybeSingle(),
    supabaseAdmin
      .from('events')
      .select('id,title,slug')
      .eq('id', payment.event_id)
      .maybeSingle(),
    supabaseAdmin
      .from('event_payment_evidence')
      .select('id,sharepoint_item_id')
      .eq('payment_id', paymentId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
  ]);
  if (existingResult.error && isEvidenceSchemaMissing(existingResult.error)) {
    return json({ ok: false, error: 'Falta activar el registro privado de comprobantes.' }, 409);
  }
  if (optionResult.error || registrationResult.error || eventResult.error || existingResult.error) {
    return json({ ok: false, error: 'No se pudo preparar el comprobante.' }, 500);
  }
  if (!optionResult.data?.requires_evidence || !registrationResult.data?.id || !eventResult.data?.id) {
    return json({ ok: false, error: 'Este método de pago no solicita comprobante.' }, 409);
  }
  if (existingResult.data?.id) {
    return existingResult.data.sharepoint_item_id
      ? json({ ok: true, evidence_id: existingResult.data.id, already_uploaded: true })
      : json({ ok: false, error: 'El comprobante ya se está procesando. Espera un momento.' }, 409);
  }

  let prepared: Awaited<ReturnType<typeof preparePaymentEvidence>>;
  try {
    prepared = await preparePaymentEvidence(file);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Comprobante inválido.' }, 400);
  }

  const storedName = buildEvidenceStoredName(
    String(registrationResult.data.contact_name || 'persona'),
    registrationId,
    prepared.extension,
  );
  const registrationFolder = buildEvidenceRegistrationFolder(
    String(registrationResult.data.contact_name || 'persona'),
    registrationId,
    paymentId,
  );
  const eventFolder = buildEventFolder(eventResult.data);
  const sha256 = crypto.createHash('sha256').update(prepared.content).digest('hex');
  const evidenceSubfolder = `Comprobantes de pago/${registrationFolder}`;
  const storagePath = `Portal Eventos/${eventFolder}/${evidenceSubfolder}/${storedName}`;
  const { data: evidence, error: reservationError } = await supabaseAdmin
    .from('event_payment_evidence')
    .insert({
      event_id: payment.event_id,
      registration_id: registrationId,
      payment_id: paymentId,
      storage_path: storagePath,
      original_filename: prepared.originalName,
      mime_type: prepared.contentType,
      size_bytes: prepared.content.byteLength,
      sha256,
      status: 'PENDING',
    })
    .select('id')
    .single();
  if (reservationError || !evidence?.id) {
    if (String(reservationError?.code || '') === '23505') {
      const { data: concurrent } = await supabaseAdmin
        .from('event_payment_evidence')
        .select('id,sharepoint_item_id')
        .eq('payment_id', paymentId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      return concurrent?.sharepoint_item_id
        ? json({ ok: true, evidence_id: concurrent.id, already_uploaded: true })
        : json({ ok: false, error: 'El comprobante ya se está procesando. Espera un momento.' }, 409);
    }
    const status = isEvidenceSchemaMissing(reservationError) ? 409 : 500;
    return json({
      ok: false,
      error: status === 409
        ? 'Ejecuta docs/sql/event_payment_evidence_sharepoint.sql antes de recibir comprobantes.'
        : 'El comprobante no pudo reservarse de forma segura.',
    }, status);
  }

  let uploaded: Awaited<ReturnType<typeof uploadMicrosoftEventDocument>> | null = null;
  try {
    uploaded = await uploadMicrosoftEventDocument({
      eventFolder,
      subfolder: evidenceSubfolder,
      fileName: storedName,
      contentType: prepared.contentType,
      content: prepared.content,
    });
    const { data: completedEvidence, error: evidenceError } = await supabaseAdmin
      .from('event_payment_evidence')
      .update({
        sharepoint_drive_id: uploaded.drive.id,
        sharepoint_item_id: uploaded.item.id,
        sharepoint_web_url: uploaded.item.webUrl,
        sharepoint_etag: uploaded.item.eTag,
      })
      .eq('id', evidence.id)
      .is('sharepoint_item_id', null)
      .select('id')
      .maybeSingle();
    if (evidenceError || !completedEvidence?.id) {
      await deleteMicrosoftEventDocument(uploaded.drive.id, uploaded.item.id).catch(() => undefined);
      await supabaseAdmin.from('event_payment_evidence').delete().eq('id', evidence.id);
      return json({ ok: false, error: 'El comprobante no pudo registrarse de forma segura.' }, 500);
    }

    const { evidence_upload_sha256: _hash, evidence_upload_expires_at: _expiry, ...cleanPayload } = payload;
    const [paymentUpdate, auditInsert] = await Promise.all([
      supabaseAdmin
        .from('event_payments')
        .update({ provider_payload: { ...cleanPayload, evidence_id: evidence.id } })
        .eq('id', paymentId),
      supabaseAdmin.from('event_finance_audit_logs').insert({
        event_id: payment.event_id,
        registration_id: registrationId,
        payment_id: paymentId,
        action: 'MANUAL_PAYMENT_EVIDENCE_UPLOADED',
        after_data: {
          evidence_id: evidence.id,
          original_size_bytes: file.size,
          stored_size_bytes: prepared.content.byteLength,
          optimized: prepared.optimized,
          mime_type: prepared.contentType,
        },
      }),
    ]);
    if (paymentUpdate.error) console.error('[event.payment-evidence] credential cleanup failed', paymentUpdate.error);
    if (auditInsert.error) console.error('[event.payment-evidence] audit insert failed', auditInsert.error);

    return json({
      ok: true,
      evidence_id: evidence.id,
      optimized: prepared.optimized,
      stored_size_bytes: prepared.content.byteLength,
    }, 201);
  } catch (error) {
    console.error('[event.payment-evidence] upload failed', error);
    if (uploaded) {
      await deleteMicrosoftEventDocument(uploaded.drive.id, uploaded.item.id).catch(() => undefined);
    }
    await supabaseAdmin.from('event_payment_evidence').delete().eq('id', evidence.id);
    return json({ ok: false, error: 'No se pudo guardar el comprobante en Microsoft 365.' }, 502);
  }
};
