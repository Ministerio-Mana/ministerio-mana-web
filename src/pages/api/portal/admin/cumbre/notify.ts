import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import { generateAccessToken } from '@lib/cumbre2026';
import { resolveBaseUrl } from '@lib/url';
import { sendWhatsappMessage } from '@lib/whatsapp';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function hasWhatsappProvider(): boolean {
  return Boolean(env('WHATSAPP_WEBHOOK_URL'));
}

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null, email: null, name: null };
    }
    return { ok: true, role: profile.role, email: profile.email, name: profile.full_name || null };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null, email: null, name: null };
  }

  return { ok: true, role: 'superadmin', email: passwordSession.email, name: passwordSession.email };
}

function buildMissingFields(participants: any[]) {
  const missing: string[] = [];
  if (!participants.length) {
    missing.push('Participantes');
    return missing;
  }
  if (participants.some((p) => !p.document_number)) {
    missing.push('Documento');
  }
  if (participants.some((p) => !p.birthdate)) {
    missing.push('Fecha de nacimiento');
  }
  if (participants.some((p) => !p.gender)) {
    missing.push('Género');
  }
  return missing;
}

function buildWhatsappFallback(params: {
  kind: string;
  name: string;
  bookingId: string;
  missingFields?: string[];
  ctaUrl?: string;
}): string {
  const bookingRef = (params.bookingId || '').slice(0, 8).toUpperCase();
  const name = params.name || 'hola';
  switch (params.kind) {
    case 'registration_incomplete': {
      const missing = params.missingFields?.length ? params.missingFields.join(', ') : 'datos del registro';
      const linkText = params.ctaUrl ? ` Completa aqui: ${params.ctaUrl}.` : '';
      return `Hola ${name}, gracias por tu inscripcion a la Cumbre Mundial 2026. Faltan: ${missing}.${linkText} Booking: ${bookingRef}.`;
    }
    case 'payment_pending':
      return `Hola ${name}, tu pago esta en verificacion. Si pagaste con PSE/Nequi puede tardar unos minutos. No hagas otro pago. Booking: ${bookingRef}.`;
    case 'payment_mismatch':
      return `Hola ${name}, detectamos una inconsistencia con tu pago y ya estamos revisando. Booking: ${bookingRef}.`;
    case 'overpaid':
      return `Hola ${name}, detectamos un pago adicional en tu reserva y lo estamos revisando. Booking: ${bookingRef}.`;
    case 'no_church':
      return `Hola ${name}, necesitamos confirmar tu iglesia/sede y ciudad para completar tu registro. Booking: ${bookingRef}.`;
    default:
      return `Hola ${name}, estamos revisando tu registro de la Cumbre Mundial 2026. Booking: ${bookingRef}.`;
  }
}

async function recordAdminNotification(params: {
  bookingId: string;
  kind: string;
  channel: string;
  sentByEmail?: string | null;
  sentByName?: string | null;
}) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from('cumbre_admin_notifications').insert({
    booking_id: params.bookingId,
    kind: params.kind,
    channel: params.channel,
    sent_by_email: params.sentByEmail ?? null,
    sent_by_name: params.sentByName ?? null,
  });
  if (error) {
    console.error('[portal.admin.cumbre.notify] notification insert error', error);
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.notify',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAdminContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.bookingId || !payload?.kind) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = String(payload.bookingId);
  const kind = String(payload.kind);
  const channel = String(payload.channel || 'email');
  const force = Boolean(payload.force);
  if (!['email', 'whatsapp'].includes(channel)) {
    return new Response(JSON.stringify({ ok: false, error: 'Canal no soportado' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const isWhatsapp = channel === 'whatsapp';
  const allowedKinds = isWhatsapp
    ? ['registration_incomplete', 'payment_pending', 'payment_mismatch', 'overpaid', 'no_church']
    : ['registration_incomplete', 'payment_pending'];
  if (!allowedKinds.includes(kind)) {
    return new Response(JSON.stringify({ ok: false, error: 'Tipo de aviso no soportado' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: booking, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, total_amount, total_paid, currency, status')
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: lastNotification, error: lastNotificationError } = await supabaseAdmin
    .from('cumbre_admin_notifications')
    .select('sent_at, sent_by_email, sent_by_name')
    .eq('booking_id', bookingId)
    .eq('kind', kind)
    .eq('channel', channel)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastNotificationError) {
    console.error('[portal.admin.cumbre.notify] notification lookup error', lastNotificationError);
  }

  if (!force && lastNotification?.sent_at) {
    return new Response(
      JSON.stringify({
        ok: false,
        alreadySent: true,
        sent_at: lastNotification.sent_at,
        sent_by_email: lastNotification.sent_by_email,
        sent_by_name: lastNotification.sent_by_name,
        error: 'Ya se envió un mensaje para esta alerta.',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    );
  }

  if (channel === 'email' && !booking.contact_email) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva sin email' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (isWhatsapp && !booking.contact_phone) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva sin telefono' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (isWhatsapp && !hasWhatsappProvider()) {
    return new Response(JSON.stringify({ ok: false, error: 'WhatsApp no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (kind === 'registration_incomplete') {
    const { data: participants } = await supabaseAdmin
      .from('cumbre_participants')
      .select('id, booking_id, document_number, birthdate, gender')
      .eq('booking_id', bookingId);
    const missingFields = buildMissingFields(participants || []);

    const tokenPair = generateAccessToken();
    const { error: tokenError } = await supabaseAdmin
      .from('cumbre_bookings')
      .update({
        token_hash: tokenPair.hash,
      })
      .eq('id', bookingId);

    if (tokenError) {
      console.error('[portal.admin.cumbre.notify] token error', tokenError);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo preparar el enlace' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const baseUrl = resolveBaseUrl(request);
    const ctaUrl = `${baseUrl}/eventos/cumbre-mundial-2026/registro?bookingId=${bookingId}&token=${tokenPair.token}`;

    if (channel === 'email') {
      await sendCumbreEmail('registration_incomplete', {
        to: booking.contact_email,
        fullName: booking.contact_name || '',
        bookingId: booking.id,
        totalAmount: booking.total_amount,
        totalPaid: booking.total_paid,
        currency: booking.currency,
        missingFields,
        ctaUrl,
        ctaLabel: 'Completar registro',
      });
    } else {
      const contentSid = env('WHATSAPP_CUMBRE_REG_INCOMPLETE_CONTENT_SID');
      const contentVariables = contentSid
        ? {
            '1': booking.contact_name || 'amigo',
            '2': missingFields.join(', ') || 'datos del registro',
            '3': ctaUrl,
            '4': bookingId,
          }
        : undefined;
      const message = buildWhatsappFallback({
        kind,
        name: booking.contact_name || 'amigo',
        bookingId,
        missingFields,
        ctaUrl,
      });
      const ok = await sendWhatsappMessage({
        to: booking.contact_phone,
        message,
        contentSid: contentSid || null,
        contentVariables,
        meta: {
          bookingId,
          kind,
          channel,
        },
      });
      if (!ok) {
        return new Response(JSON.stringify({ ok: false, error: 'WhatsApp failed' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    await recordAdminNotification({
      bookingId,
      kind,
      channel,
      sentByEmail: ctx.email,
      sentByName: ctx.name,
    });
  }

  if (kind === 'payment_pending') {
    if (channel === 'email') {
      const { data: payment } = await supabaseAdmin
        .from('cumbre_payments')
        .select('amount, currency, status, provider')
        .eq('booking_id', bookingId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const baseUrl = resolveBaseUrl(request);
      await sendCumbreEmail('payment_pending', {
        to: booking.contact_email,
        fullName: booking.contact_name || '',
        bookingId: booking.id,
        amount: payment?.amount,
        currency: payment?.currency || booking.currency,
        totalAmount: booking.total_amount,
        totalPaid: booking.total_paid,
        ctaUrl: `${baseUrl}/eventos/cumbre-mundial-2026`,
        ctaLabel: 'Ver detalles',
      });
    } else {
      const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_PENDING_CONTENT_SID');
      const contentVariables = contentSid
        ? {
            '1': booking.contact_name || 'amigo',
            '2': bookingId,
          }
        : undefined;
      const message = buildWhatsappFallback({
        kind,
        name: booking.contact_name || 'amigo',
        bookingId,
      });
      const ok = await sendWhatsappMessage({
        to: booking.contact_phone,
        message,
        contentSid: contentSid || null,
        contentVariables,
        meta: {
          bookingId,
          kind,
          channel,
        },
      });
      if (!ok) {
        return new Response(JSON.stringify({ ok: false, error: 'WhatsApp failed' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    await recordAdminNotification({
      bookingId,
      kind,
      channel,
      sentByEmail: ctx.email,
      sentByName: ctx.name,
    });
  }

  if (isWhatsapp && kind === 'payment_mismatch') {
    const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_ISSUE_CONTENT_SID');
    const contentVariables = contentSid
      ? {
          '1': booking.contact_name || 'amigo',
          '2': bookingId,
        }
      : undefined;
    const message = buildWhatsappFallback({ kind, name: booking.contact_name || 'amigo', bookingId });
    const ok = await sendWhatsappMessage({
      to: booking.contact_phone,
      message,
      contentSid: contentSid || null,
      contentVariables,
      meta: { bookingId, kind, channel },
    });
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: 'WhatsApp failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    await recordAdminNotification({
      bookingId,
      kind,
      channel,
      sentByEmail: ctx.email,
      sentByName: ctx.name,
    });
  }

  if (isWhatsapp && kind === 'overpaid') {
    const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_ISSUE_CONTENT_SID');
    const contentVariables = contentSid
      ? {
          '1': booking.contact_name || 'amigo',
          '2': bookingId,
        }
      : undefined;
    const message = buildWhatsappFallback({ kind, name: booking.contact_name || 'amigo', bookingId });
    const ok = await sendWhatsappMessage({
      to: booking.contact_phone,
      message,
      contentSid: contentSid || null,
      contentVariables,
      meta: { bookingId, kind, channel },
    });
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: 'WhatsApp failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    await recordAdminNotification({
      bookingId,
      kind,
      channel,
      sentByEmail: ctx.email,
      sentByName: ctx.name,
    });
  }

  if (isWhatsapp && kind === 'no_church') {
    const contentSid = env('WHATSAPP_CUMBRE_NO_CHURCH_CONTENT_SID');
    const contentVariables = contentSid
      ? {
          '1': booking.contact_name || 'amigo',
          '2': bookingId,
        }
      : undefined;
    const message = buildWhatsappFallback({ kind, name: booking.contact_name || 'amigo', bookingId });
    const ok = await sendWhatsappMessage({
      to: booking.contact_phone,
      message,
      contentSid: contentSid || null,
      contentVariables,
      meta: { bookingId, kind, channel },
    });
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: 'WhatsApp failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    await recordAdminNotification({
      bookingId,
      kind,
      channel,
      sentByEmail: ctx.email,
      sentByName: ctx.name,
    });
  }

  return new Response(JSON.stringify({ ok: true, channel }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
