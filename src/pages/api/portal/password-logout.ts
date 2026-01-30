import type { APIRoute } from 'astro';
import { buildClearSessionCookie } from '@lib/portalPasswordSession';

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildClearSessionCookie(),
    },
  });
};
