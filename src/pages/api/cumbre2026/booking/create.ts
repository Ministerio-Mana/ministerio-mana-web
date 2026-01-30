import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import {
  normalizeCountryGroup,
  currencyForGroup,
  sanitizeParticipant,
  calculateTotals,
  depositThreshold,
  generateAccessToken,
} from '@lib/cumbre2026';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import { resolveBaseUrl } from '@lib/url';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isTestModeAllowed(runtimeEnv: string): boolean {
  if (runtimeEnv === 'production') return false;
  const flag = env('CUMBRE_TEST_MODE') ?? env('PUBLIC_CUMBRE_TEST_MODE');
  return flag === 'true';
}

function getTestAmount(currency: string): number {
  const raw = currency === 'COP'
    ? env('CUMBRE_TEST_AMOUNT_COP') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_COP')
    : env('CUMBRE_TEST_AMOUNT_USD') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_USD');
  const fallback = currency === 'COP' ? 5000 : 1;
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseParticipants(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const contentType = request.headers.get('content-type') || '';
  let payload: any = {};

  try {
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = {
        contactName: form.get('contactName'),
        email: form.get('email'),
        phone: form.get('phone'),
        countryGroup: form.get('countryGroup'),
        participants: form.get('participants'),
        turnstile: form.get('cf-turnstile-response'),
      };
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const runtimeEnv =
      import.meta.env?.VERCEL_ENV ?? process.env?.VERCEL_ENV ?? process.env?.NODE_ENV ?? 'development';
    const allowTestMode = isTestModeAllowed(runtimeEnv);
    const enforceTurnstile = runtimeEnv === 'production';
    const turnstileConfigured = enforceTurnstile && Boolean(
      import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
    );
    if (turnstileConfigured) {
      const token = payload.turnstile?.toString() || payload['cf-turnstile-response'];
      const okCaptcha = await verifyTurnstile(token, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'cumbre.booking',
          ip: clientAddress,
          detail: 'Turnstile invalido',
        });
        return new Response(JSON.stringify({ ok: false, error: 'Captcha invalido' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
    } else {
      console.warn('[CUMBRE] Turnstile no configurado: bypass en entorno local/dev');
    }

    const allowed = await enforceRateLimit(`cumbre.booking:${clientAddress ?? 'unknown'}`);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: 'cumbre.booking',
        ip: clientAddress,
        detail: 'Cumbre booking',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    const contactName = sanitizePlainText(payload.contactName, 120);
    const email = (payload.email || '').toString().trim().toLowerCase();
    const phone = sanitizePlainText(payload.phone, 30);

    if (containsBlockedSequence(contactName) || containsBlockedSequence(email) || containsBlockedSequence(phone)) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos invalidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Email invalido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const countryGroup = normalizeCountryGroup(payload.countryGroup);
    const currency = currencyForGroup(countryGroup);
    const testMode = Boolean(payload.testMode) && allowTestMode;

    let participantsRaw: unknown = payload.participants;
    if (typeof participantsRaw === 'string') {
      try {
        participantsRaw = JSON.parse(participantsRaw);
      } catch {
        participantsRaw = [];
      }
    }

    const participantsInput = parseParticipants(participantsRaw);
    const participants = participantsInput
      .map((entry: any) => sanitizeParticipant({
        fullName: entry?.fullName ?? entry?.name ?? '',
        packageType: entry?.packageType ?? entry?.type,
        relationship: entry?.relationship ?? '',
        documentType: entry?.documentType ?? entry?.document_type ?? entry?.docType ?? '',
        documentNumber: entry?.documentNumber ?? entry?.document_number ?? entry?.docNumber ?? '',
      }))
      .filter(Boolean) as ReturnType<typeof sanitizeParticipant>[];

    if (!participants.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    let totalAmount = calculateTotals(currency, participants);
    if (testMode) {
      totalAmount = getTestAmount(currency);
    }
    const threshold = depositThreshold(totalAmount);
    const token = generateAccessToken();

    if (!supabaseAdmin) {
      return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('cumbre_bookings')
      .insert({
        contact_name: contactName || null,
        contact_email: email || null,
        contact_phone: phone || null,
        country_group: countryGroup,
        currency,
        total_amount: totalAmount,
        total_paid: 0,
        status: 'PENDING',
        deposit_threshold: threshold,
        token_hash: token.hash,
      })
      .select('id')
      .single();

    if (bookingError || !booking) {
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'cumbre.booking',
        ip: clientAddress,
        detail: bookingError?.message || 'Insert error',
      });
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la reserva' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const participantRows = participants.map((participant) => ({
      booking_id: booking.id,
      full_name: participant.fullName,
      package_type: participant.packageType,
      relationship: participant.relationship,
      document_type: participant.documentType,
      document_number: participant.documentNumber,
    }));

    const { data: participantData, error: participantsError } = await supabaseAdmin
      .from('cumbre_participants')
      .insert(participantRows)
      .select('id, full_name, package_type');

    if (participantsError) {
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'cumbre.booking',
        ip: clientAddress,
        detail: participantsError.message,
      });
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    await sendCumbreEmail('booking_received', {
      to: email,
      fullName: contactName || undefined,
      bookingId: booking.id,
      totalAmount,
      totalPaid: 0,
      currency,
    });

    try {
      const baseUrl = resolveBaseUrl(request);
      const nextUrl = `${baseUrl}/eventos/cumbre-mundial-2026/registro?bookingId=${booking.id}&token=${encodeURIComponent(token.token)}`;
      const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent(nextUrl)}`;
      const existingUser = await findAuthUserByEmail(email);
      if (!existingUser) {
        const result = await sendAuthLink({ kind: 'invite', email, redirectTo });
        if (!result.ok) {
          console.warn('[cumbre.booking] invite email failed', result.error);
        }
      }
    } catch (inviteError) {
      console.error('[cumbre.booking] invite error', inviteError);
    }

    return new Response(JSON.stringify({
      ok: true,
      bookingId: booking.id,
      token: token.token,
      currency,
      totalAmount,
      depositThreshold: threshold,
      participants: participantData ?? [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[cumbre.booking] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'cumbre.booking',
      ip: clientAddress,
      detail: error?.message || 'Booking error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error creando reserva' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
