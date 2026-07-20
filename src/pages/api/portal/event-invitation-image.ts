import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { canActorManageEvent, getEventAccessContext, type ScopedEvent } from '@lib/eventAccess';
import { deleteMicrosoftEventDocument, isMicrosoftEventsWriteEnabled, uploadMicrosoftEventDocument } from '@lib/microsoftGraph';
import { enforceRateLimit } from '@lib/rateLimit';
import { getEventInvitationBounds, getEventInvitationLayout } from '@lib/eventInvitationLayout.js';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 750 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

type EventRecord = ScopedEvent & {
  id: string;
  title?: string | null;
  slug?: string | null;
  banner_url?: string | null;
  banner_layout?: string | null;
};

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
  return String(value || 'evento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'evento';
}

function buildEventFolder(event: EventRecord): string {
  return `${cleanFileBase(String(event.slug || event.title || 'evento'))}-${event.id.slice(0, 8)}`;
}

function isSchemaMissing(error: any): boolean {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /relation .*event_invitation_images.*does not exist/i.test(String(error?.message || ''));
}

function isLayoutSchemaMissing(error: any): boolean {
  return isSchemaMissing(error)
    || error?.code === '42703'
    || /column .*\b(layout|banner_layout)\b.* does not exist/i.test(String(error?.message || ''));
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
    .select('id,title,slug,scope,church_id,region_id,country,banner_url,banner_layout')
    .eq('id', eventId)
    .maybeSingle();
  if (error) return { error: json({ ok: false, error: 'No se pudo consultar el evento.' }, 500) };
  if (!event?.id) return { error: json({ ok: false, error: 'Evento no encontrado.' }, 404) };
  if (!await canActorManageEvent(ctx, event)) {
    return { error: json({ ok: false, error: 'No tienes permiso para administrar este evento.' }, 403) };
  }
  return { ctx, event: event as EventRecord };
}

async function prepareImage(file: File): Promise<{ content: Buffer; layout: string; width: number; height: number }> {
  if (!IMAGE_MIMES.has(String(file.type || '').toLowerCase()) || file.size <= 0 || file.size > MAX_INPUT_BYTES) {
    throw new Error('Usa una imagen JPG, PNG o WebP de máximo 4 MB.');
  }
  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !IMAGE_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error('El contenido del archivo no es una imagen permitida.');
  }
  if (metadata.width < 480 || metadata.height < 480) {
    throw new Error('La imagen es demasiado pequeña. Usa una de al menos 480 × 480 píxeles.');
  }

  const orientation = Number(metadata.orientation || 1);
  const sourceWidth = [5, 6, 7, 8].includes(orientation) ? metadata.height : metadata.width;
  const sourceHeight = [5, 6, 7, 8].includes(orientation) ? metadata.width : metadata.height;
  const layout = getEventInvitationLayout(sourceWidth, sourceHeight);
  const bounds = getEventInvitationBounds(layout);
  const optimize = (quality: number) => image.clone()
    .rotate()
    .resize(bounds.width, bounds.height, { fit: 'inside', withoutEnlargement: false })
    .webp({ quality, effort: 5 })
    .toBuffer();
  let output = await optimize(82);
  for (const quality of [74, 66, 58]) {
    if (output.byteLength <= MAX_OUTPUT_BYTES) break;
    output = await optimize(quality);
  }
  if (output.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error('La imagen optimizada supera 750 KB. Usa una imagen con menos detalle.');
  }
  const outputMetadata = await sharp(output).metadata();
  if (!outputMetadata.width || !outputMetadata.height) throw new Error('No se pudieron leer las dimensiones de la imagen optimizada.');
  return { content: output, layout, width: outputMetadata.width, height: outputMetadata.height };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_INPUT_BYTES + 128_000) return json({ ok: false, error: 'La imagen supera el máximo de 4 MB.' }, 413);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'No se pudo leer la imagen.' }, 400);
  }
  const eventId = String(formData.get('event_id') || '').trim();
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const access = await loadManageableEvent(request, eventId);
  if (access.error || !access.ctx || !access.event) return access.error || json({ ok: false, error: 'No autorizado.' }, 403);
  if (!isMicrosoftEventsWriteEnabled()) {
    return json({ ok: false, error: 'Las cargas a SharePoint todavía no están habilitadas.' }, 409);
  }

  const allowed = await enforceRateLimit(`event-invitation-image:${access.ctx.userId}:${clientAddress || 'unknown'}`, 600, 12, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta de nuevo más tarde.' }, 429);
  const file = formData.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'Selecciona una imagen.' }, 400);

  let prepared: Awaited<ReturnType<typeof prepareImage>>;
  try {
    prepared = await prepareImage(file);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'La imagen no es válida.' }, 400);
  }

  const { data: previous, error: previousError } = await supabaseAdmin
    .from('event_invitation_images')
    .select('sharepoint_drive_id,sharepoint_item_id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (previousError && isSchemaMissing(previousError)) {
    return json({ ok: false, error: 'Ejecuta docs/sql/event_invitation_images_sharepoint.sql antes de cargar invitaciones.' }, 409);
  }
  if (previousError) return json({ ok: false, error: 'No se pudo consultar la imagen actual.' }, 500);

  try {
    const storedName = `invitacion-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
    const uploaded = await uploadMicrosoftEventDocument({
      eventFolder: buildEventFolder(access.event),
      fileName: storedName,
      contentType: 'image/webp',
      content: prepared.content,
    });
    const now = new Date().toISOString();
    const { error: upsertError } = await supabaseAdmin
      .from('event_invitation_images')
      .upsert({
        event_id: eventId,
        original_name: String(file.name || 'invitacion').slice(0, 180),
        mime_type: 'image/webp',
        size_bytes: prepared.content.byteLength,
        width: prepared.width,
        height: prepared.height,
        layout: prepared.layout,
        sharepoint_drive_id: uploaded.drive.id,
        sharepoint_item_id: uploaded.item.id,
        sharepoint_web_url: uploaded.item.webUrl,
        uploaded_by: access.ctx.userId,
        updated_at: now,
      }, { onConflict: 'event_id' });
    if (upsertError) {
      await deleteMicrosoftEventDocument(uploaded.drive.id, uploaded.item.id).catch(() => undefined);
      if (isLayoutSchemaMissing(upsertError)) {
        return json({ ok: false, error: 'Ejecuta docs/sql/event_invitation_image_layouts.sql antes de cargar invitaciones.' }, 409);
      }
      return json({ ok: false, error: 'No se pudo registrar la imagen de invitación.' }, 500);
    }

    const bannerUrl = `/api/events/invitation-image?event_id=${encodeURIComponent(eventId)}&v=${encodeURIComponent(now)}`;
    const { error: eventUpdateError } = await supabaseAdmin
      .from('events')
      .update({ banner_url: bannerUrl, banner_layout: prepared.layout, updated_at: now })
      .eq('id', eventId);
    if (eventUpdateError) {
      if (isLayoutSchemaMissing(eventUpdateError)) {
        return json({ ok: false, error: 'Ejecuta docs/sql/event_invitation_image_layouts.sql antes de cargar invitaciones.' }, 409);
      }
      return json({ ok: false, error: 'La imagen quedó en SharePoint, pero no se pudo asociar al evento.' }, 500);
    }
    const { error: auditError } = await supabaseAdmin.from('event_invitation_image_audit_logs').insert({
      event_id: eventId,
      actor_user_id: access.ctx.userId,
      action: 'invitation.image.uploaded',
      metadata: { size_bytes: prepared.content.byteLength, width: prepared.width, height: prepared.height, layout: prepared.layout },
    });
    if (auditError) console.error('[event-invitation-image] audit insert failed', auditError);
    if (previous?.sharepoint_drive_id && previous?.sharepoint_item_id) {
      await deleteMicrosoftEventDocument(String(previous.sharepoint_drive_id), String(previous.sharepoint_item_id)).catch(() => undefined);
    }
    return json({ ok: true, banner_url: bannerUrl, size_bytes: prepared.content.byteLength, width: prepared.width, height: prepared.height, layout: prepared.layout }, 201);
  } catch (error) {
    console.error('[event-invitation-image] upload failed', error);
    return json({ ok: false, error: 'SharePoint no pudo guardar la imagen de invitación.' }, 502);
  }
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'No se pudo leer la solicitud.' }, 400);
  }
  const eventId = String(body.event_id || '').trim();
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const access = await loadManageableEvent(request, eventId);
  if (access.error || !access.ctx || !access.event) return access.error || json({ ok: false, error: 'No autorizado.' }, 403);

  const allowed = await enforceRateLimit(`event-invitation-image-delete:${access.ctx.userId}:${clientAddress || 'unknown'}`, 600, 24, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);

  const { data: stored, error: storedError } = await supabaseAdmin
    .from('event_invitation_images')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();
  if (storedError && !isSchemaMissing(storedError)) {
    return json({ ok: false, error: 'No se pudo consultar la imagen actual.' }, 500);
  }

  const now = new Date().toISOString();
  const { error: eventUpdateError } = await supabaseAdmin
    .from('events')
    .update({ banner_url: null, banner_layout: null, updated_at: now })
    .eq('id', eventId);
  if (eventUpdateError) return json({ ok: false, error: 'No se pudo retirar la imagen del evento.' }, 500);

  if (!storedError) {
    const { error: deleteRecordError } = await supabaseAdmin
      .from('event_invitation_images')
      .delete()
      .eq('event_id', eventId);
    if (deleteRecordError) {
      await supabaseAdmin.from('events').update({
        banner_url: access.event.banner_url || null,
        banner_layout: access.event.banner_layout || null,
        updated_at: now,
      }).eq('id', eventId);
      return json({ ok: false, error: 'No se pudo retirar el registro de la imagen.' }, 500);
    }
  }

  if (stored?.sharepoint_drive_id && stored?.sharepoint_item_id) {
    try {
      await deleteMicrosoftEventDocument(String(stored.sharepoint_drive_id), String(stored.sharepoint_item_id));
    } catch (error) {
      console.error('[event-invitation-image] SharePoint delete failed', error);
      const { error: restoreRecordError } = await supabaseAdmin
        .from('event_invitation_images')
        .upsert(stored, { onConflict: 'event_id' });
      const { error: restoreEventError } = await supabaseAdmin.from('events').update({
        banner_url: access.event.banner_url || null,
        banner_layout: access.event.banner_layout || null,
        updated_at: now,
      }).eq('id', eventId);
      if (restoreRecordError || restoreEventError) {
        console.error('[event-invitation-image] rollback after SharePoint delete failed', { restoreRecordError, restoreEventError });
      }
      return json({ ok: false, error: 'SharePoint no pudo retirar la imagen. No se aplicaron cambios.' }, 502);
    }
  }

  const { error: auditError } = await supabaseAdmin.from('event_invitation_image_audit_logs').insert({
    event_id: eventId,
    actor_user_id: access.ctx.userId,
    action: 'invitation.image.removed',
    metadata: { sharepoint_deleted: true },
  });
  if (auditError) console.error('[event-invitation-image] audit insert failed', auditError);
  return json({ ok: true, sharepoint_deleted: true });
};
