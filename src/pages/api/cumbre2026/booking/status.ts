import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const bookingId = url.searchParams.get('bookingId');
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
