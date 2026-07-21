import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { safeCountry } from '@lib/donations';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { isSendgridEnabled, sendSendgridEmail } from '@lib/sendgrid';
import { getPrayerAiConfig, moderatePrayerText, shouldRunPrayerAiModeration } from '@lib/prayerAiModeration';

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

function normalizeAiConsent(value: FormDataEntryValue | null): boolean {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
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

function isMissingPrayerAiColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') &&
    /ai_(?:consent|status|recommendation|reason|model|policy|reviewed|urgent|error)/i.test(message)
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

function getPublicBaseUrl(): string {
  const raw =
    env('PUBLIC_SITE_URL') ||
    env('SITE_URL') ||
    env('VERCEL_PROJECT_PRODUCTION_URL') ||
    env('VERCEL_URL') ||
    'https://ministeriomana.org';
  const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'https://ministeriomana.org';
  }
}

function buildPortalPrayersUrl(): string {
  return new URL('/portal/peticiones', getPublicBaseUrl()).toString();
}

function visibilityLabel(value: 'private' | 'public'): string {
  return value === 'public' ? 'Pública' : 'Privada';
}

function moderationLabel(value: string): string {
  const labels: Record<string, string> = {
    private: 'Privada para intercesión',
    pending: 'Pendiente de revisión',
    flagged: 'Marcada para revisión',
    approved: 'Publicada',
    rejected: 'Rechazada',
  };
  return labels[value] || value || 'Sin estado';
}

function buildPrayerEmailHtml(params: {
  subject: string;
  firstName: string;
  requestText: string;
  location: string;
  visibility: 'private' | 'public';
  moderationStatus: string;
  portalUrl: string;
}): string {
  const actionLabel = params.visibility === 'public' ? 'Revisar petición' : 'Abrir bandeja';
  const intro = params.visibility === 'public'
    ? 'Hay una nueva petición pública pendiente antes de aparecer en el muro.'
    : 'Hay una nueva petición privada para acompañar en oración.';

  return `
    <div style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#0b1120;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e6ebf2;border-radius:24px;overflow:hidden;">
          <div style="padding:28px 28px 20px;border-bottom:1px solid #edf1f6;">
            <p style="margin:0 0 10px;color:#0f7184;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;">Peticiones Maná</p>
            <h1 style="margin:0;color:#293C74;font-size:26px;line-height:1.15;font-weight:900;">${escapeHtml(params.subject)}</h1>
            <p style="margin:14px 0 0;color:#516078;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
          </div>

          <div style="padding:24px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:22px;">
              <tr>
                <td style="padding:10px 0;color:#6b7280;font-size:13px;font-weight:700;">Nombre</td>
                <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;font-weight:800;">${escapeHtml(params.firstName)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#6b7280;font-size:13px;font-weight:700;border-top:1px solid #eef2f7;">Ubicación</td>
                <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;border-top:1px solid #eef2f7;">${escapeHtml(params.location)}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#6b7280;font-size:13px;font-weight:700;border-top:1px solid #eef2f7;">Privacidad</td>
                <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;border-top:1px solid #eef2f7;">${escapeHtml(visibilityLabel(params.visibility))}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#6b7280;font-size:13px;font-weight:700;border-top:1px solid #eef2f7;">Estado</td>
                <td style="padding:10px 0;color:#111827;font-size:14px;text-align:right;border-top:1px solid #eef2f7;">${escapeHtml(moderationLabel(params.moderationStatus))}</td>
              </tr>
            </table>

            <div style="background:#f8fafc;border:1px solid #e8eef5;border-radius:18px;padding:18px 20px;">
              <p style="margin:0;color:#293C74;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;">Petición</p>
              <p style="margin:10px 0 0;color:#334155;font-size:15px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(params.requestText)}</p>
            </div>

            <div style="margin-top:24px;">
              <a href="${escapeHtml(params.portalUrl)}" style="display:inline-block;background:#293C74;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 20px;font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(actionLabel)}</a>
              <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.55;">El enlace abre el portal y requiere iniciar sesión con permisos de administración o intercesión.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
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
  const portalUrl = buildPortalPrayersUrl();

  try {
    await sendSendgridEmail({
      to,
      subject,
      html: buildPrayerEmailHtml({
        subject,
        firstName: params.firstName,
        requestText: params.requestText,
        location,
        visibility: params.visibility,
        moderationStatus: params.moderationStatus,
        portalUrl,
      }),
      text: [
        subject,
        `Nombre: ${params.firstName}`,
        `Ubicación: ${location}`,
        `Privacidad: ${visibilityLabel(params.visibility)}`,
        `Estado: ${moderationLabel(params.moderationStatus)}`,
        '',
        params.requestText,
        '',
        `Abrir portal: ${portalUrl}`,
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
    const aiConsent = visibility === 'public' && normalizeAiConsent(form.get('aiConsent'));

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

    const turnstileConfigured = Boolean(
      import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
    );
    if (!import.meta.env.DEV && !turnstileConfigured) {
      void logSecurityEvent({
        type: 'maintenance',
        identifier: 'prayer.submit',
        ip: clientAddress,
        detail: 'Turnstile secret no configurado',
      });
      return json({ ok: false, error: 'Captcha no configurado' }, 503);
    }
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
      ai_consent: aiConsent,
      ai_consent_at: aiConsent ? new Date().toISOString() : null,
      ai_status: 'not_run',
      ai_recommendation: null,
      ai_reason_codes: [],
      ai_model: null,
      ai_policy_version: null,
      ai_reviewed_at: null,
      ai_urgent_pastoral_review: false,
      ai_error_code: null,
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
    let aiSchemaAvailable = true;

    if (error && isMissingPrayerAiColumn(error)) {
      aiSchemaAvailable = false;
      const moderationPayload = {
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
      const fallback = await supabaseAdmin
        .from('prayer_requests')
        .insert(moderationPayload)
        .select('id,first_name,request_text,city,country,prayers_count,visibility,moderation_status,approved,created_at')
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error && isMissingModerationColumn(error)) {
      aiSchemaAvailable = false;
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

    const aiConfig = getPrayerAiConfig();
    if (data?.id && shouldRunPrayerAiModeration({
      visibility,
      consent: aiConsent,
      schemaAvailable: aiSchemaAvailable,
      mode: aiConfig.mode,
    })) {
      const aiResult = await moderatePrayerText(requestText, {
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        timeoutMs: aiConfig.timeoutMs,
        policyVersion: aiConfig.policyVersion,
      });
      const aiUpdate = await supabaseAdmin
        .from('prayer_requests')
        .update({
          ai_status: aiResult.status,
          ai_recommendation: aiResult.recommendation,
          ai_reason_codes: aiResult.reasonCodes,
          ai_model: aiResult.model,
          ai_policy_version: aiResult.policyVersion,
          ai_reviewed_at: aiResult.reviewedAt,
          ai_urgent_pastoral_review: aiResult.urgentPastoralReview,
          ai_error_code: aiResult.errorCode,
        })
        .eq('id', data.id)
        .eq('visibility', 'public');

      if (aiUpdate.error) {
        console.warn('[prayer.submit] AI audit update failed', aiUpdate.error.code || 'unknown');
      }
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
