import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null };
    }
    return { ok: true, role: profile.role };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null };
  }

  return { ok: true, role: 'superadmin' };
}

function buildMissingFields(participants: any[]) {
  const missing: string[] = [];
  if (!participants.length) {
    missing.push('Participantes');
    return missing;
  }
  if (participants.some((p) => !p.document_number)) {
    missing.push('Documento');
  }
  if (participants.some((p) => !p.birthdate)) {
    missing.push('Fecha de nacimiento');
  }
  if (participants.some((p) => !p.gender)) {
    missing.push('Género');
  }
  return missing;
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.followups',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAdminContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: bookings, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, status, total_amount, total_paid, currency, created_at, source, church_id')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[portal.admin.cumbre.followups] bookings error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const paidBookings = (bookings || []).filter((b: any) => (b.total_paid || 0) > 0 || b.status === 'PAID');
  if (!paidBookings.length) {
    return new Response(JSON.stringify({ ok: true, items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = paidBookings.map((b: any) => b.id);
  const { data: participants, error: participantsError } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, document_number, birthdate, gender')
    .in('booking_id', bookingIds);

  if (participantsError) {
    console.error('[portal.admin.cumbre.followups] participants error', participantsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const participantsMap = (participants || []).reduce((acc: Record<string, any[]>, row: any) => {
    if (!acc[row.booking_id]) acc[row.booking_id] = [];
    acc[row.booking_id].push(row);
    return acc;
  }, {});

  const items = paidBookings
    .map((booking: any) => {
      const bookingParticipants = participantsMap[booking.id] || [];
      const missingFields = buildMissingFields(bookingParticipants);
      if (!missingFields.length) return null;
      return {
        id: booking.id,
        contact_name: booking.contact_name,
        contact_email: booking.contact_email,
        status: booking.status,
        total_amount: booking.total_amount,
        total_paid: booking.total_paid,
        currency: booking.currency,
        created_at: booking.created_at,
        missing_fields: missingFields,
        action: 'registration_incomplete',
      };
    })
    .filter(Boolean);

  return new Response(JSON.stringify({ ok: true, items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
