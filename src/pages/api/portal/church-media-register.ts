export const prerender = false;

import type { APIRoute } from 'astro';
import { isCmsSchemaMissingError } from '@lib/cms';
import { CMS_IMAGEKIT_MAX_BYTES, CMS_IMAGE_MIME_SET, isCmsImageDimensionAllowed } from '@lib/cmsMedia';
import { getChurchForPageEditor, requireChurchPageEditor } from '@lib/churchPageAccess';
import { churchMediaFolder } from '@lib/churchPage';
import {
  deleteImageKitFile,
  getImageKitConfig,
  getImageKitFileDetails,
  isImageKitDeliveryUrl,
  verifyCmsMediaRegistrationToken,
} from '@lib/imageKit';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const config = getImageKitConfig();
  if (!config) return json({ ok: false, error: 'ImageKit no está configurado completamente.' }, 503);
  const allowed = await enforceRateLimit(`church-media-register:${auth.access.userId}`, 3600, 80, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas cargas. Intenta más tarde.' }, 429);
  const body = await request.json().catch(() => ({}));
  const churchId = String(body.church_id || '').trim();
  const church = await getChurchForPageEditor(churchId, auth.access);
  if (!church) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);
  const fileId = String(body.file_id || '').trim();
  const registrationToken = String(body.registration_token || '').trim();
  const originalName = String(body.original_name || '').trim().slice(0, 180);
  const claims = verifyCmsMediaRegistrationToken(config, registrationToken);
  const expectedFolder = churchMediaFolder(church as unknown as Record<string, unknown>);
  if (!claims || claims.sub !== auth.access.userId || claims.logicalFolder !== expectedFolder || !/^[A-Za-z0-9_-]{8,160}$/.test(fileId)) {
    return json({ ok: false, error: 'La autorización de carga no es válida.' }, 403);
  }

  const existing = await supabaseAdmin.from('cms_media').select('*').eq('provider_file_id', fileId).maybeSingle();
  if (existing.data) {
    if (existing.data.folder !== expectedFolder) {
      return json({ ok: false, error: 'La imagen ya pertenece a otra biblioteca.' }, 409);
    }
    return json({ ok: true, file: existing.data, already_registered: true });
  }
  if (isCmsSchemaMissingError(existing.error)) return json({ ok: false, error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.' }, 503);
  if (existing.error) return json({ ok: false, error: 'No se pudo validar el registro de la imagen.' }, 500);

  const file = await getImageKitFileDetails(config, fileId).catch(() => null);
  if (!file) return json({ ok: false, error: 'No se pudo verificar la imagen en ImageKit.' }, 502);
  const exactIssuedFile = file.name === claims.fileName && file.filePath === `${claims.remoteFolder}/${claims.fileName}`;
  const mimeType = String(file.mime || '').toLowerCase();
  const validImage = file.fileType === 'image'
    && file.isPublished !== false
    && CMS_IMAGE_MIME_SET.has(mimeType)
    && Number(file.size || 0) > 0
    && Number(file.size || 0) <= CMS_IMAGEKIT_MAX_BYTES
    && isCmsImageDimensionAllowed(file.width)
    && isCmsImageDimensionAllowed(file.height)
    && isImageKitDeliveryUrl(config, String(file.url || ''));
  if (!exactIssuedFile || !validImage) {
    if (exactIssuedFile) await deleteImageKitFile(config, fileId).catch(() => undefined);
    return json({ ok: false, error: 'ImageKit rechazó la imagen por seguridad.' }, 400);
  }

  const inserted = await supabaseAdmin.from('cms_media').insert({
    provider: 'imagekit',
    provider_file_id: fileId,
    bucket: 'imagekit',
    path: file.filePath,
    folder: claims.logicalFolder,
    original_name: originalName || file.name,
    public_url: file.url,
    mime_type: mimeType,
    size_bytes: Number(file.size || 0),
    width: Number(file.width),
    height: Number(file.height),
    tags: ['cms', 'portal', 'church', `church-${churchId}`],
    meta: { imagekit_name: file.name, imagekit_thumbnail_url: file.thumbnailUrl || file.thumbnail || null },
    uploaded_by: auth.access.userId,
    updated_at: new Date().toISOString(),
  }).select('*').single();
  if (inserted.error?.code === '23505') {
    const raced = await supabaseAdmin.from('cms_media').select('*').eq('provider_file_id', fileId).maybeSingle();
    if (raced.data?.folder === expectedFolder) {
      return json({ ok: true, file: raced.data, already_registered: true });
    }
  }
  if (inserted.error) {
    await deleteImageKitFile(config, fileId).catch(() => undefined);
    return json({ ok: false, error: 'No se pudo registrar la imagen.' }, 500);
  }
  await supabaseAdmin.from('church_public_page_audit_logs').insert({
    church_id: churchId,
    action: 'media.upload',
    next_snapshot: { file_id: fileId, folder: claims.logicalFolder, size: file.size, width: file.width, height: file.height },
    actor_user_id: auth.access.userId,
    actor_email: auth.access.email,
    request_ip: clientAddress,
  });
  return json({ ok: true, file: inserted.data }, 201);
};
