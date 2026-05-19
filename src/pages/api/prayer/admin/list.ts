import type { APIRoute } from 'astro';
import { enforcePortalPrayerGuard, canReviewPrayerModeration } from '@lib/portalPrayerGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function cleanFilter(value: string | null, allowed: string[]): string {
  const normalized = String(value || 'all').toLowerCase();
  return allowed.includes(normalized) ? normalized : 'all';
}

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status|flagged/i.test(message)
  );
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalPrayerGuard({
    request,
    clientAddress,
    identifier: 'prayer.admin.list',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const url = new URL(request.url);
  const status = cleanFilter(url.searchParams.get('status'), ['all', 'pending', 'flagged', 'approved', 'rejected', 'private']);
  const visibility = cleanFilter(url.searchParams.get('visibility'), ['all', 'private', 'public']);

  let query = supabaseAdmin
    .from('prayer_requests')
    .select('id,first_name,request_text,city,country,prayers_count,visibility,moderation_status,flagged,approved,reviewed_by,reviewed_at,admin_note,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(250);

  if (status !== 'all') query = query.eq('moderation_status', status);
  if (visibility !== 'all') query = query.eq('visibility', visibility);

  const { data, error } = await query;
  if (error) {
    if (isMissingModerationColumn(error)) {
      return json({ ok: false, error: 'Faltan columnas de moderación. Ejecuta la sección Prayer Wall de SCHEMA.sql.' }, 400);
    }
    return json({ ok: false, error: 'No se pudieron cargar peticiones' }, 500);
  }

  return json({
    ok: true,
    rows: data ?? [],
    role: guard.role,
    permissions: {
      canReview: canReviewPrayerModeration(guard.role),
    },
  });
};
