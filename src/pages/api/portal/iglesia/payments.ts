import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

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

  let isAllowed = false;
  let isAdmin = false;
  let churchId: string | null = null;
  let profile: any = null;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    isAllowed = true;
    isAdmin = true;
  } else {
    profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    isAdmin = Boolean(profile && isAdminRole(profile.role));
    isAllowed = Boolean(profile && (isAdmin || hasChurchRole));
    churchId = memberships.find((m: any) => m?.church?.id)?.church?.id || profile?.church_id || null;
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  const profileChurch = profile?.portal_church_id || profile?.church_id || null;
  const targetChurch = isAdmin ? (requestedChurch || profileChurch || churchId) : churchId;

  if (isAdmin && !targetChurch) {
    return new Response(JSON.stringify({ ok: true, payments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingQuery = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency')
    .eq('source', 'portal-iglesia')
    .order('created_at', { ascending: false })
    .limit(200);

  if (targetChurch) {
    bookingQuery.eq('church_id', targetChurch);
  }

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

  const { data: payments, error: paymentsError } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, raw_event, created_at, installment_id')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

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

  const response = (payments || []).map((payment: any) => ({
    ...payment,
    method: extractMethod(payment.raw_event),
    booking: bookingMap.get(payment.booking_id) || null,
  }));

  return new Response(JSON.stringify({ ok: true, payments: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
