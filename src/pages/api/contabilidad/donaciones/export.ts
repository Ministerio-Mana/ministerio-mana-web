import type { APIContext } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function validateExport(request: Request): boolean {
  const secret = env('DONATIONS_EXPORT_SECRET');
  if (!secret) return !isProduction();
  const header = request.headers.get('x-export-secret');
  if (header && header === secret) return true;
  if (isProduction()) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && token === secret);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[,\n\r"]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function ilikeValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes('%') ? trimmed : `%${trimmed}%`;
}

export const GET = async ({ request, clientAddress }: APIContext) => {
  if (!validateExport(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'donations.export',
      detail: 'Export secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'donations.export',
    allowlistKeys: ['ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const provider = (url.searchParams.get('provider') ?? '').toLowerCase();
  const allowed = new Set(['wompi', 'stripe', 'physical']);
  if (!provider) {
    return new Response(JSON.stringify({ ok: false, error: 'provider requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!allowed.has(provider)) {
    return new Response(JSON.stringify({ ok: false, error: 'provider invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const country = ilikeValue(url.searchParams.get('country'));
  const city = ilikeValue(url.searchParams.get('city'));
  const church = ilikeValue(url.searchParams.get('church'));
  const campus = ilikeValue(url.searchParams.get('campus'));
  const email = ilikeValue(url.searchParams.get('email'));
  const name = ilikeValue(url.searchParams.get('name'));
  const currency = (url.searchParams.get('currency') ?? '').toUpperCase();
  const minAmountRaw = url.searchParams.get('minAmount');
  const maxAmountRaw = url.searchParams.get('maxAmount');
  const minAmount = minAmountRaw ? Number(minAmountRaw) : NaN;
  const maxAmount = maxAmountRaw ? Number(maxAmountRaw) : NaN;

  let query = supabaseAdmin
    .from('donations')
    .select('*')
    .eq('provider', provider)
    .eq('status', 'APPROVED');

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (country) query = query.ilike('donor_country', country);
  if (city) query = query.ilike('donor_city', city);
  if (church) query = query.ilike('church', church);
  if (campus) query = query.ilike('campus', campus);
  if (email) query = query.ilike('donor_email', email);
  if (name) query = query.ilike('donor_name', name);
  if (currency) query = query.eq('currency', currency);
  if (Number.isFinite(minAmount)) query = query.gte('amount', minAmount);
  if (Number.isFinite(maxAmount)) query = query.lte('amount', maxAmount);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('[donations.export] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo exportar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const headers = [
    'donation_id',
    'created_at',
    'provider',
    'status',
    'amount',
    'currency',
    'reference',
    'provider_tx_id',
    'payment_method',
    'payment_domain',
    'concept_code',
    'concept_label',
    'donation_type',
    'project_name',
    'event_name',
    'campus',
    'church',
    'church_city',
    'donor_name',
    'donor_email',
    'donor_phone',
    'donor_document_type',
    'donor_document_number',
    'donor_country',
    'donor_city',
    'is_recurring',
    'donation_description',
    'need_certificate',
    'source',
    'cumbre_booking_id',
  ];

  const rows = (data || []).map((row: any) => [
    csvEscape(row.id),
    csvEscape(row.created_at),
    csvEscape(row.provider),
    csvEscape(row.status),
    csvEscape(row.amount),
    csvEscape(row.currency),
    csvEscape(row.reference),
    csvEscape(row.provider_tx_id),
    csvEscape(row.payment_method),
    csvEscape(row.payment_domain),
    csvEscape(row.concept_code),
    csvEscape(row.concept_label),
    csvEscape(row.donation_type),
    csvEscape(row.project_name),
    csvEscape(row.event_name),
    csvEscape(row.campus),
    csvEscape(row.church),
    csvEscape(row.church_city),
    csvEscape(row.donor_name),
    csvEscape(row.donor_email),
    csvEscape(row.donor_phone),
    csvEscape(row.donor_document_type),
    csvEscape(row.donor_document_number),
    csvEscape(row.donor_country),
    csvEscape(row.donor_city),
    csvEscape(row.is_recurring),
    csvEscape(row.donation_description),
    csvEscape(row.need_certificate),
    csvEscape(row.source),
    csvEscape(row.cumbre_booking_id),
  ]);

  const csv = [headers.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="donaciones-${provider}.csv"`,
    },
  });
};
