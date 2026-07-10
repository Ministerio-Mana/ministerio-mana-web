import type { APIRoute } from 'astro';
import { requireCmsAdmin } from '@lib/cmsAdmin';
import { isCmsSchemaMissingError } from '@lib/cms';
import {
  CMS_IMAGEKIT_MAX_BYTES,
  CMS_IMAGE_MIME_SET,
  cmsImageKitChecks,
  createCmsMediaFileName,
  resolveCmsMediaFolder,
} from '@lib/cmsMedia';
import {
  buildImageKitCmsFolder,
  createCmsMediaRegistrationToken,
  createImageKitUploadToken,
  getCmsMediaProvider,
  getImageKitConfig,
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
    },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireCmsAdmin({
    request,
    clientAddress,
    identifier: 'portal.content.media.imagekit.token',
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

  const schemaCheck = await supabaseAdmin.from('cms_media').select('provider').limit(1);
  if (schemaCheck.error) {
    if (isCmsSchemaMissingError(schemaCheck.error)) {
      return json({ ok: false, error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.' }, 503);
    }
    return json({ ok: false, error: 'No se pudo verificar la biblioteca multimedia.' }, 500);
  }

  const allowed = await enforceRateLimit(`cms-media-token:${auth.userId}`, 600, 20, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta de nuevo más tarde.' }, 429);

  const body = await request.json().catch(() => ({}));
  const originalName = String(body.file_name || '').trim().slice(0, 180);
  const mimeType = String(body.file_type || '').trim().toLowerCase();
  const fileSize = Number(body.file_size || 0);
  if (!originalName || !CMS_IMAGE_MIME_SET.has(mimeType)) {
    return json({ ok: false, error: 'Usa una imagen JPG, PNG o WebP.' }, 400);
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > CMS_IMAGEKIT_MAX_BYTES) {
    return json({ ok: false, error: 'La imagen debe pesar máximo 5 MB.' }, 400);
  }

  const logicalFolder = resolveCmsMediaFolder(
    String(body.folder || ''),
    String(body.page_key || ''),
  );
  const remoteFolder = buildImageKitCmsFolder(logicalFolder);
  const fileName = createCmsMediaFileName(originalName, mimeType);
  const uploadPayload = {
    fileName,
    useUniqueFileName: 'false',
    folder: remoteFolder,
    isPrivateFile: 'false',
    isPublished: 'false',
    tags: 'cms,portal',
    checks: cmsImageKitChecks(),
  };

  return json({
    ok: true,
    provider: 'imagekit',
    upload_url: 'https://upload.imagekit.io/api/v2/files/upload',
    upload_payload: uploadPayload,
    token: createImageKitUploadToken(config, uploadPayload),
    registration_token: createCmsMediaRegistrationToken(config, {
      sub: auth.userId,
      logicalFolder,
      remoteFolder,
      fileName,
    }),
    max_bytes: CMS_IMAGEKIT_MAX_BYTES,
  });
};
