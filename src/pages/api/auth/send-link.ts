import type { APIRoute } from 'astro';
import { sendAuthLink } from '@lib/authMailer';
import { resolveBaseUrl } from '@lib/url';

export const prerender = false;

const ALLOWED_TYPES = new Set(['invite', 'magiclink', 'recovery']);
const DEBUG =
  (import.meta.env?.AUTH_LINK_DEBUG ?? process.env.AUTH_LINK_DEBUG) === 'true';

function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => Boolean(import.meta.env?.[key] ?? process.env[key]));
}

function makeTraceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const POST: APIRoute = async ({ request }) => {
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

  const baseUrl = resolveBaseUrl(request);
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
    email,
    kind,
    redirectTo,
    hasSupabaseUrl: hasEnv('SUPABASE_URL'),
    hasServiceKey: hasEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE'),
    hasSendgridKey: hasEnv('SENDGRID_API_KEY'),
    hasSendgridFrom: hasEnv('SENDGRID_FROM', 'AUTH_EMAIL_FROM', 'CUMBRE_EMAIL_FROM'),
  });

  let result;
  try {
    result = await sendAuthLink({
      kind: kind as 'invite' | 'magiclink' | 'recovery',
      email,
      redirectTo,
    });
  } catch (error: any) {
    console.error('[auth.send-link] unexpected error', {
      traceId,
      email,
      kind,
      redirectTo,
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
      email,
      kind,
      redirectTo,
      method: result.method,
      error: result.error,
    });
    return new Response(JSON.stringify({ ok: false, error: result.error || 'No se pudo enviar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    method: result.method,
    ...(DEBUG ? { traceId } : {}),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
