import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { listAccessibleChurchIds } from '@lib/portalScope';
import { restrictToPortalIglesiaBookings } from '@lib/portalBookingSource';

export const prerender = false;

function extractMethod(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  return (
    raw.payment_method ||
    raw.payment_method_type ||
    raw.method ||
    (Array.isArray(raw.payment_method_types) ? raw.payment_method_types[0] : '') ||
    ''
  );
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a datos operativos');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), { status: denied.status });
  }

  const isAdmin = access.isAdmin;
  let churchId: string | null = access.allowedChurchId;
  let scopedChurchIds: string[] = churchId ? [churchId] : [];
  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');

  if (!isAdmin && !churchId) {
    scopedChurchIds = await listAccessibleChurchIds(access);
    if (requestedChurch) {
      if (!scopedChurchIds.includes(requestedChurch)) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta sede' }), { status: 403 });
      }
      churchId = requestedChurch;
    } else {
      churchId = `IN:${scopedChurchIds.join(',')}`;
    }
  }

  // Build Query
  let bookingQuery = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency, source')
    .order('created_at', { ascending: false })
    .limit(200);

  // Apply Scope
  if (isAdmin) {
    if (requestedChurch) bookingQuery = bookingQuery.eq('church_id', requestedChurch);
  } else if (churchId && churchId.startsWith('IN:')) {
    const ids = scopedChurchIds.length ? scopedChurchIds : churchId.substring(3).split(',');
    if (ids.length === 0) return new Response(JSON.stringify({ ok: true, payments: [] }), { status: 200 });
    bookingQuery = bookingQuery.in('church_id', ids);
  } else if (churchId) {
    bookingQuery = bookingQuery.eq('church_id', churchId);
  } else {
    return new Response(JSON.stringify({ ok: true, payments: [] }), { status: 200 });
  }
  bookingQuery = restrictToPortalIglesiaBookings(bookingQuery);

  const { data: bookings, error: bookingsError } = await bookingQuery;
  if (bookingsError) {
    console.error('[portal.iglesia.payments] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((b: any) => b.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, payments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const statusParam = new URL(request.url).searchParams.get('status');
  let paymentsQuery = supabaseAdmin
    .from('cumbre_payments')
    .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, raw_event, created_at, installment_id')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });
  if (statusParam) {
    paymentsQuery = paymentsQuery.eq('status', statusParam);
  }

  const { data: payments, error: paymentsError } = await paymentsQuery;

  if (paymentsError) {
    console.error('[portal.iglesia.payments] payments error', paymentsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingMap = new Map<string, any>();
  (bookings || []).forEach((booking: any) => {
    bookingMap.set(booking.id, booking);
  });

  const response = (payments || []).map((payment: any) => {
    const { raw_event: rawEvent, ...safePayment } = payment;
    return {
      ...safePayment,
      method: extractMethod(rawEvent),
      booking: bookingMap.get(payment.booking_id) || null,
    };
  });

  return new Response(JSON.stringify({ ok: true, payments: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
