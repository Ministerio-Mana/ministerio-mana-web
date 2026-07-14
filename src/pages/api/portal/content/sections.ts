import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  clampPosition,
  cleanText,
  insertCmsAuditLog,
  insertCmsRevision,
  isCmsSchemaMissingError,
  isSectionKind,
  isSectionStatus,
  normalizeKey,
  parseJsonBody,
} from '@lib/cms';
import { normalizeCmsStoryPayload } from '@lib/cmsStory';

export const prerender = false;
const MAX_SECTION_REQUEST_CHARS = 70_000;
const MAX_SECTION_PAYLOAD_CHARS = 50_000;

function payloadIsTooLarge(value: unknown): boolean {
  try {
    return JSON.stringify(value ?? {}).length > MAX_SECTION_PAYLOAD_CHARS;
  } catch {
    return true;
  }
}

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

  if (isCmsSchemaMissingError(error)) {
    return jsonResponse({ ok: true, sections: [], schemaReady: false });
  }
  if (error) return jsonResponse({ ok: false, error: 'No se pudieron listar secciones' }, 500);
  return jsonResponse({ ok: true, sections: data ?? [], schemaReady: true });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.sections.create' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const rawBody = await request.text();
  if (rawBody.length > MAX_SECTION_REQUEST_CHARS) {
    return jsonResponse({ ok: false, error: 'El bloque supera el tamaño permitido' }, 413);
  }
  const body = parseJsonBody(rawBody);

  const pageId = cleanText(body.page_id, 60);
  const sectionKey = normalizeKey(body.section_key || body.key || '', 100);
  const kind = String(body.kind || '').toLowerCase();
  const title = cleanText(body.title, 120);
  const position = clampPosition(body.position);

  if (!pageId || !sectionKey || !isSectionKind(kind)) {
    return jsonResponse({ ok: false, error: 'page_id, section_key y kind válidos son obligatorios' }, 400);
  }

  let payload = typeof body.payload === 'object' && body.payload ? body.payload : {};
  if (kind === 'story') payload = normalizeCmsStoryPayload(payload).payload;
  if (payloadIsTooLarge(payload)) {
    return jsonResponse({ ok: false, error: 'El contenido del bloque supera el tamaño permitido' }, 413);
  }

  if (kind === 'story') {
    const { count, error: storyCountError } = await supabaseAdmin
      .from('cms_sections')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', pageId)
      .eq('kind', 'story')
      .neq('status', 'archived');
    if (storyCountError) return jsonResponse({ ok: false, error: 'No se pudo validar la Historia Maná existente' }, 500);
    if ((count || 0) > 0) {
      return jsonResponse({ ok: false, error: 'Esta página ya tiene una Historia Maná.' }, 409);
    }
  }

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

  const rawBody = await request.text();
  if (rawBody.length > MAX_SECTION_REQUEST_CHARS) {
    return jsonResponse({ ok: false, error: 'El bloque supera el tamaño permitido' }, 413);
  }
  const body = parseJsonBody(rawBody);
  const sectionId = cleanText(body.section_id || body.id, 60);
  const expectedUpdatedAt = cleanText(body.expected_updated_at, 60);
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

  let effectiveKind = String(updates.kind || '').toLowerCase();
  let sectionPageId = '';
  if (updates.kind === 'story' && body.payload === undefined) {
    return jsonResponse({ ok: false, error: 'El contenido guiado es obligatorio al cambiar a Historia Maná' }, 400);
  }
  if ((body.payload !== undefined && !effectiveKind) || updates.kind === 'story') {
    const { data: existingSection, error: existingSectionError } = await supabaseAdmin
      .from('cms_sections')
      .select('kind,page_id')
      .eq('id', sectionId)
      .maybeSingle();
    if (existingSectionError || !existingSection) {
      return jsonResponse({ ok: false, error: 'No se pudo validar el tipo de sección' }, 404);
    }
    if (!effectiveKind) effectiveKind = String(existingSection.kind || '').toLowerCase();
    sectionPageId = String(existingSection.page_id || '');
  }

  if (updates.kind === 'story') {
    const { count, error: storyCountError } = await supabaseAdmin
      .from('cms_sections')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', sectionPageId)
      .eq('kind', 'story')
      .neq('status', 'archived')
      .neq('id', sectionId);
    if (storyCountError) return jsonResponse({ ok: false, error: 'No se pudo validar la Historia Maná existente' }, 500);
    if ((count || 0) > 0) return jsonResponse({ ok: false, error: 'Esta página ya tiene una Historia Maná.' }, 409);
  }

  if (body.payload !== undefined) {
    let payload = typeof body.payload === 'object' && body.payload ? body.payload : {};
    if (effectiveKind === 'story') payload = normalizeCmsStoryPayload(payload).payload;
    if (payloadIsTooLarge(payload)) {
      return jsonResponse({ ok: false, error: 'El contenido del bloque supera el tamaño permitido' }, 413);
    }
    updates.payload = payload;
  }

  let updateQuery = supabaseAdmin
    .from('cms_sections')
    .update(updates)
    .eq('id', sectionId);
  if (expectedUpdatedAt) updateQuery = updateQuery.eq('updated_at', expectedUpdatedAt);

  const { data: section, error } = await updateQuery
    .select('*')
    .maybeSingle();

  if (error) {
    return jsonResponse({ ok: false, error: 'No se pudo actualizar la sección', details: error?.message }, 500);
  }
  if (!section) {
    return jsonResponse({
      ok: false,
      error: 'La sección cambió mientras la editabas. Recarga para revisar la versión más reciente antes de guardar.',
    }, 409);
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
