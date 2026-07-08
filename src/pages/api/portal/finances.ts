import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const GET: APIRoute = async ({ request }) => {
    const startedAt = Date.now();
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    // Get Profile
    const { data: profile } = user
        ? await supabaseAdmin
            .from('user_profiles')
            .select('church_id, role')
            .eq('user_id', user.id)
            .single()
        : { data: { role: 'superadmin', church_id: null } };

    if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const APPROVED_STATUSES = ['PAID', 'APPROVED'];
    const ISSUE_STATUSES = ['PENDING', 'FAILED'];
    const categoryOrder = ['Diezmos', 'Ofrendas', 'Misiones', 'Campus', 'Eventos', 'Peregrinaciones', 'General', 'Otros'];
    const categorySet = new Set(categoryOrder);
    const typeMap: Record<string, string> = {
        diezmos: 'Diezmos',
        ofrendas: 'Ofrendas',
        misiones: 'Misiones',
        campus: 'Campus',
        evento: 'Eventos',
        peregrinaciones: 'Peregrinaciones',
        general: 'General',
    };

    const resolveCategory = (row: any): string => {
        const conceptLabel = (row?.concept_label || '').toString().trim();
        if (conceptLabel && categorySet.has(conceptLabel)) return conceptLabel;
        const conceptCode = (row?.concept_code || '').toString().trim().toUpperCase();
        if (conceptCode === 'TITHE') return 'Diezmos';
        if (conceptCode === 'OFFERING') return 'Ofrendas';
        if (conceptCode === 'MISSIONS') return 'Misiones';
        if (conceptCode === 'CAMPUS') return 'Campus';
        if (conceptCode === 'EVENT') return 'Eventos';
        if (conceptCode === 'PILGRIMAGE') return 'Peregrinaciones';
        if (conceptCode === 'GENERAL') return 'General';
        const donationType = (row?.donation_type || '').toString().trim().toLowerCase();
        return typeMap[donationType] || 'Otros';
    };

    const extractReason = (raw: any, status: string): string => {
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
    };

    const selectFields = 'id, amount, currency, status, concept_label, concept_code, donation_type, created_at, donor_name, donor_email, donor_phone, provider, reference, raw_event, church_id';
    const fallbackFields = 'id, amount, currency, status, donation_type, created_at, donor_name, donor_email, donor_phone, provider, reference, raw_event, church_id';

    const buildQuery = (fields: string) => {
        let query = supabaseAdmin
            .from('donations')
            .select(fields)
            .order('created_at', { ascending: false });

        return query;
    };

    let approvedQuery = buildQuery(selectFields);
    if (!approvedQuery) {
        return new Response(JSON.stringify({ ok: true, stats: { total: 0, byCategory: {} }, transactions: [], issues: [] }), { status: 200 });
    }
    approvedQuery = approvedQuery.in('status', APPROVED_STATUSES).limit(120);

    let issuesQuery = buildQuery(selectFields);
    issuesQuery = issuesQuery ? issuesQuery.in('status', ISSUE_STATUSES).limit(120) : null;

    let approvedResult = await approvedQuery;
    let issuesResult = issuesQuery ? await issuesQuery : { data: [], error: null };

    if (approvedResult.error && approvedResult.error.code === '42703') {
        const fallbackQuery = buildQuery(fallbackFields);
        if (!fallbackQuery) {
            return new Response(JSON.stringify({ ok: true, stats: { total: 0, byCategory: {} }, transactions: [], issues: [] }), { status: 200 });
        }
        approvedResult = await fallbackQuery.in('status', APPROVED_STATUSES).limit(120);
    }

    if (issuesResult?.error && issuesResult.error.code === '42703') {
        const fallbackQuery = buildQuery(fallbackFields);
        issuesResult = fallbackQuery
            ? await fallbackQuery.in('status', ISSUE_STATUSES).limit(120)
            : { data: [], error: null };
    }

    if (approvedResult.error) {
        console.error('[portal.finances] approved query failed', {
            elapsedMs: Date.now() - startedAt,
            message: approvedResult.error?.message || String(approvedResult.error),
            code: approvedResult.error?.code,
        });
        return new Response(JSON.stringify({ ok: false, error: 'Error loading finances' }), { status: 500 });
    }

    if (issuesResult?.error) {
        console.error('[portal.finances] issues query failed', {
            elapsedMs: Date.now() - startedAt,
            message: issuesResult.error?.message || String(issuesResult.error),
            code: issuesResult.error?.code,
        });
    }

    const toClientRow = (row: any) => ({
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
    });

    const approvedTransactions = (approvedResult.data || []).map((row: any) => toClientRow(row));

    const issues = (issuesResult?.data || []).map((row: any) => ({
        ...toClientRow(row),
        reason: extractReason(row.raw_event, row.status),
    }));

    const totalByCurrency: Record<string, number> = {};
    const byCategory: Record<string, { total: number; byCurrency: Record<string, number> }> = {};
    categoryOrder.forEach((label) => { byCategory[label] = { total: 0, byCurrency: {} }; });

    approvedTransactions.forEach((t: any) => {
        const amount = Number(t.amount) || 0;
        const label = t.concept_label || 'Otros';
        const currency = (t.currency || 'COP').toUpperCase();

        totalByCurrency[currency] = (totalByCurrency[currency] || 0) + amount;
        if (!byCategory[label]) byCategory[label] = { total: 0, byCurrency: {} };
        byCategory[label].total += amount;
        byCategory[label].byCurrency[currency] = (byCategory[label].byCurrency[currency] || 0) + amount;
    });

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 2500) {
        console.warn('[portal.finances] slow response', {
            elapsedMs,
            transactionCount: approvedTransactions.length,
            issueCount: issues.length,
            role: profile?.role,
        });
    }

    return new Response(JSON.stringify({ ok: true, stats: { totalByCurrency, byCategory }, transactions: approvedTransactions, issues }), { status: 200 });
};
