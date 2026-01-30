import type { APIContext } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateExport(request: Request): boolean {
  const secret = env('DONATIONS_EXPORT_SECRET');
  if (!secret) return true;
  const header = request.headers.get('x-export-secret');
  if (header && header === secret) return true;
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

export const GET = async ({ request }: APIContext) => {
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

  const provider = (new URL(request.url).searchParams.get('provider') ?? '').toLowerCase();
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

  const { data, error } = await supabaseAdmin
    .from('donations')
    .select('*')
    .eq('provider', provider)
    .order('created_at', { ascending: false });

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
