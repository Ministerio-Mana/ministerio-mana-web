import type { APIRoute } from 'astro';
import { sendAuthLink } from '@lib/authMailer';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

const ALLOWED_TYPES = new Set(['magiclink', 'recovery']);
const DEBUG =
  (import.meta.env?.AUTH_LINK_DEBUG ?? process.env.AUTH_LINK_DEBUG) === 'true';

function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => Boolean(import.meta.env?.[key] ?? process.env[key]));
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  return Boolean(env('TURNSTILE_SECRET_KEY'));
}

function getTrustedSiteUrl(): string {
  const configured = env('PUBLIC_SITE_URL')?.trim();
  if (!configured) {
    throw new Error('PUBLIC_SITE_URL no configurado');
  }
  return configured.replace(/\/+$/, '');
}

function makeTraceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').trim().toLowerCase().split('@');
  if (!domain) return `${(local || '').slice(0, 2)}***`;
  return `${(local || '').slice(0, 2) || '*'}***@${domain}`;
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const sensitive = new Set([
      'access_token',
      'bookingId',
      'code',
      'next',
      'refresh_token',
      'token',
      'token_hash',
    ]);
    sensitive.forEach((key) => {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
    });
    return `${url.origin}${url.pathname}${url.search}${url.hash ? '#[redacted]' : ''}`;
  } catch {
    return '[invalid-url]';
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const userAgent = request.headers.get('user-agent') || '';
  const payload = await request.json().catch(() => null);
  const email = String(payload?.email || '').trim().toLowerCase();
  const kind = String(payload?.kind || payload?.type || '').trim();
  if (!email || !kind || !ALLOWED_TYPES.has(kind)) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const traceId = makeTraceId();

  const hasSecret = Boolean(env('TURNSTILE_SECRET_KEY'));
  if (isProduction() && hasSecret) {
    const token = String(payload?.turnstileToken || payload?.['cf-turnstile-response'] || payload?.captchaToken || '');
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'Captcha requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const okCaptcha = await verifyTurnstile(token, clientAddress);
    if (!okCaptcha) {
      void logSecurityEvent({
        type: 'captcha_failed',
        identifier: 'auth.send-link',
        ip: clientAddress,
        userAgent,
        detail: 'Turnstile invalido',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Captcha invalido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  const rateKey = `auth.send-link:${clientAddress ?? 'unknown'}`;
  const rateAllowed = await enforceRateLimit(rateKey);
  if (!rateAllowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: rateKey,
      ip: clientAddress,
      userAgent,
      detail: 'Auth send-link',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  let baseUrl: string;
  try {
    baseUrl = getTrustedSiteUrl();
  } catch (error) {
    console.error('[auth.send-link] missing trusted site URL', error);
    return new Response(JSON.stringify({ ok: false, error: 'Servidor no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let redirectTo = payload?.redirectTo ? String(payload.redirectTo) : '';
  if (redirectTo) {
    try {
      const target = new URL(redirectTo, baseUrl);
      if (target.origin !== new URL(baseUrl).origin) {
        redirectTo = baseUrl;
      } else {
        redirectTo = target.toString();
      }
    } catch {
      redirectTo = baseUrl;
    }
  } else {
    redirectTo = baseUrl;
  }

  console.log('[auth.send-link] start', {
    traceId,
    email: maskEmail(email),
    kind,
    redirectTo: redactUrl(redirectTo),
    hasSupabaseUrl: hasEnv('SUPABASE_URL'),
    hasServiceKey: hasEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE'),
    hasSendgridKey: hasEnv('SENDGRID_API_KEY'),
    hasSendgridFrom: hasEnv('SENDGRID_FROM', 'AUTH_EMAIL_FROM', 'CUMBRE_EMAIL_FROM'),
  });

  let result;
  try {
    result = await sendAuthLink({
      kind: kind as 'magiclink' | 'recovery',
      email,
      redirectTo,
    });
  } catch (error: any) {
    console.error('[auth.send-link] unexpected error', {
      traceId,
      email: maskEmail(email),
      kind,
      redirectTo: redactUrl(redirectTo),
      message: error?.message || String(error),
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!result.ok) {
    console.error('[auth.send-link] failed', {
      traceId,
      email: maskEmail(email),
      kind,
      redirectTo: redactUrl(redirectTo),
      method: result.method,
      error: result.error || 'send failed',
    });
    return new Response(JSON.stringify({
      ok: true,
      ...(DEBUG ? { traceId } : {}),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    ...(DEBUG ? { traceId } : {}),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
