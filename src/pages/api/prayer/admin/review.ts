import type { APIRoute } from 'astro';
import { enforcePortalPrayerGuard, canReviewPrayerModeration } from '@lib/portalPrayerGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sanitizePlainText } from '@lib/validation';

export const prerender = false;

type ReviewDecision = 'approve' | 'reject' | 'keep_private';

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}

function normalizeDecision(value: unknown): ReviewDecision | null {
  const decision = String(value || '').toLowerCase();
  if (decision === 'approve' || decision === 'reject' || decision === 'keep_private') return decision;
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

  const guard = await enforcePortalPrayerGuard({
    request,
    clientAddress,
    identifier: 'prayer.admin.review',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);
  if (!canReviewPrayerModeration(guard.role)) {
    return json({ ok: false, error: 'No tienes permisos para revisar peticiones públicas' }, 403);
  }

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

  if (current.data.visibility !== 'public') {
    return json({ ok: false, error: 'Las peticiones privadas son solo para intercesión.' }, 400);
  }
  if (!['pending', 'flagged'].includes(String(current.data.moderation_status || ''))) {
    return json({ ok: false, error: 'Esta petición ya fue revisada.' }, 409);
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
    .eq('visibility', 'public')
    .in('moderation_status', ['pending', 'flagged'])
    .select('id,visibility,moderation_status,flagged,approved,admin_note,updated_at')
    .maybeSingle();

  if (error) return json({ ok: false, error: 'No se pudo revisar la petición' }, 500);
  if (!data) return json({ ok: false, error: 'La petición cambió mientras la revisabas. Actualiza la bandeja.' }, 409);

  return json({ ok: true, row: data });
};
