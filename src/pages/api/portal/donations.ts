import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

const APPROVED_STATUSES = ['PAID', 'APPROVED'];
const ISSUE_STATUSES = ['PENDING', 'FAILED'];

function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

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

  const user = await getUserFromRequest(request);
  const passwordSession = user ? null : readPasswordSession(request);
  if (!user && !passwordSession) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  let role = 'superadmin';
  if (user) {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    role = profile?.role || 'user';
  }

  if (!isAdminRole(role)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'all').toUpperCase();
  const domain = String(url.searchParams.get('domain') || '').toUpperCase();
  const limitRaw = Number(url.searchParams.get('limit') || 250);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 250;

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
  ].join(', ');

  const fallbackFields = selectFields
    .replace(', payment_domain', '')
    .replace(', concept_code', '')
    .replace(', concept_label', '')
    .replace(', missionary_name', '');

  const buildQuery = (fields: string) => {
    let query = supabaseAdmin
      .from('donations')
      .select(fields)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status === 'APPROVED') query = query.in('status', APPROVED_STATUSES);
    if (status === 'ISSUES') query = query.in('status', ISSUE_STATUSES);
    if (['PENDING', 'FAILED', 'PAID'].includes(status)) query = query.eq('status', status);
    if (domain) query = query.eq('payment_domain', domain);
    return query;
  };

  let result = await buildQuery(selectFields);
  if (result.error && isMissingColumnError(result.error)) {
    let fallbackQuery = supabaseAdmin
      .from('donations')
      .select(fallbackFields)
      .order('created_at', { ascending: false })
      .limit(limit);

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
  const totalsByCurrency: Record<string, number> = {};
  const totalsByConcept: Record<string, { count: number; byCurrency: Record<string, number> }> = {};

  donations.forEach((donation) => {
    const currency = String(donation.currency || 'COP').toUpperCase();
    const amount = Number(donation.amount || 0);
    const concept = donation.concept_label || 'Otros';
    if (APPROVED_STATUSES.includes(String(donation.status || '').toUpperCase())) {
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
      if (!totalsByConcept[concept]) totalsByConcept[concept] = { count: 0, byCurrency: {} };
      totalsByConcept[concept].count += 1;
      totalsByConcept[concept].byCurrency[currency] = (totalsByConcept[concept].byCurrency[currency] || 0) + amount;
    }
  });

  return new Response(JSON.stringify({
    ok: true,
    donations,
    stats: {
      totalRows: donations.length,
      totalsByCurrency,
      totalsByConcept,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
