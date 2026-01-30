import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { hashToken } from '@lib/cumbre2026';
import crypto from 'node:crypto';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function parsePayload(contentType: string, form: FormData | null, body: any) {
  if (contentType.includes('application/json')) return body || {};
  if (!form) return {};
  return {
    bookingId: form.get('bookingId'),
    token: form.get('token'),
    contactName: form.get('contactName'),
    email: form.get('email'),
    phone: form.get('phone'),
    emergencyName: form.get('emergencyName'),
    emergencyPhone: form.get('emergencyPhone'),
    participants: form.get('participants'),
  };
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get('content-type') || '';
  let body: any = null;
  let form: FormData | null = null;

  try {
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      form = await request.formData();
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = parsePayload(contentType, form, body);
  const bookingId = (payload.bookingId || '').toString();
  const token = (payload.token || '').toString();

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

    const tokenHash = hashToken(token);
    if (!safeEqual(tokenHash, booking.token_hash)) {
      void logSecurityEvent({
        type: 'webhook_invalid',
        identifier: 'cumbre.registration',
        detail: 'Token invalido',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Token invalido' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const contactName = sanitizePlainText(payload.contactName, 120);
    const email = (payload.email || '').toString().trim().toLowerCase();
    const phone = sanitizePlainText(payload.phone, 30);
    const emergencyName = sanitizePlainText(payload.emergencyName, 120);
    const emergencyPhone = sanitizePlainText(payload.emergencyPhone, 30);

    if (containsBlockedSequence(contactName) || containsBlockedSequence(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos invalidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    await supabaseAdmin
      .from('cumbre_bookings')
      .update({
        contact_name: contactName || null,
        contact_email: email || null,
        contact_phone: phone || null,
      })
      .eq('id', bookingId);

    let participantsRaw: unknown = payload.participants;
    if (typeof participantsRaw === 'string') {
      try {
        participantsRaw = JSON.parse(participantsRaw);
      } catch {
        participantsRaw = [];
      }
    }
    const participants = Array.isArray(participantsRaw) ? participantsRaw : [];

    for (const entry of participants) {
      const participantId = (entry?.id || '').toString();
      if (!participantId) continue;

      const update = {
        full_name: sanitizePlainText(entry?.fullName ?? entry?.name, 120) || null,
        birthdate: entry?.birthdate || null,
        gender: sanitizePlainText(entry?.gender, 30) || null,
        nationality: sanitizePlainText(entry?.nationality, 60) || null,
        document_type: sanitizePlainText(entry?.documentType, 40) || null,
        document_number: sanitizePlainText(entry?.documentNumber, 50) || null,
        room_preference: sanitizePlainText(entry?.roomPreference, 60) || null,
        blood_type: sanitizePlainText(entry?.bloodType, 12) || null,
        allergies: sanitizePlainText(entry?.allergies, 160) || null,
        diet_type: sanitizePlainText(entry?.dietType, 40) || null,
        diet_notes: sanitizePlainText(entry?.dietNotes, 160) || null,
        relationship: sanitizePlainText(entry?.relationship, 60) || null,
      };

      await supabaseAdmin
        .from('cumbre_participants')
        .update(update)
        .eq('id', participantId)
        .eq('booking_id', bookingId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[cumbre.registration] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error guardando registro' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
