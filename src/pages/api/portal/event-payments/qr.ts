import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const ALLOWED_DECLARED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_DECODED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const BUCKET = String(
  import.meta.env.EVENT_PAYMENT_ASSETS_BUCKET || process.env.EVENT_PAYMENT_ASSETS_BUCKET || 'event-payment-assets',
).trim();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function ensureBucket() {
  if (!supabaseAdmin) throw new Error('Server Config Error');
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw error;
  if ((buckets || []).some((bucket) => bucket.name === BUCKET)) return;
  const created = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_INPUT_BYTES,
    allowedMimeTypes: ['image/png'],
  });
  if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
    throw created.error;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }

  const allowed = await enforceRateLimit(`event-payment-qr:${ctx.userId}`, 600, 12, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta más tarde.' }, 429);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_INPUT_BYTES + 100_000) {
    return json({ ok: false, error: 'La imagen supera el máximo de 3 MB.' }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'No se pudo leer la imagen.' }, 400);
  }
  const eventId = String(formData.get('event_id') || '').trim();
  const file = formData.get('file');
  if (!eventId || !(file instanceof File)) {
    return json({ ok: false, error: 'Falta el evento o la imagen QR.' }, 400);
  }
  if (file.size <= 0 || file.size > MAX_INPUT_BYTES || !ALLOWED_DECLARED_TYPES.has(file.type)) {
    return json({ ok: false, error: 'Usa una imagen PNG, JPG o WebP de máximo 3 MB.' }, 400);
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, scope, church_id, region_id, country')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: 'error', limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_DECODED_FORMATS.has(metadata.format)) {
      return json({ ok: false, error: 'El contenido del archivo no es una imagen permitida.' }, 400);
    }
    if (!metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 160
      || metadata.width > 4096 || metadata.height > 4096) {
      return json({ ok: false, error: 'La imagen debe medir entre 160 y 4096 píxeles por lado.' }, 400);
    }

    const sanitized = await image.rotate().png({ compressionLevel: 9 }).toBuffer();
    if (sanitized.byteLength > MAX_INPUT_BYTES) {
      return json({ ok: false, error: 'La imagen procesada supera el máximo de 3 MB.' }, 400);
    }

    await ensureBucket();
    const path = `${event.id}/${crypto.randomUUID()}.png`;
    const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(path, sanitized, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });
    if (uploaded.error) return json({ ok: false, error: 'No se pudo guardar la imagen QR.' }, 500);

    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600);
    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: event.id,
      actor_user_id: ctx.userId,
      action: 'MANUAL_PAYMENT_QR_UPLOADED',
      after_data: {
        storage_path: path,
        original_size: file.size,
        sanitized_size: sanitized.byteLength,
        width: metadata.width,
        height: metadata.height,
      },
    });
    return json({ ok: true, path, signed_url: signed.data?.signedUrl || null }, 201);
  } catch (error) {
    console.error('[event-payment-qr] image processing failed', error);
    return json({ ok: false, error: 'La imagen no pudo validarse de forma segura.' }, 400);
  }
};
