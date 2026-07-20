export const prerender = false;

import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  churchMediaFolder,
  createChurchPageDraft,
  isChurchPageSchemaMissingError,
  normalizeChurchPageDraft,
  validateChurchPageForPublish,
} from '@lib/churchPage';
import {
  getChurchForPageEditor,
  listChurchesForPageEditor,
  requireChurchPageEditor,
} from '@lib/churchPageAccess';
import { canPublishChurchPageForDirectory } from '@lib/churchManagement';

const MAX_BODY_CHARS = 48_000;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function pageFields(draft: ReturnType<typeof normalizeChurchPageDraft>): Record<string, unknown> {
  return {
    slug: draft.slug,
    template: draft.template,
    display_name: draft.display_name,
    tagline: draft.tagline || null,
    description: draft.description || null,
    hero_image_url: draft.hero_image_url || null,
    hero_image_alt: draft.hero_image_alt || null,
    pastor_name: draft.pastor_name || null,
    pastor_title: draft.pastor_title || null,
    pastor_image_url: draft.pastor_image_url || null,
    pastor_image_alt: draft.pastor_image_alt || null,
    service_schedule: draft.service_schedule || null,
    contact_whatsapp: draft.contact_whatsapp || null,
    contact_whatsapp_message: draft.contact_whatsapp_message || null,
    contact_email: draft.contact_email || null,
    story_config: draft.story_config,
    gallery: draft.gallery,
  };
}

function pageImageUrls(draft: ReturnType<typeof normalizeChurchPageDraft>): string[] {
  return Array.from(new Set([
    draft.hero_image_url,
    draft.pastor_image_url,
    ...draft.gallery.map((image) => image.url),
    ...draft.story_config.scenes.map((scene) => scene.image),
  ].filter((url) => url.startsWith('https://'))));
}

async function validateScopedImages(
  draft: ReturnType<typeof normalizeChurchPageDraft>,
  church: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const urls = pageImageUrls(draft);
  if (!urls.length) return { ok: true };
  const result = await supabaseAdmin!
    .from('cms_media')
    .select('public_url')
    .eq('folder', churchMediaFolder(church))
    .in('public_url', urls);
  if (isChurchPageSchemaMissingError(result.error) || result.error?.code === '42P01') {
    return { ok: false, status: 503, error: 'Falta activar la biblioteca de imágenes del portal.' };
  }
  if (result.error) {
    console.error('[church-pages] media scope validation failed', { code: result.error.code, message: result.error.message });
    return { ok: false, status: 500, error: 'No se pudieron validar las imágenes.' };
  }
  const registered = new Set((result.data || []).map((row: any) => String(row.public_url || '')));
  if (urls.some((url) => !registered.has(url))) {
    return { ok: false, status: 400, error: 'Selecciona imágenes de la biblioteca de esta iglesia.' };
  }
  return { ok: true };
}

async function audit(params: {
  churchId: string;
  pageId?: string | null;
  action: string;
  previous?: unknown;
  next?: unknown;
  actorUserId: string;
  actorEmail?: string | null;
  requestIp?: string | null;
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from('church_public_page_audit_logs').insert({
    church_id: params.churchId,
    page_id: params.pageId || null,
    action: params.action,
    previous_snapshot: params.previous || null,
    next_snapshot: params.next || null,
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail || null,
    request_ip: params.requestIp || null,
  });
  if (result.error && !isChurchPageSchemaMissingError(result.error)) {
    console.error('[church-pages] audit insert failed', { code: result.error.code, message: result.error.message });
  }
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const churches = await listChurchesForPageEditor(auth.access);
  const churchIds = churches.map((church) => church.id);
  if (!churchIds.length) {
    return json({ ok: true, schema_ready: true, churches: [], pages: [] });
  }

  const result = await supabaseAdmin
    .from('church_public_pages')
    .select('*')
    .in('church_id', churchIds)
    .order('updated_at', { ascending: false });

  if (isChurchPageSchemaMissingError(result.error)) {
    return json({
      ok: true,
      schema_ready: false,
      churches,
      pages: [],
      sql: 'docs/sql/church_public_pages.sql',
    });
  }
  if (result.error) {
    console.error('[church-pages] list failed', { code: result.error.code, message: result.error.message });
    return json({ ok: false, error: 'No se pudieron cargar las páginas de iglesias.' }, 500);
  }

  return json({ ok: true, schema_ready: true, churches, pages: result.data || [] });
};

export const PUT: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const allowed = await enforceRateLimit(`church-page-save:${auth.access.userId}`, 60, 30, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiados cambios seguidos. Espera un momento.' }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: 'La página supera el tamaño permitido.' }, 413);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ ok: false, error: 'La información enviada no es válida.' }, 400);
  }

  const churchId = String(body.church_id || '').trim();
  const expectedVersion = Number(body.expected_version || 0);
  if (!churchId) return json({ ok: false, error: 'Selecciona una iglesia.' }, 400);
  const church = await getChurchForPageEditor(churchId, auth.access);
  if (!church) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);

  const existingResult = await supabaseAdmin
    .from('church_public_pages')
    .select('*')
    .eq('church_id', churchId)
    .maybeSingle();
  if (isChurchPageSchemaMissingError(existingResult.error)) {
    return json({ ok: false, setup_required: true, error: 'Falta ejecutar docs/sql/church_public_pages.sql.' }, 503);
  }
  if (existingResult.error) return json({ ok: false, error: 'No se pudo validar la página actual.' }, 500);

  const baseline = existingResult.data || createChurchPageDraft(church as unknown as Record<string, unknown>);
  const draft = normalizeChurchPageDraft({ ...baseline, ...(body.page as Record<string, unknown> || {}) });
  if (!draft.slug || !draft.display_name) {
    return json({ ok: false, error: 'Completa el nombre y el enlace público.' }, 400);
  }
  const scopedImages = await validateScopedImages(draft, church as unknown as Record<string, unknown>);
  if (!scopedImages.ok) return json({ ok: false, error: scopedImages.error }, scopedImages.status);
  const now = new Date().toISOString();
  let saved: Record<string, unknown> | null = null;

  if (existingResult.data) {
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(existingResult.data.version)) {
      return json({ ok: false, conflict: true, error: 'La página cambió en otra sesión. Recarga antes de guardar.' }, 409);
    }
    const result = await supabaseAdmin
      .from('church_public_pages')
      .update({
        ...pageFields(draft),
        version: expectedVersion + 1,
        updated_by: auth.access.userId,
        updated_at: now,
      })
      .eq('id', existingResult.data.id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (!result.data && !result.error) {
      return json({ ok: false, conflict: true, error: 'La página cambió en otra sesión. Recarga antes de guardar.' }, 409);
    }
    if (result.error) {
      if (result.error.code === '23505') return json({ ok: false, error: 'Ese enlace público ya pertenece a otra iglesia.' }, 409);
      return json({ ok: false, error: 'No se pudo guardar la página.' }, 500);
    }
    saved = result.data as Record<string, unknown>;
  } else {
    const result = await supabaseAdmin
      .from('church_public_pages')
      .insert({
        church_id: churchId,
        ...pageFields(draft),
        status: 'DRAFT',
        version: 1,
        created_by: auth.access.userId,
        updated_by: auth.access.userId,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (result.error) {
      if (result.error.code === '23505') return json({ ok: false, error: 'Ese enlace público ya pertenece a otra iglesia.' }, 409);
      return json({ ok: false, error: 'No se pudo crear la página.' }, 500);
    }
    saved = result.data as Record<string, unknown>;
  }

  await audit({
    churchId,
    pageId: String(saved.id || ''),
    action: existingResult.data ? 'page.update' : 'page.create',
    previous: existingResult.data,
    next: saved,
    actorUserId: auth.access.userId,
    actorEmail: auth.access.email,
    requestIp: clientAddress,
  });
  return json({ ok: true, page: saved });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const allowed = await enforceRateLimit(`church-page-publish:${auth.access.userId}`, 60, 12, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Espera un momento antes de volver a publicar.' }, 429);

  const body = await request.json().catch(() => ({}));
  const churchId = String(body.church_id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const expectedVersion = Number(body.expected_version || 0);
  if (!churchId || !['publish', 'unpublish'].includes(action)) {
    return json({ ok: false, error: 'Selecciona la iglesia y una acción válida.' }, 400);
  }
  const church = await getChurchForPageEditor(churchId, auth.access);
  if (!church) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);
  if (action === 'publish' && !canPublishChurchPageForDirectory(church)) {
    return json({
      ok: false,
      error: 'Activa la iglesia y habilita su aparición en el directorio antes de publicar la página.',
    }, 409);
  }

  const current = await supabaseAdmin.from('church_public_pages').select('*').eq('church_id', churchId).maybeSingle();
  if (isChurchPageSchemaMissingError(current.error)) {
    return json({ ok: false, setup_required: true, error: 'Falta ejecutar docs/sql/church_public_pages.sql.' }, 503);
  }
  if (current.error || !current.data) return json({ ok: false, error: 'Guarda primero el borrador de la página.' }, 404);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(current.data.version)) {
    return json({ ok: false, conflict: true, error: 'La página cambió en otra sesión. Recarga antes de publicar.' }, 409);
  }

  const validation = validateChurchPageForPublish(current.data);
  if (action === 'publish' && !validation.ok) {
    return json({ ok: false, error: validation.errors[0], validation_errors: validation.errors }, 400);
  }
  const now = new Date().toISOString();
  const nextStatus = action === 'publish' ? 'PUBLISHED' : 'DRAFT';
  const snapshot = action === 'publish' ? pageFields(validation.draft) : current.data.published_snapshot;
  const updated = await supabaseAdmin
    .from('church_public_pages')
    .update({
      status: nextStatus,
      published_snapshot: snapshot,
      published_at: action === 'publish' ? now : null,
      published_by: action === 'publish' ? auth.access.userId : null,
      version: expectedVersion + 1,
      updated_by: auth.access.userId,
      updated_at: now,
    })
    .eq('id', current.data.id)
    .eq('version', expectedVersion)
    .select('*')
    .maybeSingle();
  if (!updated.data && !updated.error) {
    return json({ ok: false, conflict: true, error: 'La página cambió en otra sesión. Recarga antes de publicar.' }, 409);
  }
  if (updated.error) return json({ ok: false, error: 'No se pudo cambiar la publicación.' }, 500);

  await audit({
    churchId,
    pageId: current.data.id,
    action: action === 'publish' ? 'page.publish' : 'page.unpublish',
    previous: current.data,
    next: updated.data,
    actorUserId: auth.access.userId,
    actorEmail: auth.access.email,
    requestIp: clientAddress,
  });
  return json({ ok: true, page: updated.data });
};
