import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText, insertCmsAuditLog, insertCmsRevision, parseJsonBody } from '@lib/cms';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.publish' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());
  const pageId = cleanText(body.page_id, 60);
  const action = String(body.action || '').toLowerCase();

  if (!pageId || !['publish', 'unpublish'].includes(action)) {
    return jsonResponse({ ok: false, error: 'page_id y action (publish|unpublish) son obligatorios' }, 400);
  }

  const now = new Date().toISOString();
  const isPublish = action === 'publish';

  const { data: pageBefore, error: pageError } = await supabaseAdmin
    .from('cms_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();

  if (pageError || !pageBefore) {
    return jsonResponse({ ok: false, error: 'Página no encontrada' }, 404);
  }

  const { data: updatedPage, error: updatePageError } = await supabaseAdmin
    .from('cms_pages')
    .update({
      status: isPublish ? 'published' : 'draft',
      published_at: isPublish ? now : null,
      published_by: isPublish ? auth.userId : null,
      version: Number(pageBefore.version || 1) + 1,
      updated_at: now,
      updated_by: auth.userId,
    })
    .eq('id', pageId)
    .select('*')
    .single();

  if (updatePageError || !updatedPage) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar estado de la página', details: updatePageError?.message }, 500);
  }

  const { error: sectionsError } = await supabaseAdmin
    .from('cms_sections')
    .update({
      status: isPublish ? 'published' : 'draft',
      published_at: isPublish ? now : null,
      updated_at: now,
      updated_by: auth.userId,
    })
    .eq('page_id', pageId)
    .neq('status', 'archived');

  if (sectionsError) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar estado de las secciones', details: sectionsError.message }, 500);
  }

  await insertCmsRevision({
    entityType: 'page',
    entityId: pageId,
    pageId,
    action: isPublish ? 'publish' : 'unpublish',
    snapshot: updatedPage,
    actorUserId: auth.userId,
  });

  await insertCmsAuditLog({
    action: isPublish ? 'page.publish' : 'page.unpublish',
    entityType: 'page',
    entityId: pageId,
    pageId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { previous_status: pageBefore.status, next_status: updatedPage.status, version: updatedPage.version },
  });

  return jsonResponse({ ok: true, page: updatedPage });
};
