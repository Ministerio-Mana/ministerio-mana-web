import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateExport(request: Request): boolean {
  const secret = env('CUMBRE_ADMIN_EXPORT_SECRET');
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

export const GET: APIRoute = async ({ request }) => {
  if (!validateExport(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'cumbre.admin.export',
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

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, country_group, currency, total_amount, total_paid, status, deposit_threshold, created_at')
    .order('created_at', { ascending: false });

  if (bookingsError) {
    console.error('[cumbre.admin.export] booking error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar reservas' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const headers = [
    'booking_id',
    'contact_name',
    'contact_email',
    'contact_phone',
    'country_group',
    'currency',
    'total_amount',
    'total_paid',
    'deposit_threshold',
    'booking_status',
    'booking_created_at',
    'plan_status',
    'plan_provider',
    'plan_frequency',
    'plan_installment_count',
    'plan_installment_amount',
    'plan_amount_paid',
    'plan_next_due_date',
    'payment_id',
    'payment_reference',
    'payment_provider',
    'payment_amount',
    'payment_currency',
    'payment_status',
    'payment_installment_id',
    'payment_method',
    'payment_created_at',
    'participant_id',
    'participant_name',
    'participant_package_type',
    'participant_relationship',
    'participant_birthdate',
    'participant_gender',
    'participant_nationality',
    'participant_document_type',
    'participant_document_number',
    'participant_room_preference',
    'participant_blood_type',
    'participant_allergies',
    'participant_diet_type',
    'participant_diet_notes',
  ];

  const bookingIds = (bookings || []).map((row: any) => row.id);
  if (bookingIds.length === 0) {
    return new Response(`${headers.join(',')}\n`, {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    });
  }

  const { data: participants } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, package_type, relationship, birthdate, gender, nationality, document_type, document_number, room_preference, blood_type, allergies, diet_type, diet_notes')
    .in('booking_id', bookingIds);

  const { data: plans } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('booking_id, status, frequency, provider, installment_count, installment_amount, amount_paid, next_due_date')
    .in('booking_id', bookingIds);

  const { data: payments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('booking_id, amount, status, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  const plansByBooking = new Map<string, any>();
  for (const plan of plans || []) {
    if (!plansByBooking.has(plan.booking_id)) {
      plansByBooking.set(plan.booking_id, plan);
    }
  }

  const paymentsByBooking = new Map<string, any[]>();
  for (const payment of payments || []) {
    const key = payment.booking_id;
    const list = paymentsByBooking.get(key) ?? [];
    list.push(payment);
    paymentsByBooking.set(key, list);
  }

  const bookingMap = new Map<string, any>();
  for (const booking of bookings || []) {
    bookingMap.set(booking.id, booking);
  }

  const rows: string[][] = [];
  (participants || []).forEach((participant: any) => {
    const booking = bookingMap.get(participant.booking_id);
    const plan = plansByBooking.get(participant.booking_id);
    const paymentRows = paymentsByBooking.get(participant.booking_id) ?? [];

    if (!paymentRows.length) {
      rows.push([
        csvEscape(participant.booking_id),
        csvEscape(booking?.contact_name),
        csvEscape(booking?.contact_email),
        csvEscape(booking?.contact_phone),
        csvEscape(booking?.country_group),
        csvEscape(booking?.currency),
        csvEscape(booking?.total_amount),
        csvEscape(booking?.total_paid),
        csvEscape(booking?.deposit_threshold),
        csvEscape(booking?.status),
        csvEscape(booking?.created_at),
        csvEscape(plan?.status),
        csvEscape(plan?.provider),
        csvEscape(plan?.frequency),
        csvEscape(plan?.installment_count),
        csvEscape(plan?.installment_amount),
        csvEscape(plan?.amount_paid),
        csvEscape(plan?.next_due_date),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        csvEscape(participant.id),
        csvEscape(participant.full_name),
        csvEscape(participant.package_type),
        csvEscape(participant.relationship),
        csvEscape(participant.birthdate),
        csvEscape(participant.gender),
        csvEscape(participant.nationality),
        csvEscape(participant.document_type),
        csvEscape(participant.document_number),
        csvEscape(participant.room_preference),
        csvEscape(participant.blood_type),
        csvEscape(participant.allergies),
        csvEscape(participant.diet_type),
        csvEscape(participant.diet_notes),
      ]);
      return;
    }

    paymentRows.forEach((payment: any) => {
      const raw = payment?.raw_event && typeof payment.raw_event === 'object' ? payment.raw_event : {};
      const method =
        raw?.payment_method ||
        raw?.payment_method_type ||
        raw?.method ||
        raw?.payment_method_types?.[0] ||
        '';
      rows.push([
        csvEscape(participant.booking_id),
        csvEscape(booking?.contact_name),
        csvEscape(booking?.contact_email),
        csvEscape(booking?.contact_phone),
        csvEscape(booking?.country_group),
        csvEscape(booking?.currency),
        csvEscape(booking?.total_amount),
        csvEscape(booking?.total_paid),
        csvEscape(booking?.deposit_threshold),
        csvEscape(booking?.status),
        csvEscape(booking?.created_at),
        csvEscape(plan?.status),
        csvEscape(plan?.provider),
        csvEscape(plan?.frequency),
        csvEscape(plan?.installment_count),
        csvEscape(plan?.installment_amount),
        csvEscape(plan?.amount_paid),
        csvEscape(plan?.next_due_date),
        csvEscape(payment?.id),
        csvEscape(payment?.reference),
        csvEscape(payment?.provider),
        csvEscape(payment?.amount),
        csvEscape(payment?.currency),
        csvEscape(payment?.status),
        csvEscape(payment?.installment_id),
        csvEscape(method),
        csvEscape(payment?.created_at),
        csvEscape(participant.id),
        csvEscape(participant.full_name),
        csvEscape(participant.package_type),
        csvEscape(participant.relationship),
        csvEscape(participant.birthdate),
        csvEscape(participant.gender),
        csvEscape(participant.nationality),
        csvEscape(participant.document_type),
        csvEscape(participant.document_number),
        csvEscape(participant.room_preference),
        csvEscape(participant.blood_type),
        csvEscape(participant.allergies),
        csvEscape(participant.diet_type),
        csvEscape(participant.diet_notes),
      ]);
    });
  });

  const csv = [headers.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cumbre-admin.csv"',
    },
  });
};
