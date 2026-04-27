import type { APIRoute } from 'astro';
import { readPasswordSession } from '@lib/portalPasswordSession';

// Debug-enhanced session check
export const GET: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const hasCookie = cookieHeader.includes('portal_admin_session=');

  const session = readPasswordSession(request);

  if (!session) {
    const reason = !hasCookie ? 'no_cookie' : 'invalid_or_expired';
    console.log(`[Session Debug] Failed. Reason: ${reason}, Cookie present: ${hasCookie}`);

    return new Response(JSON.stringify({ ok: false, reason, debug_cookie: hasCookie }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const profile = {
    user_id: 'password-session',
    email: session.email,
    full_name: session.email.split('@')[0],
    role: session.role,
  };

  return new Response(JSON.stringify({
    ok: true,
    mode: 'password',
    email: session.email,
    role: session.role,
    profile,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
