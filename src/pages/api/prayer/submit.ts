import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { safeCountry } from '@lib/donations';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { isSendgridEnabled, sendSendgridEmail } from '@lib/sendgrid';

export const prerender = false;

const PUBLIC_MODERATION_PATTERNS = [
  /\b(hijue?puta|malparid[ao]s?|gonorre[ao]s?|mierda|puta|puto)\b/i,
  /\b(fuck|shit|bitch|asshole)\b/i,
];

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function normalizeVisibility(value: FormDataEntryValue | null): 'private' | 'public' {
  return String(value || 'private').toLowerCase() === 'public' ? 'public' : 'private';
}

function hasPublicModerationFlag(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return PUBLIC_MODERATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status|flagged/i.test(message)
  );
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function escapeHtml(value: string | null | undefined): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function notifyIntercession(params: {
  firstName: string;
  requestText: string;
  city: string | null;
  country: string | null;
  visibility: 'private' | 'public';
  moderationStatus: string;
}): Promise<void> {
  const to = params.visibility === 'public'
    ? env('PRAYER_REVIEW_EMAIL') || env('PRAYER_ADMIN_EMAIL') || env('PRAYER_INTERCESSION_EMAIL') || env('INTERCESSION_EMAIL')
    : env('PRAYER_INTERCESSION_EMAIL') || env('INTERCESSION_EMAIL');
  if (!to || !isSendgridEnabled()) return;

  const location = [params.city, params.country].filter(Boolean).join(', ') || 'Sin ubicación';
  const subject = params.visibility === 'private'
    ? 'Nueva petición privada de intercesión'
    : 'Nueva petición pública pendiente de revisión';

  try {
    await sendSendgridEmail({
      to,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#0B1120;">
          <h2 style="margin:0 0 12px;color:#1A255C;">${escapeHtml(subject)}</h2>
          <p><strong>Nombre:</strong> ${escapeHtml(params.firstName)}</p>
          <p><strong>Ubicación:</strong> ${escapeHtml(location)}</p>
          <p><strong>Privacidad:</strong> ${escapeHtml(params.visibility)}</p>
          <p><strong>Estado:</strong> ${escapeHtml(params.moderationStatus)}</p>
          <p style="white-space:pre-wrap;">${escapeHtml(params.requestText)}</p>
        </div>
      `,
      text: [
        subject,
        `Nombre: ${params.firstName}`,
        `Ubicación: ${location}`,
        `Privacidad: ${params.visibility}`,
        `Estado: ${params.moderationStatus}`,
        '',
        params.requestText,
      ].join('\n'),
    });
  } catch (error: any) {
    console.warn('[prayer.submit] intercession email failed', error?.message || error);
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const form = await request.formData();
    const firstNameRaw = (form.get('firstName') as string) || '';
    const requestRaw = ((form.get('requestText') || form.get('request') || form.get('petition')) as string) || '';
    const cityRaw = (form.get('city') as string) || '';
    const countryRaw = (form.get('country') as string) || '';
    const visibility = normalizeVisibility(form.get('visibility'));

    if (
      containsBlockedSequence(firstNameRaw) ||
      containsBlockedSequence(requestRaw) ||
      containsBlockedSequence(cityRaw) ||
      containsBlockedSequence(countryRaw)
    ) {
      return json({ ok: false, error: 'No se permiten enlaces en las peticiones.' }, 400);
    }

    const firstName = sanitizePlainText(firstNameRaw, 60);
    const requestText = sanitizePlainText(requestRaw, 280);
    const city = sanitizePlainText(cityRaw, 80);
    const country = sanitizePlainText(countryRaw, 80);
    const captchaToken = form.get('cf-turnstile-response')?.toString();

    if (!firstName) {
      return json({ ok: false, error: 'Nombre requerido' }, 400);
    }

    if (!requestText) {
      return json({ ok: false, error: 'Escribe una petición para orar.' }, 400);
    }

    const turnstileConfigured = !import.meta.env.DEV && Boolean(
      import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
    );
    if (turnstileConfigured) {
      const okCaptcha = await verifyTurnstile(captchaToken, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'prayer.submit',
          ip: clientAddress,
          detail: 'Turnstile inválido',
        });
        return json({ ok: false, error: 'Captcha inválido' }, 400);
      }
    }

    const allowed = await enforceRateLimit(`prayer:${clientAddress ?? 'unknown'}`);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: `prayer:${clientAddress ?? 'unknown'}`,
        ip: clientAddress,
        detail: 'Prayer submit',
      });
      return json({ ok: false, error: 'Demasiadas solicitudes' }, 429);
    }

    const cityClean = city ? city.replace(/[^\p{L}\p{N}\s\.,-]+/gu, '').trim() : null;
    const countryCode = safeCountry(country) ?? null;
    const flagged = hasPublicModerationFlag(`${firstName} ${requestText} ${cityClean || ''}`);
    const moderationStatus = visibility === 'private' ? 'private' : (flagged ? 'flagged' : 'pending');
    const payload = {
      first_name: firstName,
      request_text: requestText,
      city: cityClean,
      country: countryCode,
      prayers_count: 0,
      approved: false,
      visibility,
      moderation_status: moderationStatus,
      flagged,
    };

    if (!supabaseAdmin) {
      const row = {
        ...payload,
        id: `local-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      return json({ ok: true, simulated: true, visibility, moderation_status: moderationStatus, row });
    }

    const insertResult = await supabaseAdmin
      .from('prayer_requests')
      .insert(payload)
      .select('id,first_name,request_text,city,country,prayers_count,visibility,moderation_status,approved,created_at')
      .single();

    let data = insertResult.data;
    let error = insertResult.error;

    if (error && isMissingModerationColumn(error)) {
      const legacyPayload = {
        first_name: firstName,
        request_text: requestText,
        city: cityClean,
        country: countryCode,
        prayers_count: 0,
        approved: false,
      };
      const fallback = await supabaseAdmin
        .from('prayer_requests')
        .insert(legacyPayload)
        .select('id,first_name,request_text,city,country,prayers_count,approved,created_at')
        .single();
      data = fallback.data ? { ...fallback.data, visibility, moderation_status: moderationStatus } : fallback.data;
      error = fallback.error;
    }

    if (error) {
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'prayer.submit',
        ip: clientAddress,
        detail: 'Supabase insert error',
        meta: { error: error.message },
      });
      return json({ ok: false, error: error.message }, 500);
    }

    await notifyIntercession({
      firstName,
      requestText,
      city: cityClean,
      country: countryCode,
      visibility,
      moderationStatus,
    });

    return json({ ok: true, visibility, moderation_status: moderationStatus, row: data });
  } catch (error: any) {
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'prayer.submit',
      ip: clientAddress,
      detail: error?.message || 'Prayer submit error',
    });
    return json({ ok: false, error: error?.message || 'Error' }, 500);
  }
};
