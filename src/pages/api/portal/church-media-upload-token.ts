export const prerender = false;

import type { APIRoute } from 'astro';
import { isCmsSchemaMissingError } from '@lib/cms';
import { CMS_IMAGEKIT_MAX_BYTES, CMS_IMAGE_MIME_SET, cmsImageKitChecks, createCmsMediaFileName } from '@lib/cmsMedia';
import { getChurchForPageEditor, requireChurchPageEditor } from '@lib/churchPageAccess';
import { churchMediaFolder } from '@lib/churchPage';
import {
  buildImageKitCmsFolder,
  createCmsMediaRegistrationToken,
  createImageKitUploadToken,
  getCmsMediaProvider,
  getImageKitConfig,
} from '@lib/imageKit';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (getCmsMediaProvider() !== 'imagekit') return json({ ok: false, error: 'ImageKit no está activado.' }, 409);
  const config = getImageKitConfig();
  if (!config) return json({ ok: false, error: 'ImageKit no está configurado completamente.' }, 503);
  const body = await request.json().catch(() => ({}));
  const churchId = String(body.church_id || '').trim();
  const church = await getChurchForPageEditor(churchId, auth.access);
  if (!church) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);
  const schemaCheck = await supabaseAdmin.from('cms_media').select('provider').limit(1);
  if (isCmsSchemaMissingError(schemaCheck.error)) return json({ ok: false, error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.' }, 503);

  const allowed = await enforceRateLimit(`church-media-token:${auth.access.userId}:${churchId}`, 3600, 80, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta más tarde.' }, 429);
  const originalName = String(body.file_name || '').trim().slice(0, 180);
  const mimeType = String(body.file_type || '').trim().toLowerCase();
  const fileSize = Number(body.file_size || 0);
  if (!originalName || !CMS_IMAGE_MIME_SET.has(mimeType)) return json({ ok: false, error: 'Usa JPG, PNG o WebP.' }, 400);
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > CMS_IMAGEKIT_MAX_BYTES) {
    return json({ ok: false, error: 'La imagen debe pesar máximo 5 MB.' }, 400);
  }

  const logicalFolder = churchMediaFolder(church as unknown as Record<string, unknown>);
  const remoteFolder = buildImageKitCmsFolder(logicalFolder);
  const fileName = createCmsMediaFileName(originalName, mimeType);
  const uploadPayload = {
    fileName,
    useUniqueFileName: 'false',
    folder: remoteFolder,
    isPrivateFile: 'false',
    tags: `cms,portal,church,church-${churchId}`,
    checks: cmsImageKitChecks(),
  };
  return json({
    ok: true,
    upload_url: 'https://upload.imagekit.io/api/v2/files/upload',
    upload_payload: uploadPayload,
    token: createImageKitUploadToken(config, uploadPayload),
    registration_token: createCmsMediaRegistrationToken(config, {
      sub: auth.access.userId!,
      logicalFolder,
      remoteFolder,
      fileName,
    }),
    max_bytes: CMS_IMAGEKIT_MAX_BYTES,
  });
};
