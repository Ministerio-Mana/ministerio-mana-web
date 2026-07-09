import type { APIRoute } from 'astro';
import { requireCmsAdmin, jsonResponse } from '@lib/cmsAdmin';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { isCmsSchemaMissingError } from '@lib/cms';

export const prerender = false;

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);

  const auth = await requireCmsAdmin({ request, clientAddress, identifier: 'portal.content.history.get' });
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error || 'No autorizado' }, auth.status);

  const url = new URL(request.url);
  const pageId = String(url.searchParams.get('page_id') || '').trim();
  const limitRaw = Number(url.searchParams.get('limit') || 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(120, Math.floor(limitRaw))) : 40;

  let revisionsQuery = supabaseAdmin
    .from('cms_revisions')
    .select('id, entity_type, entity_id, page_id, action, snapshot, created_by, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  let auditQuery = supabaseAdmin
    .from('cms_audit_logs')
    .select('id, action, entity_type, entity_id, page_id, meta, actor_user_id, actor_email, request_ip, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (pageId) {
    revisionsQuery = revisionsQuery.eq('page_id', pageId);
    auditQuery = auditQuery.eq('page_id', pageId);
  }

  const [{ data: revisions, error: revError }, { data: logs, error: logsError }] = await Promise.all([
    revisionsQuery,
    auditQuery,
  ]);

  if (isCmsSchemaMissingError(revError) || isCmsSchemaMissingError(logsError)) {
    return jsonResponse({ ok: true, revisions: [], logs: [], schemaReady: false });
  }
  if (revError || logsError) {
    return jsonResponse({ ok: false, error: 'No se pudo cargar historial' }, 500);
  }

  return jsonResponse({ ok: true, revisions: revisions ?? [], logs: logs ?? [], schemaReady: true });
};
