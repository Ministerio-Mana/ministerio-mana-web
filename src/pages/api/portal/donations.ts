import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { applyFinanceScopeFilter, getFinanceAccessContext } from '@lib/financeAccess';
import { serializeFinanceScopeAccess } from '@lib/financeScope';

export const prerender = false;

const APPROVED_STATUSES = ['PAID', 'APPROVED'];
const ISSUE_STATUSES = ['PENDING', 'FAILED'];

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function resolveConcept(row: any): string {
  const label = String(row?.concept_label || '').trim();
  if (label) return label;
  const code = String(row?.concept_code || '').trim().toUpperCase();
  if (code === 'TITHE') return 'Diezmos';
  if (code === 'OFFERING') return 'Ofrendas';
  if (code === 'MISSIONS') return 'Misiones';
  if (code === 'CAMPUS') return 'Campus';
  if (code === 'EVENT') return 'Eventos';
  if (code === 'PILGRIMAGE') return 'Peregrinaciones';
  if (code === 'GENERAL') return 'General';

  const type = String(row?.donation_type || '').trim().toLowerCase();
  const map: Record<string, string> = {
    diezmos: 'Diezmos',
    ofrendas: 'Ofrendas',
    misiones: 'Misiones',
    campus: 'Campus',
    evento: 'Eventos',
    peregrinaciones: 'Peregrinaciones',
    primicias: 'Ofrendas',
    general: 'General',
  };
  return map[type] || 'Otros';
}

function resolveDestination(row: any): string {
  const concept = resolveConcept(row);
  const missionary = String(row?.missionary_name || '').trim();
  if (concept === 'Campus' && missionary) return `Campus - ${missionary}`;
  if (concept === 'Campus') return row?.campus || 'Campus';
  if (row?.event_name) return String(row.event_name);
  if (row?.project_name) return String(row.project_name);
  if (row?.church) return String(row.church);
  if (row?.campus) return String(row.campus);
  return concept;
}

function toClientRow(row: any) {
  return {
    id: row.id,
    created_at: row.created_at,
    provider: row.provider,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    reference: row.reference,
    payment_method: row.payment_method,
    payment_domain: row.payment_domain ?? null,
    concept_code: row.concept_code ?? null,
    concept_label: resolveConcept(row),
    destination: resolveDestination(row),
    donation_type: row.donation_type ?? null,
    project_name: row.project_name ?? null,
    event_name: row.event_name ?? null,
    campus: row.campus ?? null,
    missionary_name: row.missionary_name ?? null,
    church: row.church ?? null,
    donor_name: row.donor_name ?? null,
    donor_email: row.donor_email ?? null,
    donor_phone: row.donor_phone ?? null,
    donor_country: row.donor_country ?? null,
    donor_city: row.donor_city ?? null,
    is_recurring: row.is_recurring ?? null,
    source: row.source ?? null,
  };
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
  }
  const db = supabaseAdmin;

  const financeContext = await getFinanceAccessContext(request);
  if (!financeContext.ok) {
    return new Response(JSON.stringify({ ok: false, error: financeContext.error }), {
      status: financeContext.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'all').toUpperCase();
  const domain = String(url.searchParams.get('domain') || '').toUpperCase();
  const pageRaw = Number(url.searchParams.get('page') || 1);
  const pageSizeRaw = Number(url.searchParams.get('pageSize') || url.searchParams.get('limit') || 50);
  const page = Number.isFinite(pageRaw) ? Math.max(Math.floor(pageRaw), 1) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(Math.floor(pageSizeRaw), 1), 100) : 50;
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  const selectFields = [
    'id',
    'created_at',
    'provider',
    'status',
    'amount',
    'currency',
    'reference',
    'payment_method',
    'payment_domain',
    'concept_code',
    'concept_label',
    'donation_type',
    'project_name',
    'event_name',
    'campus',
    'missionary_name',
    'church',
    'donor_name',
    'donor_email',
    'donor_phone',
    'donor_country',
    'donor_city',
    'is_recurring',
    'source',
    'church_id',
    'finance_scope_type',
    'finance_scope_country_key',
    'finance_region_id',
  ].join(', ');

  const fallbackFields = selectFields
    .replace(', payment_domain', '')
    .replace(', concept_code', '')
    .replace(', concept_label', '')
    .replace(', missionary_name', '')
    .replace(', finance_scope_type', '')
    .replace(', finance_scope_country_key', '')
    .replace(', finance_region_id', '');

  const buildQuery = (fields: string) => {
    let query = db
      .from('donations')
      .select(fields, { count: 'exact' });
    query = applyFinanceScopeFilter(query, financeContext.access);
    query = query
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (status === 'APPROVED') query = query.in('status', APPROVED_STATUSES);
    if (status === 'ISSUES') query = query.in('status', ISSUE_STATUSES);
    if (['PENDING', 'FAILED', 'PAID'].includes(status)) query = query.eq('status', status);
    if (domain) query = query.eq('payment_domain', domain);
    return query;
  };

  let result = await buildQuery(selectFields);
  if (result.error && isMissingColumnError(result.error)) {
    if (!financeContext.access.isGlobal) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'La separación financiera todavía no está activa. Ejecuta la migración de alcances financieros.',
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    let fallbackQuery = db
      .from('donations')
      .select(fallbackFields, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (status === 'APPROVED') fallbackQuery = fallbackQuery.in('status', APPROVED_STATUSES);
    if (status === 'ISSUES') fallbackQuery = fallbackQuery.in('status', ISSUE_STATUSES);
    if (['PENDING', 'FAILED', 'PAID'].includes(status)) fallbackQuery = fallbackQuery.eq('status', status);
    result = await fallbackQuery;
  }

  if (result.error) {
    console.error('[portal.donations] error', result.error);
    return new Response(JSON.stringify({ ok: false, error: 'Error loading donations' }), { status: 500 });
  }

  const donations = (result.data || []).map(toClientRow);
  const pageTotalsByCurrency: Record<string, number> = {};
  const pageTotalsByConcept: Record<string, { count: number; byCurrency: Record<string, number> }> = {};

  donations.forEach((donation) => {
    const currency = String(donation.currency || 'COP').toUpperCase();
    const amount = Number(donation.amount || 0);
    const concept = donation.concept_label || 'Otros';
    if (APPROVED_STATUSES.includes(String(donation.status || '').toUpperCase())) {
      pageTotalsByCurrency[currency] = (pageTotalsByCurrency[currency] || 0) + amount;
      if (!pageTotalsByConcept[concept]) pageTotalsByConcept[concept] = { count: 0, byCurrency: {} };
      pageTotalsByConcept[concept].count += 1;
      pageTotalsByConcept[concept].byCurrency[currency] = (pageTotalsByConcept[concept].byCurrency[currency] || 0) + amount;
    }
  });

  const totalRows = Number(result.count ?? donations.length);
  const totalPages = totalRows > 0 ? Math.ceil(totalRows / pageSize) : 0;
  const visibleFrom = donations.length ? rangeFrom + 1 : 0;
  const visibleTo = donations.length ? rangeFrom + donations.length : 0;

  return new Response(JSON.stringify({
    ok: true,
    donations,
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages,
      visibleFrom,
      visibleTo,
      hasNextPage: page < totalPages,
    },
    stats: {
      totalRows,
      loadedRows: donations.length,
      totalsByCurrency: pageTotalsByCurrency,
      totalsByConcept: pageTotalsByConcept,
      pageTotalsByCurrency,
      pageTotalsByConcept,
    },
    financeScope: serializeFinanceScopeAccess(financeContext.access),
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
    },
  });
};
