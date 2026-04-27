import { supabaseAdmin } from './supabaseAdmin';

type SecurityEventType =
  | 'captcha_failed'
  | 'rate_limited'
  | 'webhook_invalid'
  | 'payment_error'
  | 'payment_processed'
  | 'fx_fallback'
  | 'maintenance';

export interface SecurityEventPayload {
  type: SecurityEventType;
  identifier?: string;
  ip?: string | null;
  detail?: string;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

const REST_TABLE_ENDPOINT = 'security_events';

function getRestConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  return {
    endpoint: `${url}/rest/v1/${REST_TABLE_ENDPOINT}`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
  } as const;
}

export async function logSecurityEvent(event: SecurityEventPayload): Promise<void> {
  const payload = {
    type: event.type,
    identifier: event.identifier ?? null,
    ip: event.ip ?? null,
    detail: event.detail ?? null,
    user_agent: event.userAgent ?? null,
    meta: event.meta ?? null,
  };

  // Ruta principal: reuse del cliente admin para evitar fallas intermitentes por fetch directo.
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from(REST_TABLE_ENDPOINT).insert(payload);
      if (!error) return;
      if (process.env.NODE_ENV !== 'production') {
        console.error('[securityEvent] insert failed', error);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[securityEvent] admin insert error', error);
      }
    }
  }

  const conf = getRestConfig();
  if (!conf) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[securityEvent] config missing', event);
    }
    return;
  }

  try {
    const res = await fetch(conf.endpoint, {
      method: 'POST',
      headers: conf.headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok && process.env.NODE_ENV !== 'production') {
      console.error('[securityEvent] insert failed', res.status, await res.text());
    }
  } catch (error) {
    console.error('[securityEvent] error', error);
  }
}

export async function logPaymentEvent(provider: 'stripe' | 'wompi', kind: string, reference: string | null, data: Record<string, unknown>): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.from('donation_events').insert({
      provider,
      kind,
      reference: reference ?? null,
      payload: data,
    });
    if (error && process.env.NODE_ENV !== 'production') {
      console.error('[donationEvent] insert failed', error);
    }
  } catch (err) {
    console.error('[donationEvent] error', err);
  }
}
