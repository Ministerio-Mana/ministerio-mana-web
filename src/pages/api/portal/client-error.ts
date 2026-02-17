import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

function clampText(value: unknown, max = 280): string {
  return String(value ?? '').trim().slice(0, max);
}

function maskEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@');
  if (!domain) return clampText(email, 8);
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function sanitizeMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 24);
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const safeKey = clampText(key, 64);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      result[safeKey] = clampText(value, 240);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[safeKey] = value;
      continue;
    }
    result[safeKey] = clampText(JSON.stringify(value), 240);
  }
  return result;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const userAgent = request.headers.get('user-agent') || '';

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const message = clampText(body?.message, 500);
  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: 'Mensaje requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = await enforceRateLimit(`portal.client-error:${clientAddress ?? 'unknown'}`, 60, 30);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: true, dropped: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }

  const authUser = await getUserFromRequest(request);
  const passwordSession = authUser?.email ? null : readPasswordSession(request);
  const actorEmail = authUser?.email || passwordSession?.email || '';

  const identifier = clampText(body?.identifier || 'portal.client.error', 120) || 'portal.client.error';
  const meta = sanitizeMeta(body?.meta);

  void logSecurityEvent({
    type: 'maintenance',
    identifier,
    ip: clientAddress,
    userAgent,
    detail: message,
    meta: {
      source: 'portal-client',
      actor_email: actorEmail ? maskEmail(actorEmail) : null,
      ...meta,
    },
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
