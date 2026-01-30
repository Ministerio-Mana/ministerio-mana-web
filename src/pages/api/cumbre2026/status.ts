import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const bookingId = url.searchParams.get('bookingId') || '';

  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: booking, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, currency, total_amount, total_paid, status, deposit_threshold')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    bookingId: booking.id,
    currency: booking.currency,
    totalAmount: booking.total_amount,
    totalPaid: booking.total_paid,
    depositThreshold: booking.deposit_threshold,
    status: booking.status,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
