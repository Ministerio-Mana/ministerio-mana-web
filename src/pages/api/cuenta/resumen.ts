import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return `${local.slice(0, 2)}***`;
  return `${local.slice(0, 2) || '*'}***@${domain}`;
}

async function runOptionalQuery(label: string, query: PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.error(`[cuenta.resumen] ${label} error`, error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error(`[cuenta.resumen] ${label} error`, err);
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const startedAt = Date.now();
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  let email = user?.email?.toLowerCase() ?? '';
  if (!email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    email = passwordSession.email.toLowerCase();
  }
  const profileQuery = user?.id
    ? supabaseAdmin.from('user_profiles').select('full_name, city, country, church_id, church_name').eq('user_id', user.id).maybeSingle()
    : supabaseAdmin.from('user_profiles').select('full_name, city, country, church_id, church_name').eq('email', email).maybeSingle();

  const bookingsQuery = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_city, contact_church, contact_country, country_group, currency, total_amount, total_paid, status, deposit_threshold, created_at')
    .eq('contact_email', email)
    .order('created_at', { ascending: false });

  const donationsPromise = runOptionalQuery('donations', supabaseAdmin
      .from('donations')
      .select('id, amount, currency, status, donation_type, event_name, project_name, campus, created_at, provider, reference, is_recurring')
      .eq('donor_email', email)
      .order('created_at', { ascending: false })
      .limit(120));

  const donationSubscriptionsPromise = runOptionalQuery('donation subscriptions', supabaseAdmin
      .from('donation_reminder_subscriptions')
      .select('id, donation_id, donation_type, amount, currency, donor_name, donor_email, donor_phone, next_reminder_date, start_date, end_date, status, provider, reference')
      .eq('donor_email', email)
      .order('next_reminder_date', { ascending: true })
      .limit(60));

  const recurringQuery = user?.id
    ? supabaseAdmin
        .from('donation_recurring_subscriptions')
        .select('*')
        .eq('user_id', user.id)
    : supabaseAdmin
        .from('donation_recurring_subscriptions')
        .select('*')
        .eq('donor_email', email);
  const donationRecurringSubscriptionsPromise = runOptionalQuery(
    'donation recurring subscriptions',
    recurringQuery.order('created_at', { ascending: false }).limit(80),
  );

  const campusQuery = user?.id
    ? supabaseAdmin
        .from('campus_donation_subscriptions')
        .select('*, allocations:campus_donation_subscription_allocations(*)')
        .eq('user_id', user.id)
    : supabaseAdmin
        .from('campus_donation_subscriptions')
        .select('*, allocations:campus_donation_subscription_allocations(*)')
        .eq('donor_email', email);
  const campusSubscriptionsPromise = runOptionalQuery(
    'campus subscriptions',
    campusQuery.order('created_at', { ascending: false }).limit(80),
  );

  const [{ data: profile }, { data: bookings, error: bookingsError }] = await Promise.all([
    profileQuery,
    bookingsQuery,
  ]);

  if (bookingsError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar la cuenta' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((booking) => booking.id);

  let plans: any[] = [];
  let installments: any[] = [];
  let payments: any[] = [];

  if (bookingIds.length > 0) {
    const [plansData, installmentsData, paymentsData] = await Promise.all([
      runOptionalQuery('payment plans', supabaseAdmin
        .from('cumbre_payment_plans')
        .select('*')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })),
      runOptionalQuery('installments', supabaseAdmin
        .from('cumbre_installments')
        .select('*')
        .in('booking_id', bookingIds)
        .order('due_date', { ascending: true })),
      runOptionalQuery('payments', supabaseAdmin
        .from('cumbre_payments')
        .select('*')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })),
    ]);
    plans = plansData;
    installments = installmentsData;
    payments = paymentsData;
  }

  let orFilter = 'scope.eq.GLOBAL';
  if (profile?.country) {
    orFilter += `,and(scope.eq.NATIONAL,country.eq.${profile.country})`;
  }
  if (profile?.church_id) {
    orFilter += `,and(scope.eq.LOCAL,church_id.eq.${profile.church_id})`;
  }

  const eventsPromise = runOptionalQuery('events', supabaseAdmin
      .from('events')
      .select('id, title, description, scope, status, start_date, end_date, banner_url, location_name, location_address, city, country, church_id')
      .or(orFilter)
      .eq('status', 'PUBLISHED')
      .order('start_date', { ascending: true })
      .limit(20));

  const [
    donations,
    donationSubscriptions,
    donationRecurringSubscriptions,
    campusSubscriptions,
    events,
  ] = await Promise.all([
    donationsPromise,
    donationSubscriptionsPromise,
    donationRecurringSubscriptionsPromise,
    campusSubscriptionsPromise,
    eventsPromise,
  ]);

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 2500) {
    console.warn('[cuenta.resumen] slow response', {
      elapsedMs,
      email: maskEmail(email),
      bookingsCount: bookings?.length || 0,
      donationsCount: donations.length,
      campusSubscriptionsCount: campusSubscriptions.length,
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    user: {
      email,
      fullName: profile?.full_name || user?.user_metadata?.full_name || email.split('@')[0],
    },
    profile: profile ?? null,
    bookings: bookings ?? [],
    plans,
    installments,
    payments,
    donations,
    donationSubscriptions,
    donationRecurringSubscriptions,
    campusSubscriptions,
    events,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
