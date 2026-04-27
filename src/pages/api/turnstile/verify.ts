
import type { APIRoute } from 'astro';
import { verifyTurnstile } from '@lib/turnstile';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const contentType = request.headers.get('content-type') || '';
  let token = '';

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      token = (body?.turnstileToken || body?.['cf-turnstile-response'] || body?.token || '').toString();
    } else {
      const form = await request.formData();
      token = (form.get('cf-turnstile-response') || form.get('turnstile') || '').toString();
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const hasSecret = Boolean(env('TURNSTILE_SECRET_KEY'));
  if (!isProduction() || !hasSecret) {
    return new Response(JSON.stringify({ ok: true, bypass: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'Captcha requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ok = await verifyTurnstile(token, clientAddress);
  if (!ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Captcha invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
