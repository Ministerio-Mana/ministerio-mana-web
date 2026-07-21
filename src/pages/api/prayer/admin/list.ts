import type { APIRoute } from 'astro';
import { enforcePortalPrayerGuard, canReviewPrayerModeration } from '@lib/portalPrayerGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}

function cleanFilter(value: string | null, allowed: string[]): string {
  const normalized = String(value || 'all').toLowerCase();
  return allowed.includes(normalized) ? normalized : 'all';
}

function cleanInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status|flagged/i.test(message)
  );
}

function isMissingPrayerAiColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') &&
    /ai_(?:consent|status|recommendation|reason|model|policy|reviewed|urgent|error)/i.test(message)
  );
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  const db = supabaseAdmin;
  if (!db) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalPrayerGuard({
    request,
    clientAddress,
    identifier: 'prayer.admin.list',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const url = new URL(request.url);
  const status = cleanFilter(url.searchParams.get('status'), ['all', 'pending', 'flagged', 'approved', 'rejected', 'private']);
  const visibility = cleanFilter(url.searchParams.get('visibility'), ['all', 'private', 'public']);
  const page = cleanInteger(url.searchParams.get('page'), 1, 1, 10000);
  const pageSize = cleanInteger(url.searchParams.get('pageSize'), 50, 10, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const canReview = canReviewPrayerModeration(guard.role);
  const baseFields = canReview
    ? 'id,first_name,request_text,city,country,visibility,moderation_status,admin_note,created_at'
    : 'id,first_name,request_text,city,country,visibility,moderation_status,created_at';
  const aiAuditFields = 'ai_consent,ai_status,ai_recommendation,ai_reason_codes,ai_model,ai_policy_version,ai_reviewed_at,ai_urgent_pastoral_review,ai_error_code';
  const fields = canReview ? `${baseFields},${aiAuditFields}` : baseFields;

  const buildRowsQuery = (selectedFields: string) => {
    let rowsQuery = db
      .from('prayer_requests')
      .select(selectedFields, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (status !== 'all') rowsQuery = rowsQuery.eq('moderation_status', status);
    if (visibility !== 'all') rowsQuery = rowsQuery.eq('visibility', visibility);
    return rowsQuery;
  };

  let [rowsResult, totalResult, privateResult, reviewResult] = await Promise.all([
    buildRowsQuery(fields),
    db
      .from('prayer_requests')
      .select('id', { count: 'exact', head: true }),
    db
      .from('prayer_requests')
      .select('id', { count: 'exact', head: true })
      .eq('visibility', 'private'),
    db
      .from('prayer_requests')
      .select('id', { count: 'exact', head: true })
      .eq('visibility', 'public')
      .in('moderation_status', ['pending', 'flagged']),
  ]);

  if (rowsResult.error && canReview && isMissingPrayerAiColumn(rowsResult.error)) {
    rowsResult = await buildRowsQuery(baseFields);
  }

  const queryError = rowsResult.error || totalResult.error || privateResult.error || reviewResult.error;
  if (queryError) {
    if (isMissingModerationColumn(queryError)) {
      return json({ ok: false, error: 'Faltan columnas de moderación. Ejecuta la sección Prayer Wall de SCHEMA.sql.' }, 400);
    }
    return json({ ok: false, error: 'No se pudieron cargar peticiones' }, 500);
  }

  const totalRows = Number(rowsResult.count || 0);
  const visibleTo = Math.min(from + (rowsResult.data?.length || 0), totalRows);

  return json({
    ok: true,
    rows: rowsResult.data ?? [],
    role: guard.role,
    permissions: {
      canReview,
    },
    stats: {
      total: Number(totalResult.count || 0),
      private: Number(privateResult.count || 0),
      review: Number(reviewResult.count || 0),
    },
    pagination: {
      page,
      pageSize,
      totalRows,
      visibleFrom: totalRows ? from + 1 : 0,
      visibleTo,
      hasNextPage: visibleTo < totalRows,
    },
  });
};
