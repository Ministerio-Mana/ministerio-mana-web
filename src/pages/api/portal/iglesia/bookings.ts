import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { listAccessibleChurchIds } from '@lib/portalScope';
import { isPortalIglesiaBooking, restrictToPortalIglesiaBookings } from '@lib/portalBookingSource';

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

  const baseSelect = 'id, contact_name, contact_email, total_amount, total_paid, currency, status, created_at, church_id, contact_church, source';
  const extendedSelect = `${baseSelect}, payment_method, payment_status`;

  const buildQuery = (select: string) => {
    let query = supabaseAdmin
      .from('cumbre_bookings')
      .select(select)
      .order('created_at', { ascending: false });

    if (isAdmin) {
      if (requestedChurch) query = query.eq('church_id', requestedChurch);
    } else if (churchId && churchId.startsWith('IN:')) {
      const ids = scopedChurchIds.length ? scopedChurchIds : churchId.substring(3).split(',');
      if (ids.length === 0) return null;
      query = query.in('church_id', ids);
    } else if (churchId) {
      query = query.eq('church_id', churchId);
    } else {
      return null;
    }
    return restrictToPortalIglesiaBookings(query, isAdmin);
  };

  const primaryQuery = buildQuery(extendedSelect);
  if (!primaryQuery) {
    return new Response(JSON.stringify({ ok: true, bookings: [] }), { status: 200 });
  }

  let { data: bookings, error } = await primaryQuery;

  if (error && error.code === '42703') {
    const fallbackQuery = buildQuery(baseSelect);
    if (!fallbackQuery) {
      return new Response(JSON.stringify({ ok: true, bookings: [] }), { status: 200 });
    }
    const fallback = await fallbackQuery;
    bookings = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('[portal.iglesia.bookings] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), { status: 500 });
  }

  const enrolledBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });

  // Participant Counts
  const bookingIds = enrolledBookings.map((b: any) => b.id);
  let counts: Record<string, number> = {};
  if (bookingIds.length) {
    const { data: participants } = await supabaseAdmin
      .from('cumbre_participants')
      .select('booking_id')
      .in('booking_id', bookingIds);
    counts = (participants || []).reduce((acc: any, row: any) => {
      acc[row.booking_id] = (acc[row.booking_id] || 0) + 1;
      return acc;
    }, {});
  }

  const response = enrolledBookings.map((booking: any) => {
    const paymentMethod = String(booking.payment_method || '').toLowerCase();
    const isManual =
      paymentMethod === 'cash' ||
      paymentMethod === 'manual' ||
      isPortalIglesiaBooking(booking);
    return {
      ...booking,
      participant_count: counts[booking.id] || 0,
      // Helper fields for frontend
      is_paid_full: booking.status === 'PAID' || booking.total_paid >= booking.total_amount,
      payment_type: isManual ? 'Físico' : 'Online',
    };
  });

  return new Response(JSON.stringify({ ok: true, bookings: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
