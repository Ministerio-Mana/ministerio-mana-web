import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

const PENDING_PAYMENT_STATUSES = new Set(['PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'APPROVAL_PENDING']);

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

function isPaidBooking(booking: any): boolean {
  const paid = Number(booking.total_paid || 0);
  return paid > 0 || booking.status === 'PAID' || booking.status === 'DEPOSIT_OK';
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.issues',
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

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') || 250);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 50), 500) : 250;

  const baseSelect = 'id, contact_name, contact_email, contact_phone, status, total_amount, total_paid, currency, created_at, church_id, contact_church';
  const extendedSelect = `${baseSelect}, payment_method, payment_status`;

  let { data: bookings, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select(extendedSelect)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error && error.code === '42703') {
    const fallback = await supabaseAdmin
      .from('cumbre_bookings')
      .select(baseSelect)
      .order('created_at', { ascending: false })
      .limit(limit);
    bookings = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('[portal.admin.cumbre.issues] bookings error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((b: any) => b.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, items: [], counts: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const [participantsRes, paymentsRes] = await Promise.all([
    supabaseAdmin
      .from('cumbre_participants')
      .select('id, booking_id, document_number, birthdate, gender')
      .in('booking_id', bookingIds),
    supabaseAdmin
      .from('cumbre_payments')
      .select('id, booking_id, provider, status, amount, currency, reference, provider_tx_id, created_at')
      .in('booking_id', bookingIds),
  ]);

  if (participantsRes.error) {
    console.error('[portal.admin.cumbre.issues] participants error', participantsRes.error);
  }
  if (paymentsRes.error) {
    console.error('[portal.admin.cumbre.issues] payments error', paymentsRes.error);
  }

  const notificationsRes = await supabaseAdmin
    .from('cumbre_admin_notifications')
    .select('booking_id, kind, channel, sent_at, sent_by_email, sent_by_name')
    .in('booking_id', bookingIds)
    .order('sent_at', { ascending: false });

  if (notificationsRes.error) {
    console.error('[portal.admin.cumbre.issues] notifications error', notificationsRes.error);
  }

  const participantsMap = (participantsRes.data || []).reduce((acc: Record<string, any[]>, row: any) => {
    if (!acc[row.booking_id]) acc[row.booking_id] = [];
    acc[row.booking_id].push(row);
    return acc;
  }, {});

  const paymentsMap = (paymentsRes.data || []).reduce((acc: Record<string, any[]>, row: any) => {
    if (!acc[row.booking_id]) acc[row.booking_id] = [];
    acc[row.booking_id].push(row);
    return acc;
  }, {});

  const notificationsMap = (notificationsRes.data || []).reduce((acc: Record<string, any>, row: any) => {
    const key = `${row.booking_id}:${row.kind}:${row.channel}`;
    if (!acc[key]) acc[key] = row;
    return acc;
  }, {});

  const counts: Record<string, number> = {};
  const items: any[] = [];

  (bookings || []).forEach((booking: any) => {
    const bookingParticipants = participantsMap[booking.id] || [];
    const bookingPayments = paymentsMap[booking.id] || [];

    const missingFields = buildMissingFields(bookingParticipants);
    const approvedPayments = bookingPayments.filter((p: any) => p.status === 'APPROVED');
    const hasApprovedPayments = approvedPayments.length > 0;
    const hasPaid = isPaidBooking(booking) || hasApprovedPayments;

    if (hasPaid && missingFields.length) {
      const lastWhatsapp = notificationsMap[`${booking.id}:registration_incomplete:whatsapp`];
      items.push({
        type: 'registration_incomplete',
        id: booking.id,
        booking_id: booking.id,
        contact_name: booking.contact_name,
        contact_email: booking.contact_email,
        contact_phone: booking.contact_phone,
        status: booking.status,
        total_amount: booking.total_amount,
        total_paid: booking.total_paid,
        currency: booking.currency,
        created_at: booking.created_at,
        missing_fields: missingFields,
        last_whatsapp: lastWhatsapp,
      });
      counts.registration_incomplete = (counts.registration_incomplete || 0) + 1;
    }

    const noChurch = !booking.church_id && !booking.contact_church;
    if (hasPaid && noChurch) {
      const lastWhatsapp = notificationsMap[`${booking.id}:no_church:whatsapp`];
      items.push({
        type: 'no_church',
        id: booking.id,
        booking_id: booking.id,
        contact_name: booking.contact_name,
        contact_email: booking.contact_email,
        contact_phone: booking.contact_phone,
        status: booking.status,
        total_amount: booking.total_amount,
        total_paid: booking.total_paid,
        currency: booking.currency,
        created_at: booking.created_at,
        last_whatsapp: lastWhatsapp,
      });
      counts.no_church = (counts.no_church || 0) + 1;
    }

    const pendingPayments = bookingPayments.filter((p: any) => PENDING_PAYMENT_STATUSES.has(p.status));

    if (hasPaid && pendingPayments.length && booking.status === 'PENDING') {
      const latestPending = pendingPayments
        .slice()
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      const lastWhatsapp = notificationsMap[`${booking.id}:payment_pending:whatsapp`];
      items.push({
        type: 'payment_pending',
        id: booking.id,
        booking_id: booking.id,
        contact_name: booking.contact_name,
        contact_email: booking.contact_email,
        contact_phone: booking.contact_phone,
        status: booking.status,
        total_amount: booking.total_amount,
        total_paid: booking.total_paid,
        currency: booking.currency,
        created_at: booking.created_at,
        payment: latestPending || null,
        last_whatsapp: lastWhatsapp,
      });
      counts.payment_pending = (counts.payment_pending || 0) + 1;
    }

    if (approvedPayments.length) {
      const approvedTotal = approvedPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      const totalPaid = Number(booking.total_paid || 0);
      if (approvedTotal > 0 && totalPaid + 0.01 < approvedTotal) {
        const lastWhatsapp = notificationsMap[`${booking.id}:payment_mismatch:whatsapp`];
        items.push({
          type: 'payment_mismatch',
          id: booking.id,
          booking_id: booking.id,
          contact_name: booking.contact_name,
          contact_email: booking.contact_email,
          contact_phone: booking.contact_phone,
          status: booking.status,
          total_amount: booking.total_amount,
          total_paid: booking.total_paid,
          currency: booking.currency,
          created_at: booking.created_at,
          payment: approvedPayments[0] || null,
          approved_total: approvedTotal,
          approved_count: approvedPayments.length,
          last_whatsapp: lastWhatsapp,
        });
        counts.payment_mismatch = (counts.payment_mismatch || 0) + 1;
      }

      const totalAmount = Number(booking.total_amount || 0);
      if (totalAmount > 0 && totalPaid > totalAmount + 0.01) {
        const lastWhatsapp = notificationsMap[`${booking.id}:overpaid:whatsapp`];
        items.push({
          type: 'overpaid',
          id: booking.id,
          booking_id: booking.id,
          contact_name: booking.contact_name,
          contact_email: booking.contact_email,
          contact_phone: booking.contact_phone,
          status: booking.status,
          total_amount: booking.total_amount,
          total_paid: booking.total_paid,
          currency: booking.currency,
          created_at: booking.created_at,
          payment: approvedPayments[0] || null,
          approved_total: approvedTotal,
          approved_count: approvedPayments.length,
          last_whatsapp: lastWhatsapp,
        });
        counts.overpaid = (counts.overpaid || 0) + 1;
      }
    }
  });

  items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return new Response(JSON.stringify({ ok: true, items, counts }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
