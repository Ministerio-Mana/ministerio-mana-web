import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { listAccessibleChurchIds } from '@lib/portalScope';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
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
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency')
    .order('created_at', { ascending: false })
    .limit(400);

  // Apply Scope
  if (isAdmin) {
    if (requestedChurch) bookingQuery = bookingQuery.eq('church_id', requestedChurch);
  } else if (churchId && churchId.startsWith('IN:')) {
    const ids = scopedChurchIds.length ? scopedChurchIds : churchId.substring(3).split(',');
    if (ids.length === 0) return new Response(JSON.stringify({ ok: true, installments: [] }), { status: 200 });
    bookingQuery = bookingQuery.in('church_id', ids);
  } else if (churchId) {
    bookingQuery = bookingQuery.eq('church_id', churchId);
  } else {
    return new Response(JSON.stringify({ ok: true, installments: [] }), { status: 200 });
  }

  const { data: bookings, error: bookingsError } = await bookingQuery;
  if (bookingsError) {
    console.error('[portal.iglesia.installments] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const eligibleBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });

  const bookingIds = eligibleBookings.map((b: any) => b.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, installments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: installments, error } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, plan_id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, paid_at, created_at, booking:cumbre_bookings(id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency), plan:cumbre_payment_plans(id, status, provider, currency, installment_count, provider_payment_method_id, provider_subscription_id)')
    .in('booking_id', bookingIds)
    .in('status', ['PENDING', 'FAILED'])
    .order('due_date', { ascending: true })
    .limit(500);

  if (error) {
    console.error('[portal.iglesia.installments] list error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const nextByPlan = new Map<string, any>();
  (installments || []).forEach((row: any) => {
    const planId = row.plan_id || row.plan?.id;
    if (!planId) return;
    if (row.plan?.status && row.plan.status !== 'ACTIVE') return;
    if (!nextByPlan.has(planId)) {
      nextByPlan.set(planId, row);
    }
  });

  const nextInstallments = Array.from(nextByPlan.values());

  const installmentIds = nextInstallments.map((row: any) => row.id);
  const reminderMap: Record<string, any> = {};
  const linkMap: Record<string, any> = {};

  if (installmentIds.length) {
    const { data: reminders } = await supabaseAdmin
      .from('cumbre_installment_reminders')
      .select('installment_id, sent_at, reminder_key, channel, error')
      .in('installment_id', installmentIds)
      .order('sent_at', { ascending: false });

    (reminders || []).forEach((reminder: any) => {
      if (!reminderMap[reminder.installment_id]) {
        reminderMap[reminder.installment_id] = reminder;
      }
    });

    const { data: links } = await supabaseAdmin
      .from('cumbre_installment_links')
      .select('installment_id, created_at, expires_at, used_at')
      .in('installment_id', installmentIds)
      .order('created_at', { ascending: false });

    (links || []).forEach((link: any) => {
      if (!linkMap[link.installment_id]) {
        linkMap[link.installment_id] = link;
      }
    });
  }

  const response = nextInstallments.map((row: any) => ({
    ...row,
    last_reminder: reminderMap[row.id] || null,
    last_link: linkMap[row.id] || null,
  }));

  return new Response(JSON.stringify({ ok: true, installments: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
