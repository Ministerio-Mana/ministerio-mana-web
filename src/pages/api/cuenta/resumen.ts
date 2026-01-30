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
  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, country_group, currency, total_amount, total_paid, status, deposit_threshold, created_at')
    .eq('contact_email', email)
    .order('created_at', { ascending: false });

  if (bookingsError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar la cuenta' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((booking) => booking.id);
  if (bookingIds.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      user: {
        email,
        fullName: user?.user_metadata?.full_name || email.split('@')[0],
      },
      bookings: [],
      plans: [],
      installments: [],
      payments: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: plans } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('*')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('*')
    .in('booking_id', bookingIds)
    .order('due_date', { ascending: true });

  const { data: payments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('*')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  return new Response(JSON.stringify({
    ok: true,
    user: {
      email,
      fullName: user?.user_metadata?.full_name || email.split('@')[0],
    },
    bookings: bookings ?? [],
    plans: plans ?? [],
    installments: installments ?? [],
    payments: payments ?? [],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
