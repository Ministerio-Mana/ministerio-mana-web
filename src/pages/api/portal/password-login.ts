import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { createPasswordSessionToken, buildSessionCookie } from '@lib/portalPasswordSession';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function parseEmails(raw?: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email.slice(0, 2);
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function isEmergencyLoginEnabled(): boolean {
  const raw = env('PORTAL_PASSWORD_LOGIN_ENABLED');
  if (raw == null) return true;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (isProduction() && !isEmergencyLoginEnabled()) {
    return new Response(JSON.stringify({ ok: false, error: 'Acceso administrativo alternativo deshabilitado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const userAgent = request.headers.get('user-agent') || '';
  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const captchaToken = String(payload.turnstileToken || payload['cf-turnstile-response'] || '');
  if (!email || !password) {
    return new Response(JSON.stringify({ ok: false, error: 'Email y contraseña requeridos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const hasSecret = Boolean(env('TURNSTILE_SECRET_KEY'));
  if (isProduction() && !hasSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'Captcha no configurado' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (isProduction()) {
    if (!captchaToken) {
      void logSecurityEvent({
        type: 'captcha_failed',
        identifier: 'portal.password-login',
        ip: clientAddress,
        userAgent,
        detail: 'Captcha token ausente',
        meta: { email: maskEmail(email) },
      });
      return new Response(JSON.stringify({ ok: false, error: 'Captcha requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const okCaptcha = await verifyTurnstile(captchaToken, clientAddress);
    if (!okCaptcha) {
      void logSecurityEvent({
        type: 'captcha_failed',
        identifier: 'portal.password-login',
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

  const rateKey = `portal.password:${clientAddress ?? 'unknown'}:${email}`;
  const rateAllowed = await enforceRateLimit(rateKey, 60, 5, { failOpen: !isProduction() });
  if (!rateAllowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: rateKey,
      ip: clientAddress,
      userAgent,
      detail: 'Portal password login',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = parseEmails(env('PORTAL_SUPERADMIN_EMAILS')).has(email);
  const expected = env('PORTAL_SUPERADMIN_PASSWORD');
  if (!expected) {
    return new Response(JSON.stringify({ ok: false, error: 'Password no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!allowed || !safeEqual(password, expected)) {
    void logSecurityEvent({
      type: 'maintenance',
      identifier: 'portal.password-login.invalid-credentials',
      ip: clientAddress,
      userAgent,
      detail: 'Intento con credenciales inválidas',
      meta: { email: maskEmail(email), allowedEmail: allowed },
    });
    return new Response(JSON.stringify({ ok: false, error: 'Credenciales invalidas' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const token = createPasswordSessionToken(email);
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear sesion' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildSessionCookie(token),
    },
  });
};
