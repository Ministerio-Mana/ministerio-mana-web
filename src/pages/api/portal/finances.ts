import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { applyFinanceScopeFilter, getFinanceAccessContext } from '@lib/financeAccess';
import { serializeFinanceScopeAccess } from '@lib/financeScope';

export const prerender = false;

const APPROVED_STATUSES = ['PAID', 'APPROVED'];
const ISSUE_STATUSES = ['PENDING', 'FAILED'];
const CATEGORY_ORDER = ['Diezmos', 'Ofrendas', 'Misiones', 'Campus', 'Eventos', 'Peregrinaciones', 'General', 'Otros'];
const CATEGORY_SET = new Set(CATEGORY_ORDER);
const TYPE_MAP: Record<string, string> = {
  diezmos: 'Diezmos',
  ofrendas: 'Ofrendas',
  misiones: 'Misiones',
  campus: 'Campus',
  evento: 'Eventos',
  peregrinaciones: 'Peregrinaciones',
  general: 'General',
};

const TRANSACTION_FIELDS = [
  'id',
  'amount',
  'currency',
  'status',
  'concept_label',
  'concept_code',
  'donation_type',
  'created_at',
  'donor_name',
  'donor_email',
  'donor_phone',
  'provider',
  'reference',
  'church_id',
  'finance_scope_type',
  'finance_scope_country_key',
  'finance_region_id',
].join(', ');

const TRANSACTION_FALLBACK_FIELDS = [
  'id',
  'amount',
  'currency',
  'status',
  'donation_type',
  'created_at',
  'donor_name',
  'donor_email',
  'donor_phone',
  'provider',
  'reference',
  'church_id',
].join(', ');

const ISSUE_FIELDS = `${TRANSACTION_FIELDS}, raw_event`;
const ISSUE_FALLBACK_FIELDS = `${TRANSACTION_FALLBACK_FIELDS}, raw_event`;

function json(payload: any, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
    },
  });
}

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function resolveCategory(row: any): string {
  const conceptLabel = String(row?.concept_label || '').trim();
  if (conceptLabel && CATEGORY_SET.has(conceptLabel)) return conceptLabel;

  const conceptCode = String(row?.concept_code || '').trim().toUpperCase();
  if (conceptCode === 'TITHE') return 'Diezmos';
  if (conceptCode === 'OFFERING') return 'Ofrendas';
  if (conceptCode === 'MISSIONS') return 'Misiones';
  if (conceptCode === 'CAMPUS') return 'Campus';
  if (conceptCode === 'EVENT') return 'Eventos';
  if (conceptCode === 'PILGRIMAGE') return 'Peregrinaciones';
  if (conceptCode === 'GENERAL') return 'General';

  const donationType = String(row?.donation_type || '').trim().toLowerCase();
  return TYPE_MAP[donationType] || 'Otros';
}

function extractReason(raw: any, status: string): string {
  const candidates = [
    raw?.error?.message,
    raw?.error?.reason,
    raw?.error?.code,
    raw?.status_message,
    raw?.message,
    raw?.failure_message,
    raw?.data?.transaction?.status_message,
    raw?.data?.transaction?.error?.message,
    raw?.data?.transaction?.error?.reason,
    raw?.last_payment_error?.message,
    raw?.last_payment_error?.code,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim().length);
  if (found) return found.trim();
  return status === 'PENDING' ? 'En verificación' : 'Pago no confirmado';
}

function toClientRow(row: any) {
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    concept_label: resolveCategory(row),
    donation_type: row.donation_type ?? null,
    created_at: row.created_at,
    donor_name: row.donor_name ?? null,
    donor_email: row.donor_email ?? null,
    donor_phone: row.donor_phone ?? null,
    provider: row.provider ?? null,
    reference: row.reference ?? null,
    church_id: row.church_id ?? null,
  };
}

function makePagination(count: number | null | undefined, rowCount: number, page: number, pageSize: number) {
  const totalRows = Number(count ?? rowCount);
  const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 0;
  const visibleFrom = rowCount ? ((page - 1) * pageSize) + 1 : 0;
  const visibleTo = rowCount ? ((page - 1) * pageSize) + rowCount : 0;
  return {
    page,
    pageSize,
    totalRows,
    totalPages,
    visibleFrom,
    visibleTo,
    hasNextPage: page < totalPages,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const startedAt = Date.now();
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const db = supabaseAdmin;

  const financeContext = await getFinanceAccessContext(request);
  if (!financeContext.ok) return json({ ok: false, error: financeContext.error }, financeContext.status);

  const url = new URL(request.url);
  const page = parseBoundedInt(url.searchParams.get('page') || url.searchParams.get('transactionsPage'), 1, 1, 10000);
  const pageSize = parseBoundedInt(url.searchParams.get('pageSize') || url.searchParams.get('transactionsPageSize'), 50, 1, 100);
  const issuesPage = parseBoundedInt(url.searchParams.get('issuesPage'), 1, 1, 10000);
  const issuesPageSize = parseBoundedInt(url.searchParams.get('issuesPageSize'), 20, 1, 50);
  const includeTransactions = url.searchParams.get('includeTransactions') !== 'false';
  const includeIssues = url.searchParams.get('includeIssues') !== 'false';

  const buildQuery = (fields: string, statuses: string[], currentPage: number, currentPageSize: number) => {
    const rangeFrom = (currentPage - 1) * currentPageSize;
    const rangeTo = rangeFrom + currentPageSize - 1;
    let query = db
      .from('donations')
      .select(fields, { count: 'exact' });
    query = applyFinanceScopeFilter(query, financeContext.access);
    return query
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);
  };

  let [approvedResult, issuesResult] = await Promise.all([
    includeTransactions
      ? buildQuery(TRANSACTION_FIELDS, APPROVED_STATUSES, page, pageSize)
      : Promise.resolve({ data: [], error: null, count: 0 }),
    includeIssues
      ? buildQuery(ISSUE_FIELDS, ISSUE_STATUSES, issuesPage, issuesPageSize)
      : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);

  if (approvedResult.error && isMissingColumnError(approvedResult.error)) {
    if (!financeContext.access.isGlobal) {
      return json({
        ok: false,
        error: 'La separación financiera todavía no está activa. Ejecuta la migración de alcances financieros.',
      }, 503);
    }
    approvedResult = await buildQuery(TRANSACTION_FALLBACK_FIELDS, APPROVED_STATUSES, page, pageSize);
  }

  if (issuesResult.error && isMissingColumnError(issuesResult.error)) {
    if (!financeContext.access.isGlobal) {
      return json({
        ok: false,
        error: 'La separación financiera todavía no está activa. Ejecuta la migración de alcances financieros.',
      }, 503);
    }
    issuesResult = await buildQuery(ISSUE_FALLBACK_FIELDS, ISSUE_STATUSES, issuesPage, issuesPageSize);
  }

  if (approvedResult.error) {
    console.error('[portal.finances] approved query failed', {
      elapsedMs: Date.now() - startedAt,
      message: approvedResult.error?.message || String(approvedResult.error),
      code: approvedResult.error?.code,
    });
    return json({ ok: false, error: 'Error loading finances' }, 500);
  }

  if (issuesResult.error) {
    console.error('[portal.finances] issues query failed', {
      elapsedMs: Date.now() - startedAt,
      message: issuesResult.error?.message || String(issuesResult.error),
      code: issuesResult.error?.code,
    });
  }

  const approvedTransactions = (approvedResult.data || []).map((row: any) => toClientRow(row));
  const issues = issuesResult.error
    ? []
    : (issuesResult.data || []).map((row: any) => ({
      ...toClientRow(row),
      reason: extractReason(row.raw_event, row.status),
    }));

  const totalByCurrency: Record<string, number> = {};
  const byCategory: Record<string, { total: number; byCurrency: Record<string, number> }> = {};
  CATEGORY_ORDER.forEach((label) => { byCategory[label] = { total: 0, byCurrency: {} }; });

  approvedTransactions.forEach((transaction: any) => {
    const amount = Number(transaction.amount) || 0;
    const label = transaction.concept_label || 'Otros';
    const currency = String(transaction.currency || 'COP').toUpperCase();

    totalByCurrency[currency] = (totalByCurrency[currency] || 0) + amount;
    if (!byCategory[label]) byCategory[label] = { total: 0, byCurrency: {} };
    byCategory[label].total += amount;
    byCategory[label].byCurrency[currency] = (byCategory[label].byCurrency[currency] || 0) + amount;
  });

  const transactionsPagination = makePagination(approvedResult.count, approvedTransactions.length, page, pageSize);
  const issuesPagination = makePagination(
    issuesResult.error ? 0 : issuesResult.count,
    issues.length,
    issuesPage,
    issuesPageSize,
  );

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 2500) {
    console.warn('[portal.finances] slow response', {
      elapsedMs,
      transactionCount: approvedTransactions.length,
      issueCount: issues.length,
      role: financeContext.role,
    });
  }

  return json({
    ok: true,
    stats: {
      totalByCurrency,
      byCategory,
      scope: 'loaded-page',
      loadedRows: approvedTransactions.length,
      totalRows: transactionsPagination.totalRows,
    },
    transactions: approvedTransactions,
    issues,
    pagination: transactionsPagination,
    transactionsPagination,
    issuesPagination,
    financeScope: serializeFinanceScopeAccess(financeContext.access),
  });
};
