import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
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

  const { data: profile } = await profileQuery;

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_city, contact_church, contact_country, country_group, currency, total_amount, total_paid, status, deposit_threshold, created_at')
    .eq('contact_email', email)
    .order('created_at', { ascending: false });

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
    const { data: plansData } = await supabaseAdmin
      .from('cumbre_payment_plans')
      .select('*')
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: false });
    plans = plansData ?? [];

    const { data: installmentsData } = await supabaseAdmin
      .from('cumbre_installments')
      .select('*')
      .in('booking_id', bookingIds)
      .order('due_date', { ascending: true });
    installments = installmentsData ?? [];

    const { data: paymentsData } = await supabaseAdmin
      .from('cumbre_payments')
      .select('*')
      .in('booking_id', bookingIds)
      .order('created_at', { ascending: false });
    payments = paymentsData ?? [];
  }

  let donations: any[] = [];
  let donationSubscriptions: any[] = [];
  try {
    const { data: donationsData, error: donationsError } = await supabaseAdmin
      .from('donations')
      .select('id, amount, currency, status, donation_type, event_name, project_name, campus, created_at, provider, reference, is_recurring')
      .eq('donor_email', email)
      .order('created_at', { ascending: false })
      .limit(120);
    if (!donationsError) donations = donationsData ?? [];
  } catch (err) {
    console.error('[cuenta.resumen] donations error', err);
  }

  try {
    const { data: subsData, error: subsError } = await supabaseAdmin
      .from('donation_reminder_subscriptions')
      .select('id, donation_id, donation_type, amount, currency, donor_name, donor_email, donor_phone, next_reminder_date, start_date, end_date, status, provider, reference')
      .eq('donor_email', email)
      .order('next_reminder_date', { ascending: true })
      .limit(60);
    if (!subsError) donationSubscriptions = subsData ?? [];
  } catch (err) {
    console.error('[cuenta.resumen] donation subscriptions error', err);
  }

  let events: any[] = [];
  try {
    let orFilter = 'scope.eq.GLOBAL';
    if (profile?.country) {
      orFilter += `,and(scope.eq.NATIONAL,country.eq.${profile.country})`;
    }
    if (profile?.church_id) {
      orFilter += `,and(scope.eq.LOCAL,church_id.eq.${profile.church_id})`;
    }

    const { data: eventsData, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, title, description, scope, status, start_date, end_date, banner_url, location_name, location_address, city, country, church_id')
      .or(orFilter)
      .eq('status', 'PUBLISHED')
      .order('start_date', { ascending: true })
      .limit(20);

    if (!eventsError) events = eventsData ?? [];
  } catch (err) {
    console.error('[cuenta.resumen] events error', err);
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
    events,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
