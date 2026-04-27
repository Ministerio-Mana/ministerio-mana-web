import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  clampPosition,
  cleanText,
  insertCmsAuditLog,
  insertCmsRevision,
  isSectionKind,
  isSectionStatus,
  normalizeKey,
  parseJsonBody,
} from '@lib/cms';

export const prerender = false;

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.sections.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const url = new URL(request.url);
  const pageId = String(url.searchParams.get('page_id') || '').trim();
  if (!pageId) return jsonResponse({ ok: false, error: 'page_id es obligatorio' }, 400);

  const { data, error } = await supabaseAdmin
    .from('cms_sections')
    .select('*')
    .eq('page_id', pageId)
    .order('position', { ascending: true });

  if (error) return jsonResponse({ ok: false, error: 'No se pudieron listar secciones' }, 500);
  return jsonResponse({ ok: true, sections: data ?? [] });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.sections.create' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());

  const pageId = cleanText(body.page_id, 60);
  const sectionKey = normalizeKey(body.section_key || body.key || '', 100);
  const kind = String(body.kind || '').toLowerCase();
  const title = cleanText(body.title, 120);
  const position = clampPosition(body.position);

  if (!pageId || !sectionKey || !isSectionKind(kind)) {
    return jsonResponse({ ok: false, error: 'page_id, section_key y kind válidos son obligatorios' }, 400);
  }

  const payload = typeof body.payload === 'object' && body.payload ? body.payload : {};

  const { data: section, error } = await supabaseAdmin
    .from('cms_sections')
    .insert({
      page_id: pageId,
      section_key: sectionKey,
      kind,
      title,
      position,
      payload,
      status: 'draft',
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select('*')
    .single();

  if (error || !section) {
    return jsonResponse({ ok: false, error: 'No se pudo crear la sección', details: error?.message }, 500);
  }

  await insertCmsRevision({
    entityType: 'section',
    entityId: section.id,
    pageId,
    action: 'create',
    snapshot: section,
    actorUserId: auth.userId,
  });

  await insertCmsAuditLog({
    action: 'section.create',
    entityType: 'section',
    entityId: section.id,
    pageId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { section_key: section.section_key, kind: section.kind },
  });

  return jsonResponse({ ok: true, section }, 201);
};

export const PUT: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.sections.update' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const body = parseJsonBody(await request.text());
  const sectionId = cleanText(body.section_id || body.id, 60);
  if (!sectionId) return jsonResponse({ ok: false, error: 'section_id es obligatorio' }, 400);

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.userId,
  };

  if (body.section_key !== undefined || body.key !== undefined) {
    const sectionKey = normalizeKey(body.section_key || body.key || '', 100);
    if (!sectionKey) return jsonResponse({ ok: false, error: 'section_key inválido' }, 400);
    updates.section_key = sectionKey;
  }

  if (body.kind !== undefined) {
    const kind = String(body.kind || '').toLowerCase();
    if (!isSectionKind(kind)) return jsonResponse({ ok: false, error: 'kind inválido' }, 400);
    updates.kind = kind;
  }

  if (body.title !== undefined) updates.title = cleanText(body.title, 120);
  if (body.position !== undefined) updates.position = clampPosition(body.position);

  if (body.status !== undefined) {
    const status = String(body.status || '').toLowerCase();
    if (!isSectionStatus(status)) return jsonResponse({ ok: false, error: 'status inválido' }, 400);
    updates.status = status;
  }

  if (body.payload !== undefined) {
    updates.payload = typeof body.payload === 'object' && body.payload ? body.payload : {};
  }

  const { data: section, error } = await supabaseAdmin
    .from('cms_sections')
    .update(updates)
    .eq('id', sectionId)
    .select('*')
    .single();

  if (error || !section) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar la sección', details: error?.message }, 500);
  }

  await insertCmsRevision({
    entityType: 'section',
    entityId: section.id,
    pageId: section.page_id,
    action: 'update',
    snapshot: section,
    actorUserId: auth.userId,
  });

  await insertCmsAuditLog({
    action: 'section.update',
    entityType: 'section',
    entityId: section.id,
    pageId: section.page_id,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    requestIp: clientAddress,
    meta: { section_key: section.section_key, status: section.status },
  });

  return jsonResponse({ ok: true, section });
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.sections.delete' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const url = new URL(request.url);
  const sectionId = cleanText(url.searchParams.get('section_id'), 60);
  if (!sectionId) return jsonResponse({ ok: false, error: 'section_id es obligatorio' }, 400);

  const { data: existing } = await supabaseAdmin
    .from('cms_sections')
    .select('*')
    .eq('id', sectionId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from('cms_sections')
    .delete()
    .eq('id', sectionId);

  if (error) {
    return jsonResponse({ ok: false, error: 'No se pudo eliminar la sección', details: error.message }, 500);
  }

  if (existing?.id) {
    await insertCmsRevision({
      entityType: 'section',
      entityId: existing.id,
      pageId: existing.page_id,
      action: 'delete',
      snapshot: existing,
      actorUserId: auth.userId,
    });

    await insertCmsAuditLog({
      action: 'section.delete',
      entityType: 'section',
      entityId: existing.id,
      pageId: existing.page_id,
      actorUserId: auth.userId,
      actorEmail: auth.email,
      requestIp: clientAddress,
      meta: { section_key: existing.section_key },
    });
  }

  return jsonResponse({ ok: true });
};
