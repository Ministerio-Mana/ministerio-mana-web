import type { APIRoute } from 'astro';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const GET: APIRoute = async ({ request }) => {
  const session = readPasswordSession(request);
  if (!session) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: 'password',
    email: session.email,
    role: session.role,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
