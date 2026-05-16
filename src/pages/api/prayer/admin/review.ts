import type { APIRoute } from 'astro';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sanitizePlainText } from '@lib/validation';

export const prerender = false;

type ReviewDecision = 'approve' | 'reject' | 'keep_private';

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function normalizeDecision(value: unknown): ReviewDecision | null {
  const decision = String(value || '').toLowerCase();
  if (decision === 'approve' || decision === 'reject' || decision === 'keep_private') return decision;
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status|flagged/i.test(message)
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'prayer.admin.review',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const body = await request.json().catch(() => null);
  const id = String(body?.id || '').trim();
  const decision = normalizeDecision(body?.decision);
  const adminNote = sanitizePlainText(body?.adminNote || body?.admin_note || '', 320);

  if (!isUuid(id)) return json({ ok: false, error: 'id inválido' }, 400);
  if (!decision) return json({ ok: false, error: 'decision inválida' }, 400);

  const current = await supabaseAdmin
    .from('prayer_requests')
    .select('id,visibility,moderation_status')
    .eq('id', id)
    .maybeSingle();

  if (current.error) {
    if (isMissingModerationColumn(current.error)) {
      return json({ ok: false, error: 'Faltan columnas de moderación. Ejecuta la sección Prayer Wall de SCHEMA.sql.' }, 400);
    }
    return json({ ok: false, error: 'No se pudo cargar la petición' }, 500);
  }
  if (!current.data) return json({ ok: false, error: 'Petición no encontrada' }, 404);

  if (decision === 'approve' && current.data.visibility !== 'public') {
    return json({ ok: false, error: 'Una petición privada no se puede publicar sin cambiar su privacidad.' }, 400);
  }

  const updates: Record<string, any> = {
    reviewed_at: new Date().toISOString(),
    reviewed_by: guard.email || guard.userId,
    updated_at: new Date().toISOString(),
  };
  if (adminNote) updates.admin_note = adminNote;

  if (decision === 'approve') {
    updates.approved = true;
    updates.moderation_status = 'approved';
    updates.flagged = false;
  }

  if (decision === 'reject') {
    updates.approved = false;
    updates.moderation_status = 'rejected';
  }

  if (decision === 'keep_private') {
    updates.approved = false;
    updates.visibility = 'private';
    updates.moderation_status = 'private';
  }

  const { data, error } = await supabaseAdmin
    .from('prayer_requests')
    .update(updates)
    .eq('id', id)
    .select('id,first_name,request_text,city,country,prayers_count,visibility,moderation_status,flagged,approved,reviewed_by,reviewed_at,admin_note,created_at,updated_at')
    .single();

  if (error) return json({ ok: false, error: 'No se pudo revisar la petición' }, 500);

  return json({ ok: true, row: data });
};
