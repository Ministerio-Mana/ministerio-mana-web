import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { cleanText, insertCmsAuditLog, insertCmsRevision, parseJsonBody } from '@lib/cms';
import { normalizeCmsStoryPayload } from '@lib/cmsStory';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.publish' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());
  const pageId = cleanText(body.page_id, 60);
  const action = String(body.action || '').toLowerCase();
  const expectedUpdatedAt = cleanText(body.expected_updated_at, 60);

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
  if (expectedUpdatedAt && expectedUpdatedAt !== pageBefore.updated_at) {
    return jsonResponse({
      ok: false,
      error: 'La página cambió mientras confirmabas. Recarga y revisa la versión más reciente antes de publicar.',
    }, 409);
  }

  if (isPublish) {
    const { data: storySections, error: storySectionsError } = await supabaseAdmin
      .from('cms_sections')
      .select('title,payload')
      .eq('page_id', pageId)
      .eq('kind', 'story')
      .neq('status', 'archived');

    if (storySectionsError) {
      return jsonResponse({ ok: false, error: 'No se pudo validar la historia antes de publicar' }, 500);
    }
    if ((storySections?.length || 0) > 1) {
      return jsonResponse({ ok: false, error: 'Cada página puede publicar una sola Historia Maná.' }, 400);
    }
    for (const storySection of storySections ?? []) {
      const validation = normalizeCmsStoryPayload(storySection.payload, { requirePublishable: true });
      if (!validation.ok) {
        return jsonResponse({
          ok: false,
          error: `Revisa “${storySection.title || 'Historia Maná'}”: ${validation.errors[0]}`,
          validation_errors: validation.errors,
        }, 400);
      }
    }
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
    .eq('updated_at', pageBefore.updated_at)
    .select('*')
    .maybeSingle();

  if (updatePageError) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar estado de la página', details: updatePageError?.message }, 500);
  }
  if (!updatedPage) {
    return jsonResponse({
      ok: false,
      error: 'La página cambió mientras confirmabas. Recarga y revisa la versión más reciente antes de publicar.',
    }, 409);
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
    const { error: rollbackError } = await supabaseAdmin
      .from('cms_pages')
      .update({
        status: pageBefore.status,
        published_at: pageBefore.published_at,
        published_by: pageBefore.published_by,
        version: pageBefore.version,
        updated_at: pageBefore.updated_at,
        updated_by: pageBefore.updated_by,
      })
      .eq('id', pageId)
      .eq('updated_at', updatedPage.updated_at);

    return jsonResponse({
      ok: false,
      error: rollbackError
        ? 'No se pudo completar la publicación y la página requiere revisión antes de reintentar.'
        : 'No se pudo completar la publicación. La página volvió a su estado anterior; puedes reintentar.',
      details: sectionsError.message,
    }, 500);
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
