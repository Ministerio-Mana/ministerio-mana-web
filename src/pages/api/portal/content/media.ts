import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText, insertCmsAuditLog, isCmsSchemaMissingError } from '@lib/cms';
import {
  CMS_IMAGE_MIME_SET,
  CMS_SUPABASE_MAX_BYTES,
  createCmsMediaFileName,
  isCmsImageDimensionAllowed,
  resolveCmsMediaFolder,
  safeCmsMediaFolder,
} from '@lib/cmsMedia';
import {
  deleteImageKitFile,
  getCmsMediaProvider,
  getImageKitConfig,
  purgeImageKitUrl,
} from '@lib/imageKit';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

const BUCKET = String(import.meta.env.CMS_MEDIA_BUCKET || process.env.CMS_MEDIA_BUCKET || 'cms-media').trim();
const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

async function ensureBucket() {
  if (!supabaseAdmin) return;
  const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
  if (error) throw error;
  if ((buckets || []).some((bucket) => bucket.name === BUCKET)) return;

  const created = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: CMS_SUPABASE_MAX_BYTES,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  });
  if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
    throw created.error;
  }
}

function rowFolder(row: any): string {
  if (row?.folder) return safeCmsMediaFolder(row.folder);
  const path = String(row?.path || '').replace(/^\/+/, '');
  const imageKitPrefix = 'ministerio-mana/cms/';
  const withoutPrefix = path.startsWith(imageKitPrefix) ? path.slice(imageKitPrefix.length) : path;
  const slash = withoutPrefix.lastIndexOf('/');
  return slash > 0 ? safeCmsMediaFolder(withoutPrefix.slice(0, slash)) : 'general';
}

function folderMatches(candidate: string, requested: string): boolean {
  if (!requested) return true;
  return candidate === requested || candidate.startsWith(`${requested}/`);
}

function mediaRowToFile(row: any) {
  const path = String(row?.path || '');
  const provider = row?.provider === 'imagekit' || row?.bucket === 'imagekit' ? 'imagekit' : 'supabase';
  return {
    media_id: row?.id || null,
    provider,
    provider_file_id: row?.provider_file_id || null,
    name: row?.original_name || path.split('/').pop() || 'imagen',
    path,
    folder: rowFolder(row),
    public_url: row?.public_url || '',
    thumbnail_url: row?.meta?.imagekit_thumbnail_url || null,
    size: Number(row?.size_bytes || 0),
    mime_type: row?.mime_type || '',
    width: Number(row?.width || row?.meta?.width || 0) || null,
    height: Number(row?.height || row?.meta?.height || 0) || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const provider = getCmsMediaProvider();
  if (provider === 'imagekit') {
    if (!getImageKitConfig()) {
      return jsonResponse({ ok: false, error: 'ImageKit no está configurado completamente.' }, 503);
    }
    const schemaCheck = await supabaseAdmin.from('cms_media').select('provider').limit(1);
    if (schemaCheck.error && isCmsSchemaMissingError(schemaCheck.error)) {
      return jsonResponse({
        ok: false,
        error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.',
      }, 503);
    }
  }

  const url = new URL(request.url);
  const prefix = safeCmsMediaFolder(url.searchParams.get('prefix'));
  const limitRaw = Number(url.searchParams.get('limit') || 60);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 60;
  const result = await supabaseAdmin
    .from('cms_media')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(600, Math.max(100, limit * 4)));

  if (result.error) {
    return jsonResponse({ ok: false, error: 'No se pudo listar media', details: result.error.message }, 500);
  }

  const files = (result.data || [])
    .map(mediaRowToFile)
    .filter((file) => folderMatches(file.folder, prefix))
    .slice(0, limit);

  return jsonResponse({
    ok: true,
    provider,
    bucket: provider === 'imagekit' ? 'imagekit' : BUCKET,
    max_bytes: provider === 'imagekit' ? 5 * 1024 * 1024 : CMS_SUPABASE_MAX_BYTES,
    files,
  });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  if (getCmsMediaProvider() === 'imagekit') {
    return jsonResponse({ ok: false, error: 'Usa el flujo directo de ImageKit.' }, 409);
  }

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.upload' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);
  const allowed = await enforceRateLimit(`cms-media-upload:${auth.userId || auth.email || 'legacy'}`, 600, 20);
  if (!allowed) return jsonResponse({ ok: false, error: 'Demasiadas cargas. Intenta más tarde.' }, 429);

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > CMS_SUPABASE_MAX_BYTES + 120_000) {
    return jsonResponse({ ok: false, error: 'La imagen supera el máximo de 4 MB.' }, 413);
  }

  try {
    await ensureBucket();
  } catch (error) {
    console.error('[cms-media] bucket setup failed', error);
    return jsonResponse({ ok: false, error: 'No se pudo preparar la biblioteca.' }, 500);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ ok: false, error: 'No se pudo leer la imagen.' }, 400);
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return jsonResponse({ ok: false, error: 'Archivo requerido (file)' }, 400);
  if (file.size <= 0 || file.size > CMS_SUPABASE_MAX_BYTES || !CMS_IMAGE_MIME_SET.has(file.type)) {
    return jsonResponse({ ok: false, error: 'Usa una imagen JPG, PNG o WebP de máximo 4 MB.' }, 400);
  }

  const folder = resolveCmsMediaFolder(
    String(formData.get('folder') || ''),
    cleanText(String(formData.get('page_key') || ''), 60).toLowerCase(),
  );

  let sanitized: Uint8Array = new Uint8Array();
  let contentType = '';
  let width = 0;
  let height = 0;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: 'error', limitInputPixels: 25_000_000 });
    const metadata = await image.metadata();
    contentType = FORMAT_TO_MIME[String(metadata.format || '')] || '';
    width = Number(metadata.width || 0);
    height = Number(metadata.height || 0);
    if (!contentType || contentType !== file.type || !isCmsImageDimensionAllowed(width) || !isCmsImageDimensionAllowed(height)) {
      return jsonResponse({ ok: false, error: 'El contenido o las dimensiones de la imagen no son válidos.' }, 400);
    }

    const rotated = image.rotate();
    if (metadata.format === 'jpeg') sanitized = await rotated.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    else if (metadata.format === 'png') sanitized = await rotated.png({ compressionLevel: 9 }).toBuffer();
    else sanitized = await rotated.webp({ quality: 82 }).toBuffer();
  } catch (error) {
    console.error('[cms-media] image validation failed', error);
    return jsonResponse({ ok: false, error: 'La imagen no pudo validarse de forma segura.' }, 400);
  }
  if (sanitized.byteLength > CMS_SUPABASE_MAX_BYTES) {
    return jsonResponse({ ok: false, error: 'La imagen procesada supera el máximo de 4 MB.' }, 400);
  }

  const fileName = createCmsMediaFileName(file.name, contentType);
  const path = `${folder}/${fileName}`;
  const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(path, sanitized, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  });
  if (uploaded.error) {
    return jsonResponse({ ok: false, error: 'No se pudo subir archivo', details: uploaded.error.message }, 500);
  }

  const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const extendedRecord = {
    provider: 'supabase',
    provider_file_id: null,
    bucket: BUCKET,
    path,
    folder,
    original_name: file.name.slice(0, 180),
    public_url: publicUrl,
    mime_type: contentType,
    size_bytes: sanitized.byteLength,
    width,
    height,
    meta: { original_size: file.size, width, height },
    uploaded_by: auth.userId,
    updated_at: new Date().toISOString(),
  };
  let stored = await supabaseAdmin.from('cms_media').upsert(extendedRecord, { onConflict: 'path' });
  if (stored.error && isCmsSchemaMissingError(stored.error)) {
    stored = await supabaseAdmin.from('cms_media').upsert({
      bucket: BUCKET,
      path,
      public_url: publicUrl,
      mime_type: contentType,
      size_bytes: sanitized.byteLength,
      meta: { original_size: file.size, width, height, folder, provider: 'supabase' },
      uploaded_by: auth.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'path' });
  }
  if (stored.error) {
    await supabaseAdmin.storage.from(BUCKET).remove([path]);
    console.error('[cms-media] database registration failed', stored.error);
    return jsonResponse({ ok: false, error: 'No se pudo registrar la imagen.' }, 500);
  }

  await insertCmsAuditLog({
    action: 'media.upload',
    entityType: 'system',
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: {
      provider: 'supabase',
      bucket: BUCKET,
      path,
      folder,
      original_size: file.size,
      stored_size: sanitized.byteLength,
      content_type: contentType,
      width,
      height,
    },
  });

  return jsonResponse({ ok: true, provider: 'supabase', bucket: BUCKET, path, public_url: publicUrl }, 201);
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.delete' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);
  const allowed = await enforceRateLimit(`cms-media-delete:${auth.userId || auth.email || 'legacy'}`, 600, 30);
  if (!allowed) return jsonResponse({ ok: false, error: 'Demasiadas eliminaciones. Intenta más tarde.' }, 429);

  const body = await request.json().catch(() => ({}));
  const mediaId = cleanText(String(body.media_id || ''), 80);
  const requestedPath = cleanText(String(body.path || ''), 500);
  if (!mediaId && !requestedPath) return jsonResponse({ ok: false, error: 'media_id requerido' }, 400);

  let record: any = null;
  if (mediaId) {
    const found = await supabaseAdmin.from('cms_media').select('*').eq('id', mediaId).maybeSingle();
    if (found.error) return jsonResponse({ ok: false, error: 'No se pudo consultar el archivo.' }, 500);
    record = found.data;
  } else {
    const found = await supabaseAdmin.from('cms_media').select('*').eq('path', requestedPath).maybeSingle();
    record = found.data || null;
  }

  const provider = record?.provider === 'imagekit' || record?.bucket === 'imagekit' ? 'imagekit' : 'supabase';
  const path = String(record?.path || requestedPath || '');
  let cachePurgeRequested: boolean | null = null;
  if (!path) return jsonResponse({ ok: false, error: 'Archivo no encontrado.' }, 404);

  if (provider === 'imagekit') {
    if (auth.isPasswordSession || !auth.userId) {
      return jsonResponse({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
    }
    const config = getImageKitConfig();
    const fileId = String(record?.provider_file_id || '');
    if (!config || !fileId) return jsonResponse({ ok: false, error: 'ImageKit no está configurado.' }, 503);
    try {
      await deleteImageKitFile(config, fileId);
      const publicUrl = String(record?.public_url || '');
      if (publicUrl) {
        try {
          await purgeImageKitUrl(config, publicUrl);
          cachePurgeRequested = true;
        } catch (error) {
          cachePurgeRequested = false;
          console.warn('[cms-media] ImageKit cache purge request failed', error);
        }
      }
    } catch (error) {
      console.error('[cms-media] ImageKit deletion failed', error);
      return jsonResponse({ ok: false, error: 'No se pudo eliminar la imagen en ImageKit.' }, 502);
    }
  } else {
    const removed = await supabaseAdmin.storage.from(String(record?.bucket || BUCKET)).remove([path]);
    if (removed.error) {
      return jsonResponse({ ok: false, error: 'No se pudo eliminar archivo', details: removed.error.message }, 500);
    }
  }

  const deleted = mediaId
    ? await supabaseAdmin.from('cms_media').delete().eq('id', mediaId)
    : await supabaseAdmin.from('cms_media').delete().eq('path', path);
  if (deleted.error) {
    console.error('[cms-media] deleted provider file but database cleanup failed', deleted.error);
    return jsonResponse({ ok: false, error: 'El archivo se eliminó, pero falta limpiar su registro.' }, 500);
  }

  await insertCmsAuditLog({
    action: 'media.delete',
    entityType: 'system',
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: {
      provider,
      path,
      media_id: mediaId || record?.id || null,
      cache_purge_requested: cachePurgeRequested,
    },
  });

  return jsonResponse({ ok: true });
};
