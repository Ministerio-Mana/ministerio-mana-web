import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

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
    const profile = await ensureUserProfile(user);
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
  const targetChurch = isAdmin ? (requestedChurch || churchId) : churchId;

  if (isAdmin && !targetChurch) {
    return new Response(JSON.stringify({ ok: true, bookings: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const query = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, total_amount, total_paid, currency, status, created_at, church_id, contact_church')
    .eq('source', 'portal-iglesia')
    .order('created_at', { ascending: false })
    .limit(100);

  if (targetChurch) {
    query.eq('church_id', targetChurch);
  }

  const { data: bookings, error } = await query;
  if (error) {
    console.error('[portal.iglesia.bookings] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((b: any) => b.id);
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

  const response = (bookings || []).map((booking: any) => ({
    ...booking,
    participant_count: counts[booking.id] || 0,
  }));

  return new Response(JSON.stringify({ ok: true, bookings: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
