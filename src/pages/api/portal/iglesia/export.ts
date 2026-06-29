import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { csvEscapeQuoted as csvEscape } from '@lib/csv';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a exportación');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  const profileChurch = access.profile?.portal_church_id || access.profile?.church_id || null;
  let targetChurch = access.isAdmin ? (requestedChurch || profileChurch) : access.allowedChurchId;
  const requiresScopedChurchSelection = !access.isAdmin && !access.allowedChurchId;
  if (requiresScopedChurchSelection) {
    if (!requestedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const isAllowedChurch = await isChurchAllowedForAccess(requestedChurch, access);
    if (!isAllowedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    targetChurch = requestedChurch;
  }

  if (!targetChurch) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: churches, error: churchesError } = await supabaseAdmin
    .from('churches')
    .select('id, code, name, city, country')
    .in('id', [targetChurch]);

  if (churchesError) {
    console.error('[portal.iglesia.export] church error', churchesError);
  }
  const churchInfo = churches?.[0] || null;

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, total_amount, total_paid, currency, status, created_at, church_id')
    .eq('source', 'portal-iglesia')
    .eq('church_id', targetChurch)
    .order('created_at', { ascending: false });

  if (bookingsError) {
    console.error('[portal.iglesia.export] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo exportar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((b: any) => b.id);
  let payments: any[] = [];
  if (bookingIds.length) {
    const { data, error } = await supabaseAdmin
      .from('cumbre_payments')
      .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, raw_event, created_at, installment_id')
      .in('booking_id', bookingIds)
      .eq('status', 'APPROVED')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[portal.iglesia.export] payments error', error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo exportar' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    payments = data ?? [];
  }

  const paymentsByBooking = payments.reduce((acc: Record<string, any[]>, payment: any) => {
    if (!acc[payment.booking_id]) acc[payment.booking_id] = [];
    acc[payment.booking_id].push(payment);
    return acc;
  }, {});

  const headers = [
    'church_id',
    'church_code',
    'church_name',
    'booking_id',
    'contact_name',
    'contact_email',
    'contact_phone',
    'contact_document_type',
    'contact_document_number',
    'contact_country',
    'contact_city',
    'booking_total_amount',
    'booking_total_paid',
    'booking_currency',
    'booking_status',
    'booking_created_at',
    'payment_id',
    'payment_reference',
    'payment_provider',
    'payment_amount',
    'payment_currency',
    'payment_status',
    'payment_method',
    'payment_created_at',
  ];

  const rows: string[] = [];
  (bookings || []).forEach((booking: any) => {
    const paymentRows = paymentsByBooking[booking.id] || [];
    if (!paymentRows.length) {
      return;
    }
    paymentRows.forEach((payment: any) => {
      const rawEvent = payment.raw_event && typeof payment.raw_event === 'object' ? payment.raw_event : {};
      const method = (rawEvent as any)?.method || (rawEvent as any)?.payment_method || '';
      rows.push([
        booking.church_id,
        churchInfo?.code || '',
        churchInfo?.name || booking.contact_church || '',
        booking.id,
        booking.contact_name,
        booking.contact_email,
        booking.contact_phone,
        booking.contact_document_type,
        booking.contact_document_number,
        booking.contact_country,
        booking.contact_city,
        booking.total_amount,
        booking.total_paid,
        booking.currency,
        booking.status,
        booking.created_at,
        payment.id,
        payment.reference,
        payment.provider,
        payment.amount,
        payment.currency,
        payment.status,
        method,
        payment.created_at,
      ].map(csvEscape).join(','));
    });
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const filename = churchInfo?.name
    ? `portal-iglesia-${churchInfo.name.toLowerCase().replace(/\s+/g, '-')}.csv`
    : 'portal-iglesia.csv';

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
};
