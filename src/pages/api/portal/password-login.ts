import type { APIRoute } from 'astro';
import { createPasswordSessionToken, buildSessionCookie } from '@lib/portalPasswordSession';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
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

export const POST: APIRoute = async ({ request }) => {
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
  if (!email || !password) {
    return new Response(JSON.stringify({ ok: false, error: 'Email y contraseña requeridos' }), {
      status: 400,
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

  if (!allowed || password !== expected) {
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
