import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateExport(request: Request): boolean {
  const secret = env('CUMBRE_EXPORT_SECRET');
  if (!secret) return false;
  const header = request.headers.get('x-export-secret');
  if (header && header === secret) return true;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && token === secret);
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const GET: APIRoute = async ({ request }) => {
  if (!validateExport(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'cumbre.installments.export',
      detail: 'Export secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
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
    .from('cumbre_installments')
    .select(`
      id,
      plan_id,
      booking_id,
      installment_index,
      due_date,
      amount,
      currency,
      status,
      attempt_count,
      provider_reference,
      provider_tx_id,
      paid_at,
      plan:cumbre_payment_plans(frequency, status, provider, amount_paid, installment_count),
      booking:cumbre_bookings(contact_name, contact_email, total_amount, currency, status)
    `)
    .order('due_date', { ascending: true });

  if (error) {
    console.error('[cumbre.installments.export] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo exportar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const rows = data ?? [];
  const headers = [
    'installment_id',
    'plan_id',
    'booking_id',
    'installment_index',
    'due_date',
    'amount',
    'currency',
    'status',
    'attempt_count',
    'provider_reference',
    'provider_tx_id',
    'paid_at',
    'plan_frequency',
    'plan_status',
    'plan_provider',
    'plan_amount_paid',
    'plan_installment_count',
    'contact_name',
    'contact_email',
    'booking_total_amount',
    'booking_currency',
    'booking_status',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      csvEscape(row.id),
      csvEscape(row.plan_id),
      csvEscape(row.booking_id),
      csvEscape(row.installment_index),
      csvEscape(row.due_date),
      csvEscape(row.amount),
      csvEscape(row.currency),
      csvEscape(row.status),
      csvEscape(row.attempt_count),
      csvEscape(row.provider_reference),
      csvEscape(row.provider_tx_id),
      csvEscape(row.paid_at),
      csvEscape(row.plan?.frequency),
      csvEscape(row.plan?.status),
      csvEscape(row.plan?.provider),
      csvEscape(row.plan?.amount_paid),
      csvEscape(row.plan?.installment_count),
      csvEscape(row.booking?.contact_name),
      csvEscape(row.booking?.contact_email),
      csvEscape(row.booking?.total_amount),
      csvEscape(row.booking?.currency),
      csvEscape(row.booking?.status),
    ].join(','));
  }

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cumbre-installments.csv"',
    },
  });
};
