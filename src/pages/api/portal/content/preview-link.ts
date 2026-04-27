import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText } from '@lib/cms';

export const prerender = false;

function getPreviewToken(): string {
  return String(import.meta.env.CMS_PREVIEW_TOKEN || process.env.CMS_PREVIEW_TOKEN || '').trim();
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.preview-link' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = await request.json().catch(() => ({}));
  const pageId = cleanText(String(body.page_id || ''), 80);
  if (!pageId) return jsonResponse({ ok: false, error: 'page_id requerido' }, 400);

  const { data: page, error } = await supabaseAdmin
    .from('cms_pages')
    .select('id, route_path')
    .eq('id', pageId)
    .maybeSingle();

  if (error || !page) return jsonResponse({ ok: false, error: 'Página no encontrada' }, 404);

  const token = getPreviewToken();
  if (!token) {
    return jsonResponse({ ok: false, error: 'CMS_PREVIEW_TOKEN no configurado en servidor' }, 500);
  }

  const path = String(page.route_path || '/').startsWith('/') ? String(page.route_path || '/') : `/${String(page.route_path || '/')}`;
  const previewPath = `${path}${path.includes('?') ? '&' : '?'}cms_preview=${encodeURIComponent(token)}`;

  return jsonResponse({ ok: true, preview_path: previewPath });
};
