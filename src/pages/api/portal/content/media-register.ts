import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '@lib/cmsAdmin';
import {
  CMS_IMAGEKIT_MAX_BYTES,
  CMS_IMAGE_MIME_SET,
  cleanCmsMediaFileBase,
  isCmsImageDimensionAllowed,
} from '@lib/cmsMedia';
import { insertCmsAuditLog, isCmsSchemaMissingError } from '@lib/cms';
import {
  deleteImageKitFile,
  getCmsMediaProvider,
  getImageKitConfig,
  getImageKitFileDetails,
  isImageKitDeliveryUrl,
  verifyCmsMediaRegistrationToken,
} from '@lib/imageKit';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireCmsAdmin({
    request,
    clientAddress,
    identifier: 'portal.content.media.imagekit.register',
  });
  if (!auth.ok) return json({ ok: false, error: auth.error || 'No autorizado' }, auth.status);
  if (auth.isPasswordSession || !auth.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }
  if (getCmsMediaProvider() !== 'imagekit') {
    return json({ ok: false, error: 'ImageKit todavía no está activado para este entorno.' }, 409);
  }

  const config = getImageKitConfig();
  if (!config) return json({ ok: false, error: 'ImageKit no está configurado completamente.' }, 503);
  const allowed = await enforceRateLimit(`cms-media-register:${auth.userId}`, 86_400, 2_000, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta de nuevo más tarde.' }, 429);

  const body = await request.json().catch(() => ({}));
  const fileId = String(body.file_id || '').trim();
  const registrationToken = String(body.registration_token || '').trim();
  const originalName = String(body.original_name || '').trim().slice(0, 180);
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(fileId) || !registrationToken) {
    return json({ ok: false, error: 'La confirmación de la carga no es válida.' }, 400);
  }

  const claims = verifyCmsMediaRegistrationToken(config, registrationToken);
  if (!claims || claims.sub !== auth.userId) {
    return json({ ok: false, error: 'La autorización de la carga venció o no es válida.' }, 403);
  }

  const existing = await supabaseAdmin
    .from('cms_media')
    .select('*')
    .eq('provider', 'imagekit')
    .eq('provider_file_id', fileId)
    .maybeSingle();
  if (existing.data) {
    return json({ ok: true, file: existing.data, already_registered: true });
  }
  if (existing.error) {
    if (isCmsSchemaMissingError(existing.error)) {
      return json({ ok: false, error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.' }, 503);
    }
    console.error('[cms-media] existing ImageKit record lookup failed', existing.error);
    return json({ ok: false, error: 'No se pudo registrar la imagen.' }, 500);
  }

  let file;
  try {
    file = await getImageKitFileDetails(config, fileId);
  } catch (error) {
    console.error('[cms-media] ImageKit lookup failed', error);
    return json({ ok: false, error: 'No se pudo verificar la imagen en ImageKit.' }, 502);
  }
  if (!file) return json({ ok: false, error: 'La imagen cargada no fue encontrada.' }, 404);

  const expectedPath = `${claims.remoteFolder}/${claims.fileName}`;
  const exactIssuedFile = file.name === claims.fileName && file.filePath === expectedPath;
  const mimeType = String(file.mime || '').toLowerCase();
  const validImage = file.fileType === 'image'
    && file.isPublished !== false
    && CMS_IMAGE_MIME_SET.has(mimeType)
    && Number(file.size || 0) > 0
    && Number(file.size || 0) <= CMS_IMAGEKIT_MAX_BYTES
    && isCmsImageDimensionAllowed(file.width)
    && isCmsImageDimensionAllowed(file.height)
    && Boolean(file.url)
    && isImageKitDeliveryUrl(config, String(file.url || ''));

  if (!exactIssuedFile || !validImage) {
    if (exactIssuedFile) {
      await deleteImageKitFile(config, fileId).catch((error) => {
        console.error('[cms-media] invalid ImageKit file cleanup failed', error);
      });
    }
    return json({ ok: false, error: 'ImageKit rechazó la imagen por seguridad.' }, 400);
  }

  const inserted = await supabaseAdmin
    .from('cms_media')
    .insert({
      provider: 'imagekit',
      provider_file_id: fileId,
      bucket: 'imagekit',
      path: file.filePath,
      folder: claims.logicalFolder,
      original_name: originalName || cleanCmsMediaFileBase(file.name),
      public_url: file.url,
      mime_type: mimeType,
      size_bytes: Number(file.size || 0),
      width: Number(file.width),
      height: Number(file.height),
      tags: ['cms', 'portal'],
      meta: {
        imagekit_name: file.name,
        imagekit_thumbnail_url: file.thumbnailUrl || file.thumbnail || null,
      },
      uploaded_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (inserted.error) {
    await deleteImageKitFile(config, fileId).catch((error) => {
      console.error('[cms-media] unregistered ImageKit file cleanup failed', error);
    });
    if (isCmsSchemaMissingError(inserted.error)) {
      return json({
        ok: false,
        error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.',
      }, 503);
    }
    console.error('[cms-media] ImageKit record insert failed', inserted.error);
    return json({ ok: false, error: 'No se pudo registrar la imagen.' }, 500);
  }

  await insertCmsAuditLog({
    action: 'media.upload',
    entityType: 'system',
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: {
      provider: 'imagekit',
      file_id: fileId,
      path: file.filePath,
      folder: claims.logicalFolder,
      size: file.size,
      content_type: mimeType,
      width: file.width,
      height: file.height,
    },
  });

  return json({ ok: true, file: inserted.data }, 201);
};
