import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const headerToken = request.headers.get('x-whatsapp-token');
  if (headerToken) return headerToken.trim();
  return null;
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeWhatsappNumber(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const webhookToken = String(env('WHATSAPP_WEBHOOK_TOKEN') || '').trim();
  if (!webhookToken) {
    return json({ ok: false, error: 'WhatsApp webhook no configurado' }, 503);
  }

  const token = getBearerToken(request);
  if (!token || !safeEqual(token, webhookToken)) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  const allowed = await enforceRateLimit(`whatsapp.send:${clientAddress ?? 'unknown'}`, 60, 20);
  if (!allowed) {
    return json({ ok: false, error: 'Demasiadas solicitudes' }, 429);
  }

  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Payload invalido' }, 400);
  }

  const toRaw = String(payload.to || '').trim();
  const message = String(payload.message || '').trim();
  const contentSid = String(payload.contentSid || payload.content_sid || '').trim();
  const rawContentVars = payload.contentVariables ?? payload.content_variables ?? null;
  const hasTemplate = Boolean(contentSid);

  if (!toRaw || (!message && !hasTemplate)) {
    return json({ ok: false, error: 'Datos incompletos' }, 400);
  }

  const to = normalizeWhatsappNumber(toRaw);

  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const fromRaw = env('TWILIO_WHATSAPP_FROM');
  if (!accountSid || !authToken || !fromRaw) {
    return json({ ok: false, error: 'Twilio no configurado' }, 500);
  }

  const from = normalizeWhatsappNumber(fromRaw);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.set('From', from);
  params.set('To', to);
  if (hasTemplate) {
    params.set('ContentSid', contentSid);
    if (rawContentVars) {
      const variables = typeof rawContentVars === 'string'
        ? rawContentVars
        : JSON.stringify(rawContentVars);
      params.set('ContentVariables', variables);
    }
  } else {
    params.set('Body', message);
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    return json({ ok: false, error: 'Twilio error', detail }, res.status);
  }

  let responsePayload: any = null;
  try {
    responsePayload = await res.json();
  } catch {
    responsePayload = null;
  }

  return json({ ok: true, sid: responsePayload?.sid || null });
};
