import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText, insertCmsAuditLog } from '@lib/cms';

export const prerender = false;

const BUCKET = String(import.meta.env.CMS_MEDIA_BUCKET || process.env.CMS_MEDIA_BUCKET || 'cms-media').trim();

async function ensureBucket() {
  if (!supabaseAdmin) return;
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if ((buckets || []).some((bucket) => bucket.name === BUCKET)) return;

  await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
  });
}

function safeFolder(input: string | null | undefined): string {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/\/+/, '/');
  return cleaned.replace(/^\/+|\/+$/g, '');
}

function cleanFileName(name: string): string {
  return String(name || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-');
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  const db = supabaseAdmin;

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  await ensureBucket();

  const url = new URL(request.url);
  const prefix = safeFolder(url.searchParams.get('prefix'));
  const limitRaw = Number(url.searchParams.get('limit') || 60);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 60;

  const { data, error } = await db.storage.from(BUCKET).list(prefix, {
    limit,
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) return jsonResponse({ ok: false, error: 'No se pudo listar media', details: error.message }, 500);

  const files = (data || [])
    .filter((item: any) => item?.id)
    .map((item: any) => {
      const path = [prefix, item.name].filter(Boolean).join('/');
      const publicUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      return {
        name: item.name,
        path,
        public_url: publicUrl,
        size: item.metadata?.size || 0,
        mime_type: item.metadata?.mimetype || '',
        created_at: item.created_at || null,
        updated_at: item.updated_at || null,
      };
    });

  return jsonResponse({ ok: true, bucket: BUCKET, files });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.upload' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  await ensureBucket();

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonResponse({ ok: false, error: 'Archivo requerido (file)' }, 400);
  }

  const folder = safeFolder(String(formData.get('folder') || 'general'));
  const pageKey = cleanText(String(formData.get('page_key') || ''), 60).toLowerCase();
  const effectiveFolder = safeFolder([folder, pageKey].filter(Boolean).join('/'));

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const base = cleanFileName(file.name.replace(ext, ''));
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const fileName = `${base || 'media'}-${stamp}${ext}`;
  const path = [effectiveFolder, fileName].filter(Boolean).join('/');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });

  if (error) {
    return jsonResponse({ ok: false, error: 'No se pudo subir archivo', details: error.message }, 500);
  }

  const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  await supabaseAdmin
    .from('cms_media')
    .upsert({
      bucket: BUCKET,
      path,
      public_url: publicUrl,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: auth.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'path' });

  await insertCmsAuditLog({
    action: 'media.upload',
    entityType: 'system',
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { bucket: BUCKET, path, size: file.size, content_type: contentType },
  });

  return jsonResponse({ ok: true, bucket: BUCKET, path, public_url: publicUrl }, 201);
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.media.delete' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = await request.json().catch(() => ({}));
  const path = cleanText(String(body.path || ''), 240);
  if (!path) return jsonResponse({ ok: false, error: 'path requerido' }, 400);

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) {
    return jsonResponse({ ok: false, error: 'No se pudo eliminar archivo', details: error.message }, 500);
  }

  await insertCmsAuditLog({
    action: 'media.delete',
    entityType: 'system',
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { bucket: BUCKET, path },
  });

  await supabaseAdmin.from('cms_media').delete().eq('path', path);

  return jsonResponse({ ok: true });
};
