import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText } from '@lib/cms';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.preview-link' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = await request.json().catch(() => ({}));
  const pageId = cleanText(String(body.page_id || ''), 80);
  if (!pageId) return jsonResponse({ ok: false, error: 'page_id requerido' }, 400);

  const { data: page, error } = await supabaseAdmin
    .from('cms_pages')
    .select('id')
    .eq('id', pageId)
    .maybeSingle();

  if (error || !page) return jsonResponse({ ok: false, error: 'Página no encontrada' }, 404);

  const previewPath = `/portal/content-preview?page_id=${encodeURIComponent(page.id)}`;

  return jsonResponse({ ok: true, preview_path: previewPath });
};
