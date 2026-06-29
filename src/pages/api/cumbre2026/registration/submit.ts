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

function hasOwn(input: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input ?? {}, key);
}

function firstPresent(input: any, keys: string[]): unknown {
  for (const key of keys) {
    if (hasOwn(input, key)) return input[key];
  }
  return undefined;
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

    const contactUpdates: Record<string, string | null> = {};
    if (hasOwn(payload, 'contactName')) {
      contactUpdates.contact_name = sanitizePlainText(payload.contactName, 120) || null;
    }
    if (hasOwn(payload, 'email')) {
      contactUpdates.contact_email = (payload.email || '').toString().trim().toLowerCase() || null;
    }
    if (hasOwn(payload, 'phone')) {
      contactUpdates.contact_phone = sanitizePlainText(payload.phone, 30) || null;
    }
    const contactName = contactUpdates.contact_name || '';
    const email = contactUpdates.contact_email || '';

    if (containsBlockedSequence(contactName) || containsBlockedSequence(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos invalidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (Object.keys(contactUpdates).length > 0) {
      await supabaseAdmin
        .from('cumbre_bookings')
        .update(contactUpdates)
        .eq('id', bookingId);
    }

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

      const update: Record<string, string | null> = {};
      const fieldMap: Array<{ column: string; keys: string[]; max?: number; raw?: boolean }> = [
        { column: 'full_name', keys: ['fullName', 'name'], max: 120 },
        { column: 'birthdate', keys: ['birthdate'], raw: true },
        { column: 'gender', keys: ['gender'], max: 30 },
        { column: 'nationality', keys: ['nationality'], max: 60 },
        { column: 'document_type', keys: ['documentType'], max: 40 },
        { column: 'document_number', keys: ['documentNumber'], max: 50 },
        { column: 'room_preference', keys: ['roomPreference'], max: 60 },
        { column: 'blood_type', keys: ['bloodType'], max: 12 },
        { column: 'allergies', keys: ['allergies'], max: 160 },
        { column: 'diet_type', keys: ['dietType'], max: 40 },
        { column: 'diet_notes', keys: ['dietNotes'], max: 160 },
        { column: 'relationship', keys: ['relationship'], max: 60 },
      ];

      for (const field of fieldMap) {
        const rawValue = firstPresent(entry, field.keys);
        if (rawValue === undefined) continue;
        update[field.column] = field.raw
          ? (rawValue ? String(rawValue) : null)
          : (sanitizePlainText(String(rawValue ?? ''), field.max) || null);
      }

      if (Object.keys(update).length === 0) continue;

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
