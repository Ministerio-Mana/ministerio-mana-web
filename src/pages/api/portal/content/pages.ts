import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  cleanText,
  insertCmsAuditLog,
  insertCmsRevision,
  isCmsSchemaMissingError,
  isPageStatus,
  normalizeKey,
  normalizeRoutePath,
  parseJsonBody,
} from '@lib/cms';

export const prerender = false;

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.pages.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const url = new URL(request.url);
  const pageId = String(url.searchParams.get('page_id') || '').trim();

  if (pageId) {
    const { data: page, error } = await supabaseAdmin
      .from('cms_pages')
      .select('*')
      .eq('id', pageId)
      .maybeSingle();

    if (isCmsSchemaMissingError(error)) {
      return jsonResponse({ ok: false, error: 'CMS no configurado' }, 404);
    }
    if (error || !page) return jsonResponse({ ok: false, error: 'Página no encontrada' }, 404);

    const { data: sections } = await supabaseAdmin
      .from('cms_sections')
      .select('*')
      .eq('page_id', pageId)
      .order('position', { ascending: true });

    return jsonResponse({ ok: true, page, sections: sections ?? [] });
  }

  const { data, error } = await supabaseAdmin
    .from('cms_pages')
    .select('id, page_key, route_path, locale, title, description, status, version, published_at, updated_at')
    .order('updated_at', { ascending: false });

  if (isCmsSchemaMissingError(error)) {
    return jsonResponse({ ok: true, pages: [], schemaReady: false });
  }
  if (error) return jsonResponse({ ok: false, error: 'No se pudo listar páginas' }, 500);

  return jsonResponse({ ok: true, pages: data ?? [], schemaReady: true });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.pages.create' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());
  const pageKey = normalizeKey(body.page_key || body.key || '');
  const title = cleanText(body.title, 120);
  const routePath = normalizeRoutePath(body.route_path || body.path || '/');
  const locale = cleanText(body.locale || 'es', 8).toLowerCase() || 'es';
  const description = cleanText(body.description, 320);

  if (!pageKey || !title || !routePath) {
    return jsonResponse({ ok: false, error: 'page_key, title y route_path son obligatorios' }, 400);
  }

  const { data: created, error } = await supabaseAdmin
    .from('cms_pages')
    .insert({
      page_key: pageKey,
      route_path: routePath,
      locale,
      title,
      description,
      status: 'draft',
      seo: {},
      settings: {},
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select('*')
    .single();

  if (error || !created) {
    return jsonResponse({ ok: false, error: 'No se pudo crear la página', details: error?.message }, 500);
  }

  await insertCmsRevision({
    entityType: 'page',
    entityId: created.id,
    pageId: created.id,
    action: 'create',
    snapshot: created,
    actorUserId: auth.userId,
  });

  await insertCmsAuditLog({
    action: 'page.create',
    entityType: 'page',
    entityId: created.id,
    pageId: created.id,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { page_key: created.page_key, route_path: created.route_path },
  });

  return jsonResponse({ ok: true, page: created }, 201);
};

export const PUT: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.pages.update' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());
  const pageId = cleanText(body.page_id || body.id, 60);
  const expectedUpdatedAt = cleanText(body.expected_updated_at, 60);
  if (!pageId) return jsonResponse({ ok: false, error: 'page_id es obligatorio' }, 400);

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.userId,
  };

  if (body.title !== undefined) {
    const title = cleanText(body.title, 120);
    if (!title) return jsonResponse({ ok: false, error: 'title inválido' }, 400);
    updates.title = title;
  }
  if (body.description !== undefined) updates.description = cleanText(body.description, 320);
  if (body.page_key !== undefined || body.key !== undefined) {
    const pageKey = normalizeKey(body.page_key || body.key);
    if (!pageKey) return jsonResponse({ ok: false, error: 'page_key inválido' }, 400);
    updates.page_key = pageKey;
  }
  if (body.route_path !== undefined || body.path !== undefined) {
    const routePath = normalizeRoutePath(body.route_path || body.path);
    if (!routePath) return jsonResponse({ ok: false, error: 'route_path inválido' }, 400);
    updates.route_path = routePath;
  }
  if (body.locale !== undefined) updates.locale = cleanText(body.locale, 8).toLowerCase() || 'es';
  if (body.status !== undefined) {
    const status = String(body.status || '').toLowerCase();
    if (!isPageStatus(status)) return jsonResponse({ ok: false, error: 'status inválido' }, 400);
    updates.status = status;
  }
  if (body.seo !== undefined) updates.seo = typeof body.seo === 'object' && body.seo ? body.seo : {};
  if (body.settings !== undefined) updates.settings = typeof body.settings === 'object' && body.settings ? body.settings : {};

  let updateQuery = supabaseAdmin
    .from('cms_pages')
    .update(updates)
    .eq('id', pageId);
  if (expectedUpdatedAt) updateQuery = updateQuery.eq('updated_at', expectedUpdatedAt);

  const { data: updated, error } = await updateQuery
    .select('*')
    .maybeSingle();

  if (error) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar página', details: error?.message }, 500);
  }
  if (!updated) {
    return jsonResponse({
      ok: false,
      error: 'La página cambió mientras la editabas. Recarga para revisar la versión más reciente antes de guardar.',
    }, 409);
  }

  await insertCmsRevision({
    entityType: 'page',
    entityId: updated.id,
    pageId: updated.id,
    action: 'update',
    snapshot: updated,
    actorUserId: auth.userId,
  });

  await insertCmsAuditLog({
    action: 'page.update',
    entityType: 'page',
    entityId: updated.id,
    pageId: updated.id,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { status: updated.status, title: updated.title },
  });

  return jsonResponse({ ok: true, page: updated });
};
