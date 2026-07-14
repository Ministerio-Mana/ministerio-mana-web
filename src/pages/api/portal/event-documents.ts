import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { canActorManageEvent, getEventAccessContext, type ScopedEvent } from '@lib/eventAccess';
import {
  deleteMicrosoftEventDocument,
  isMicrosoftEventsWriteEnabled,
  uploadMicrosoftEventDocument,
} from '@lib/microsoftGraph';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 128_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_MIMES = new Set([...IMAGE_MIMES, 'application/pdf']);
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

type EventRecord = ScopedEvent & { id: string; title?: string | null; slug?: string | null };

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function cleanFileBase(value: string): string {
  return String(value || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80) || 'archivo';
}

function safeOriginalName(value: string): string {
  const leaf = String(value || '').split(/[\\/]/).pop() || 'archivo';
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'archivo';
}

function buildEventFolder(event: EventRecord): string {
  const base = cleanFileBase(String(event.slug || event.title || 'evento')).slice(0, 60);
  return `${base}-${event.id.slice(0, 8)}`;
}

function isSchemaMissing(error: any): boolean {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /relation .*event_(documents|document_audit_logs).*does not exist/i.test(String(error?.message || ''));
}

async function loadManageableEvent(request: Request, eventId: string) {
  if (!supabaseAdmin) return { error: json({ ok: false, error: 'Supabase no configurado.' }, 500) };
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return { error: json({ ok: false, error: ctx.error || 'No autorizado.' }, ctx.status) };
  if (ctx.isPasswordSession || !ctx.userId) {
    return { error: json({ ok: false, error: 'Esta función requiere una cuenta individual.' }, 403) };
  }

  const { data: event, error } = await supabaseAdmin
    .from('events')
    .select('id,title,slug,scope,church_id,region_id,country')
    .eq('id', eventId)
    .maybeSingle();
  if (error) return { error: json({ ok: false, error: 'No se pudo consultar el evento.' }, 500) };
  if (!event?.id) return { error: json({ ok: false, error: 'Evento no encontrado.' }, 404) };
  if (!await canActorManageEvent(ctx, event)) {
    return { error: json({ ok: false, error: 'No tienes permiso para administrar este evento.' }, 403) };
  }
  return { ctx, event: event as EventRecord };
}

async function validateAndSanitizeFile(file: File): Promise<{
  content: Uint8Array;
  contentType: string;
  extension: string;
}> {
  const declaredType = String(file.type || '').toLowerCase();
  if (!ALLOWED_MIMES.has(declaredType) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new Error('Usa PDF, JPG, PNG o WebP de máximo 4 MB.');
  }
  const input = Buffer.from(await file.arrayBuffer());

  if (declaredType === 'application/pdf') {
    if (input.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('El contenido del PDF no es válido.');
    }
    const searchable = input.toString('latin1');
    if (/\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/i.test(searchable)) {
      throw new Error('El PDF contiene funciones activas no permitidas.');
    }
    return { content: input, contentType: declaredType, extension: 'pdf' };
  }

  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 });
    const metadata = await image.metadata();
    const actualType = metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : '';
    if (!actualType || actualType !== declaredType || !metadata.width || !metadata.height) {
      throw new Error('Formato de imagen inconsistente.');
    }
    const rotated = image.rotate();
    const content = actualType === 'image/jpeg'
      ? await rotated.jpeg({ quality: 86, mozjpeg: true }).toBuffer()
      : actualType === 'image/png'
        ? await rotated.png({ compressionLevel: 9 }).toBuffer()
        : await rotated.webp({ quality: 84 }).toBuffer();
    if (content.byteLength > MAX_FILE_BYTES) throw new Error('La imagen procesada supera 4 MB.');
    return { content, contentType: actualType, extension: MIME_EXTENSION[actualType] };
  } catch (error) {
    throw new Error(error instanceof Error && error.message.includes('4 MB')
      ? error.message
      : 'La imagen no pudo validarse de forma segura.');
  }
}

async function insertAudit(params: {
  eventId: string;
  documentId?: string | null;
  actorUserId: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { error } = await supabaseAdmin.from('event_document_audit_logs').insert({
    event_id: params.eventId,
    document_id: params.documentId || null,
    actor_user_id: params.actorUserId,
    action: params.action,
    metadata: params.metadata || {},
  });
  if (error) console.error('[event.documents] audit insert failed', error);
  return !error;
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const eventId = new URL(request.url).searchParams.get('event_id') || '';
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const access = await loadManageableEvent(request, eventId);
  if (access.error) return access.error;

  const { data, error } = await supabaseAdmin
    .from('event_documents')
    .select('id,event_id,status,original_name,mime_type,size_bytes,sharepoint_web_url,uploaded_by,created_at,updated_at')
    .eq('event_id', eventId)
    .in('status', ['READY', 'FAILED'])
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error && isSchemaMissing(error)) {
    return json({
      ok: true,
      event: { id: access.event?.id, title: access.event?.title || 'Evento' },
      setup_required: true,
      write_enabled: false,
      documents: [],
    });
  }
  if (error) return json({ ok: false, error: 'No se pudieron cargar los documentos.' }, 500);

  return json({
    ok: true,
    event: { id: access.event?.id, title: access.event?.title || 'Evento' },
    setup_required: false,
    write_enabled: isMicrosoftEventsWriteEnabled(),
    max_bytes: MAX_FILE_BYTES,
    allowed_types: Array.from(ALLOWED_MIMES),
    documents: data || [],
  });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return json({ ok: false, error: 'El archivo supera 4 MB.' }, 413);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'No se pudo leer el archivo.' }, 400);
  }
  const eventId = String(formData.get('event_id') || '');
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const access = await loadManageableEvent(request, eventId);
  if (access.error || !access.ctx || !access.event) return access.error || json({ ok: false, error: 'No autorizado.' }, 403);
  const actorUserId = access.ctx.userId;
  if (!actorUserId) return json({ ok: false, error: 'Esta función requiere una cuenta individual.' }, 403);
  if (!isMicrosoftEventsWriteEnabled()) {
    return json({ ok: false, error: 'Las cargas de eventos todavía no están habilitadas.' }, 409);
  }

  const rateKey = `event-document-upload:${access.ctx.userId}:${clientAddress || 'unknown'}`;
  const allowed = await enforceRateLimit(rateKey, 600, 12, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta de nuevo más tarde.' }, 429);

  const file = formData.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'Selecciona un archivo.' }, 400);

  let prepared: Awaited<ReturnType<typeof validateAndSanitizeFile>>;
  try {
    prepared = await validateAndSanitizeFile(file);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Archivo inválido.' }, 400);
  }

  const originalName = safeOriginalName(file.name);
  const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${cleanFileBase(originalName)}.${prepared.extension}`.slice(0, 220);
  const requestId = crypto.randomUUID();
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('event_documents')
    .insert({
      event_id: eventId,
      status: 'UPLOADING',
      original_name: originalName,
      stored_name: storedName,
      mime_type: prepared.contentType,
      size_bytes: prepared.content.byteLength,
      uploaded_by: access.ctx.userId,
    })
    .select('id')
    .single();
  if (pendingError) {
    const message = isSchemaMissing(pendingError)
      ? 'Ejecuta docs/sql/event_documents_sharepoint.sql antes de cargar archivos.'
      : 'No se pudo iniciar el registro del archivo.';
    return json({ ok: false, error: message }, isSchemaMissing(pendingError) ? 409 : 500);
  }

  const auditStarted = await insertAudit({
    eventId,
    documentId: pending.id,
    actorUserId,
    action: 'event.document.upload.started',
    metadata: {
      request_id: requestId,
      original_name: originalName,
      mime_type: prepared.contentType,
      size_bytes: prepared.content.byteLength,
    },
  });
  if (!auditStarted) {
    await supabaseAdmin.from('event_documents').update({ status: 'FAILED', error_code: 'AUDIT_START_FAILED', updated_at: new Date().toISOString() }).eq('id', pending.id);
    return json({ ok: false, error: 'No se pudo iniciar la auditoría de la carga.' }, 500);
  }

  try {
    const uploaded = await uploadMicrosoftEventDocument({
      eventFolder: buildEventFolder(access.event),
      fileName: storedName,
      contentType: prepared.contentType,
      content: prepared.content,
    });
    const readyRecord = {
      status: 'READY',
      sharepoint_drive_id: uploaded.drive.id,
      sharepoint_item_id: uploaded.item.id,
      sharepoint_web_url: uploaded.item.webUrl,
      sharepoint_etag: uploaded.item.eTag,
      error_code: null,
      updated_at: new Date().toISOString(),
    };
    const { error: readyError } = await supabaseAdmin.from('event_documents').update(readyRecord).eq('id', pending.id);
    const auditCompleted = !readyError && await insertAudit({
      eventId,
      documentId: pending.id,
      actorUserId,
      action: 'event.document.upload.completed',
      metadata: {
        request_id: requestId,
        sharepoint_drive_id: uploaded.drive.id,
        sharepoint_item_id: uploaded.item.id,
        stored_name: uploaded.item.name,
      },
    });
    if (readyError || !auditCompleted) {
      await deleteMicrosoftEventDocument(uploaded.drive.id, uploaded.item.id).catch((error) => {
        console.error('[event.documents] compensation delete failed', { requestId, error });
      });
      await supabaseAdmin.from('event_documents').update({ status: 'FAILED', error_code: 'REGISTRATION_FAILED', updated_at: new Date().toISOString() }).eq('id', pending.id);
      return json({ ok: false, error: 'La carga no pudo registrarse de forma segura.' }, 502);
    }

    return json({
      ok: true,
      document: {
        id: pending.id,
        original_name: originalName,
        mime_type: prepared.contentType,
        size_bytes: prepared.content.byteLength,
        sharepoint_web_url: uploaded.item.webUrl,
      },
    }, 201);
  } catch (error) {
    const safeError = error instanceof Error ? error.message.slice(0, 160) : 'Microsoft Graph error';
    await supabaseAdmin.from('event_documents').update({ status: 'FAILED', error_code: 'MICROSOFT_UPLOAD_FAILED', updated_at: new Date().toISOString() }).eq('id', pending.id);
    await insertAudit({
      eventId,
      documentId: pending.id,
      actorUserId,
      action: 'event.document.upload.failed',
      metadata: { request_id: requestId, reason: safeError },
    });
    console.error('[event.documents] Microsoft upload failed', { requestId, message: safeError });
    return json({ ok: false, error: 'Microsoft no pudo almacenar el archivo.' }, 502);
  }
};
