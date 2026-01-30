import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { hashToken } from '@lib/cumbre2026';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
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

  try {
    const { data: booking, error } = await supabaseAdmin
      .from('cumbre_bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (error || !booking) {
      return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const tokenHash = hashToken(token);
    if (!safeEqual(tokenHash, booking.token_hash)) {
      void logSecurityEvent({
        type: 'webhook_invalid',
        identifier: 'cumbre.booking.get',
        detail: 'Token invalido',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Token invalido' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: participants } = await supabaseAdmin
      .from('cumbre_participants')
      .select('id, full_name, package_type, relationship, birthdate, gender, nationality, document_type, document_number, room_preference, blood_type, allergies, diet_type, diet_notes, document_front_path, document_back_path')
      .eq('booking_id', bookingId);

    return new Response(JSON.stringify({
      ok: true,
      booking: {
        id: booking.id,
        contact_name: booking.contact_name,
        contact_email: booking.contact_email,
        contact_phone: booking.contact_phone,
        country_group: booking.country_group,
        currency: booking.currency,
        total_amount: booking.total_amount,
        total_paid: booking.total_paid,
        status: booking.status,
      },
      participants: participants ?? [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[cumbre.booking.get] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error leyendo reserva' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
