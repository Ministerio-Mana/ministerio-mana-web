import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { hashToken } from '@lib/cumbre2026';
import crypto from 'node:crypto';

export const prerender = false;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function validateToken(bookingId: string, token: string) {
  if (!supabaseAdmin) return { ok: false, error: 'Supabase no configurado' };
  const { data: booking, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, token_hash')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !booking) return { ok: false, error: 'Reserva no encontrada' };
  const tokenHash = hashToken(token);
  if (!safeEqual(tokenHash, booking.token_hash)) {
    return { ok: false, error: 'Token invalido' };
  }
  return { ok: true };
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
  const validation = await validateToken(bookingId, token);
  if (!validation.ok) {
    return new Response(JSON.stringify({ ok: false, error: validation.error }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin
    .from('cumbre_registration_drafts')
    .select('payload')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) {
    console.error('[cumbre.registration.draft] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, draft: data?.payload || null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const bookingId = (payload.bookingId || '').toString();
  const token = (payload.token || '').toString();
  if (!bookingId || !token) {
    return new Response(JSON.stringify({ ok: false, error: 'Parametros incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const validation = await validateToken(bookingId, token);
  if (!validation.ok) {
    return new Response(JSON.stringify({ ok: false, error: validation.error }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const draftPayload = {
    participants: Array.isArray(payload.participants) ? payload.participants : [],
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('cumbre_registration_drafts')
    .upsert({
      booking_id: bookingId,
      payload: draftPayload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'booking_id' });

  if (error) {
    console.error('[cumbre.registration.draft] save error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
