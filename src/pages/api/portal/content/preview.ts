import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { cleanText } from '@lib/cms';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.preview.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const url = new URL(request.url);
  const pageId = cleanText(url.searchParams.get('page_id'), 60);
  if (!pageId) return jsonResponse({ ok: false, error: 'page_id es obligatorio' }, 400);

  const [pageResult, sectionsResult] = await Promise.all([
    supabaseAdmin
      .from('cms_pages')
      .select('id,page_key,route_path,title,status,version,updated_at')
      .eq('id', pageId)
      .maybeSingle(),
    supabaseAdmin
      .from('cms_sections')
      .select('id,section_key,kind,title,position,payload,status,updated_at')
      .eq('page_id', pageId)
      .neq('status', 'archived')
      .order('position', { ascending: true }),
  ]);

  if (pageResult.error || !pageResult.data) {
    return jsonResponse({ ok: false, error: 'Página no encontrada' }, 404);
  }
  if (sectionsResult.error) {
    return jsonResponse({ ok: false, error: 'No se pudieron cargar las secciones de la vista previa' }, 500);
  }

  return jsonResponse({
    ok: true,
    page: pageResult.data,
    sections: sectionsResult.data ?? [],
  });
};
