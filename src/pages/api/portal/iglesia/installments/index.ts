import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

type PortalContext = {
  ok: boolean;
  isAdmin: boolean;
  churchId: string | null;
  profile: any | null;
};

async function getPortalContext(request: Request): Promise<PortalContext> {
  let isAllowed = false;
  let isAdmin = false;
  let churchId: string | null = null;
  let profile: any = null;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return { ok: false, isAdmin: false, churchId: null, profile: null };
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
    return { ok: false, isAdmin: false, churchId: null, profile: profile ?? null };
  }

  return { ok: true, isAdmin, churchId, profile };
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getPortalContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  const profileChurch = ctx.profile?.portal_church_id || ctx.profile?.church_id || null;
  const targetChurch = ctx.isAdmin ? (requestedChurch || profileChurch || ctx.churchId) : ctx.churchId;

  if (ctx.isAdmin && !targetChurch) {
    return new Response(JSON.stringify({ ok: true, installments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingQuery = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency')
    .eq('source', 'portal-iglesia')
    .order('created_at', { ascending: false })
    .limit(400);

  if (targetChurch) {
    bookingQuery.eq('church_id', targetChurch);
  }

  const { data: bookings, error: bookingsError } = await bookingQuery;
  if (bookingsError) {
    console.error('[portal.iglesia.installments] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((b: any) => b.id);
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
    .order('due_date', { ascending: true })
    .limit(500);

  if (error) {
    console.error('[portal.iglesia.installments] list error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const installmentIds = (installments || []).map((row: any) => row.id);
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

  const response = (installments || []).map((row: any) => ({
    ...row,
    last_reminder: reminderMap[row.id] || null,
    last_link: linkMap[row.id] || null,
  }));

  return new Response(JSON.stringify({ ok: true, installments: response }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
