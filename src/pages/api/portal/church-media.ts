export const prerender = false;

import type { APIRoute } from 'astro';
import { isCmsSchemaMissingError } from '@lib/cms';
import { getChurchForPageEditor, requireChurchPageEditor } from '@lib/churchPageAccess';
import { churchMediaFolder } from '@lib/churchPage';
import { getCmsMediaProvider, getImageKitConfig } from '@lib/imageKit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function folderFor(church: Record<string, unknown>): string {
  return churchMediaFolder(church);
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const churchId = String(new URL(request.url).searchParams.get('church_id') || '').trim();
  const church = await getChurchForPageEditor(churchId, auth.access);
  if (!church) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);
  if (getCmsMediaProvider() === 'imagekit' && !getImageKitConfig()) {
    return json({ ok: false, error: 'ImageKit no está configurado completamente.' }, 503);
  }

  const folder = folderFor(church as unknown as Record<string, unknown>);
  const result = await supabaseAdmin
    .from('cms_media')
    .select('id,provider,provider_file_id,original_name,path,folder,public_url,mime_type,size_bytes,width,height,meta,created_at')
    .eq('folder', folder)
    .order('created_at', { ascending: false })
    .limit(80);
  if (isCmsSchemaMissingError(result.error)) {
    return json({ ok: false, setup_required: true, error: 'Falta ejecutar docs/sql/cms_media_imagekit_upgrade.sql.' }, 503);
  }
  if (result.error) return json({ ok: false, error: 'No se pudo cargar la biblioteca de esta iglesia.' }, 500);

  return json({
    ok: true,
    provider: getCmsMediaProvider(),
    folder,
    files: (result.data || []).map((row: any) => ({
      id: row.id,
      name: row.original_name || String(row.path || '').split('/').pop() || 'imagen',
      public_url: row.public_url,
      thumbnail_url: row.meta?.imagekit_thumbnail_url || row.public_url,
      width: Number(row.width || 0) || null,
      height: Number(row.height || 0) || null,
      size: Number(row.size_bytes || 0),
      created_at: row.created_at,
    })),
  });
};
