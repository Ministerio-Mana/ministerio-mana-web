import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { hashToken } from '@lib/cumbre2026';

export const prerender = false;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const bookingId = url.searchParams.get('bookingId') || '';
  const token = url.searchParams.get('token') || '';

  if (!bookingId || !token) {
    return new Response(JSON.stringify({ ok: false, error: 'Parametros incompletos' }), {
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
    .select('id, currency, total_amount, total_paid, status, deposit_threshold, token_hash')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!safeEqual(hashToken(token), booking.token_hash || '')) {
    return new Response(JSON.stringify({ ok: false, error: 'Token invalido' }), {
      status: 403,
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
