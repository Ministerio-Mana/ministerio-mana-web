import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { hashToken } from '@lib/cumbre2026';

export const prerender = false;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ url }) => {
  const bookingId = url.searchParams.get('bookingId');
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

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, token_hash')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
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

  const { data, error } = await supabaseAdmin
    .from('cumbre_payments')
    .select('status, amount, currency, created_at, provider, reference')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: 'DB error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payment = data?.[0] ?? null;
  return new Response(
    JSON.stringify({
      ok: true,
      status: payment?.status ?? null,
      amount: payment?.amount ?? null,
      currency: payment?.currency ?? null,
      provider: payment?.provider ?? null,
      reference: payment?.reference ?? null,
      createdAt: payment?.created_at ?? null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};
