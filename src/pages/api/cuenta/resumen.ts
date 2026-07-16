import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { discoverEventsForProfile } from '@lib/eventDiscovery';

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

async function loadProfile(userId: string | undefined, email: string): Promise<Record<string, any> | null> {
  const enhanced = userId
    ? await supabaseAdmin!.from('user_profiles').select('full_name, city, country, church_id, church_name, region_id').eq('user_id', userId).maybeSingle()
    : await supabaseAdmin!.from('user_profiles').select('full_name, city, country, church_id, church_name, region_id').eq('email', email).maybeSingle();
  if (!enhanced.error) return enhanced.data;
  if (enhanced.error.code !== '42703') {
    console.error('[cuenta.resumen] profile error', enhanced.error);
    return null;
  }
  const fallback = userId
    ? await supabaseAdmin!.from('user_profiles').select('full_name, city, country, church_id, church_name').eq('user_id', userId).maybeSingle()
    : await supabaseAdmin!.from('user_profiles').select('full_name, city, country, church_id, church_name').eq('email', email).maybeSingle();
  if (fallback.error) {
    console.error('[cuenta.resumen] profile fallback error', fallback.error);
    return null;
  }
  return fallback.data ? { ...fallback.data, region_id: null } : null;
}

async function loadPublicEvents(): Promise<any[]> {
  const enhancedFields = 'id,title,description,scope,status,start_date,end_date,banner_url,banner_layout,location_name,location_address,city,country,church_id,region_id,slug,visibility,category,registration_mode';
  const platformFields = 'id,title,description,scope,status,start_date,end_date,banner_url,banner_layout,location_name,location_address,city,country,church_id,slug,visibility,category,registration_mode';
  const platformBeforeLayoutFields = 'id,title,description,scope,status,start_date,end_date,banner_url,location_name,location_address,city,country,church_id,slug,visibility,category,registration_mode';
  const legacyFields = 'id,title,description,scope,status,start_date,end_date,banner_url,location_name,location_address,city,country,church_id';

  const enhanced = await supabaseAdmin!
    .from('events')
    .select(enhancedFields)
    .eq('status', 'PUBLISHED')
    .eq('visibility', 'PUBLIC')
    .order('start_date', { ascending: true })
    .limit(120);
  if (!enhanced.error) return enhanced.data || [];

  if (enhanced.error.code === '42703') {
    const platform = await supabaseAdmin!
      .from('events')
      .select(platformFields)
      .eq('status', 'PUBLISHED')
      .eq('visibility', 'PUBLIC')
      .order('start_date', { ascending: true })
      .limit(120);
    if (!platform.error) return (platform.data || []).map((event) => ({ ...event, region_id: null }));
    if (platform.error.code !== '42703') {
      console.error('[cuenta.resumen] public events fallback error', platform.error);
      return [];
    }

    const platformBeforeLayout = await supabaseAdmin!
      .from('events')
      .select(platformBeforeLayoutFields)
      .eq('status', 'PUBLISHED')
      .eq('visibility', 'PUBLIC')
      .order('start_date', { ascending: true })
      .limit(120);
    if (!platformBeforeLayout.error) {
      return (platformBeforeLayout.data || []).map((event) => ({ ...event, banner_layout: null, region_id: null }));
    }
    if (platformBeforeLayout.error.code !== '42703') {
      console.error('[cuenta.resumen] public events pre-layout error', platformBeforeLayout.error);
      return [];
    }

    const legacy = await supabaseAdmin!
      .from('events')
      .select(legacyFields)
      .eq('status', 'PUBLISHED')
      .order('start_date', { ascending: true })
      .limit(120);
    if (!legacy.error) {
      return (legacy.data || []).map((event) => ({ ...event, region_id: null, slug: null, visibility: 'PUBLIC' }));
    }
    console.error('[cuenta.resumen] public events legacy error', legacy.error);
    return [];
  }

  console.error('[cuenta.resumen] public events error', enhanced.error);
  return [];
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
  const profilePromise = loadProfile(user?.id, email);

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
        .select('id, status, provider, amount, currency, frequency, donation_type, project_name, event_name, campus, church, next_charge_at, current_period_end, pause_until, created_at')
        .eq('user_id', user.id)
    : supabaseAdmin
        .from('donation_recurring_subscriptions')
        .select('id, status, provider, amount, currency, frequency, donation_type, project_name, event_name, campus, church, next_charge_at, current_period_end, pause_until, created_at')
        .eq('donor_email', email);
  const donationRecurringSubscriptionsPromise = runOptionalQuery(
    'donation recurring subscriptions',
    recurringQuery.order('created_at', { ascending: false }).limit(80),
  );

  const campusQuery = user?.id
    ? supabaseAdmin
        .from('campus_donation_subscriptions')
        .select('id, status, provider, amount, currency, frequency, next_charge_at, current_period_end, pause_until, created_at, allocations:campus_donation_subscription_allocations(id, missionary_slug, missionary_name, amount, currency)')
        .eq('user_id', user.id)
    : supabaseAdmin
        .from('campus_donation_subscriptions')
        .select('id, status, provider, amount, currency, frequency, next_charge_at, current_period_end, pause_until, created_at, allocations:campus_donation_subscription_allocations(id, missionary_slug, missionary_name, amount, currency)')
        .eq('donor_email', email);
  const campusSubscriptionsPromise = runOptionalQuery(
    'campus subscriptions',
    campusQuery.order('created_at', { ascending: false }).limit(80),
  );

  const [profile, { data: bookings, error: bookingsError }] = await Promise.all([
    profilePromise,
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
        .select('id, booking_id, status, frequency, start_date, end_date, currency, installment_count, installment_amount, provider, provider_payment_method_id, provider_subscription_id, next_due_date, created_at')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })),
      runOptionalQuery('installments', supabaseAdmin
        .from('cumbre_installments')
        .select('id, plan_id, booking_id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, created_at')
        .in('booking_id', bookingIds)
        .order('due_date', { ascending: true })),
      runOptionalQuery('payments', supabaseAdmin
        .from('cumbre_payments')
        .select('id, booking_id, provider, provider_tx_id, reference, amount, currency, status, created_at')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: false })),
    ]);
    plans = plansData;
    installments = installmentsData;
    payments = paymentsData;
  }

  const latestBooking = bookings?.[0] || null;
  const discoveryProfile = {
    churchId: profile?.church_id || null,
    regionId: profile?.region_id || null,
    city: profile?.city || latestBooking?.contact_city || null,
    country: profile?.country || latestBooking?.contact_country || null,
  };
  if (!discoveryProfile.regionId && discoveryProfile.churchId) {
    const churchScope = await supabaseAdmin
      .from('churches')
      .select('region_id')
      .eq('id', discoveryProfile.churchId)
      .maybeSingle();
    if (!churchScope.error) discoveryProfile.regionId = churchScope.data?.region_id || null;
    else if (churchScope.error.code !== '42703') console.error('[cuenta.resumen] church region error', churchScope.error);
  }

  const eventsPromise = loadPublicEvents();

  const [
    donations,
    donationSubscriptions,
    donationRecurringSubscriptions,
    campusSubscriptions,
    rawEvents,
  ] = await Promise.all([
    donationsPromise,
    donationSubscriptionsPromise,
    donationRecurringSubscriptionsPromise,
    campusSubscriptionsPromise,
    eventsPromise,
  ]);

  const events = discoverEventsForProfile(rawEvents, discoveryProfile, { limit: 20 });
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
