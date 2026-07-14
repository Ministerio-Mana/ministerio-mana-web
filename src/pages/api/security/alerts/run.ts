import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';
import { isSendgridEnabled, sendSendgridEmail } from '@lib/sendgrid';
import { isCronRequestAuthorized } from '@lib/cronAuth';

export const prerender = false;

type AlertType = 'rate_limited' | 'webhook_invalid';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function validateCron(request: Request): boolean {
  return isCronRequestAuthorized(request, {
    secrets: [env('SECURITY_ALERT_CRON_SECRET'), env('CRON_SECRET')],
    production: isProduction(),
    allowQueryTokenInDevelopment: true,
  });
}

function parseLookbackMinutes(): number {
  const raw = env('SECURITY_ALERT_LOOKBACK_MINUTES') ?? env('SECURITY_ALERT_LOOKBACK');
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return 60;
  return Math.max(5, Math.min(1440, value));
}

function parseThresholds(): Record<AlertType, number> {
  const defaults: Record<AlertType, number> = {
    rate_limited: 20,
    webhook_invalid: 5,
  };
  const raw = env('SECURITY_ALERT_THRESHOLDS');
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      rate_limited: Number.isFinite(parsed.rate_limited) ? Number(parsed.rate_limited) : defaults.rate_limited,
      webhook_invalid: Number.isFinite(parsed.webhook_invalid) ? Number(parsed.webhook_invalid) : defaults.webhook_invalid,
    };
  } catch (err) {
    console.warn('[security.alerts] invalid thresholds json');
    return defaults;
  }
}

async function countEvents(type: AlertType, since: string): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { count } = await supabaseAdmin
    .from('security_events')
    .select('id', { count: 'exact', head: true })
    .eq('type', type)
    .gte('created_at', since);
  return count ?? 0;
}

async function latestEvent(type: AlertType, since: string): Promise<{ created_at?: string | null; identifier?: string | null; detail?: string | null }> {
  if (!supabaseAdmin) return {};
  const { data } = await supabaseAdmin
    .from('security_events')
    .select('created_at, identifier, detail')
    .eq('type', type)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? {};
}

async function sendWebhookAlert(payload: Record<string, unknown>): Promise<boolean> {
  const url = env('SECURITY_ALERT_WEBHOOK_URL') ?? env('SECURITY_ALERT_WEBHOOK');
  if (!url) return false;
  try {
    const body = typeof payload.text === 'string' && !('content' in payload)
      ? { ...payload, content: payload.text }
      : payload;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('[security.alerts] webhook error', err);
    return false;
  }
}

async function sendResendEmail(params: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = env('RESEND_API_KEY');
  const from = env('SECURITY_ALERT_EMAIL_FROM') ?? env('SECURITY_ALERT_FROM');
  if (!apiKey || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[security.alerts] resend error', err);
    return false;
  }
}

function formatAlertText(params: {
  lookbackMinutes: number;
  triggered: Array<{
    type: AlertType;
    count: number;
    threshold: number;
    latest?: { created_at?: string | null; identifier?: string | null; detail?: string | null };
  }>;
}): string {
  const lines = [
    `Security alerts (${params.lookbackMinutes}m)`,
  ];
  params.triggered.forEach((item) => {
    const parts = [`- ${item.type}: ${item.count} (>= ${item.threshold})`];
    if (item.latest?.identifier) {
      parts.push(`last=${item.latest.identifier}`);
    }
    if (item.latest?.created_at) {
      parts.push(`at=${item.latest.created_at}`);
    }
    lines.push(parts.join(' '));
  });
  return lines.join('\n');
}

export const GET: APIRoute = async ({ request }) => {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'security.alerts',
      detail: 'Cron secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const lookbackMinutes = parseLookbackMinutes();
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
  const thresholds = parseThresholds();
  const types: AlertType[] = ['rate_limited', 'webhook_invalid'];

  const counts = await Promise.all(types.map(async (type) => ({
    type,
    count: await countEvents(type, since),
    threshold: thresholds[type],
    latest: await latestEvent(type, since),
  })));

  const triggered = counts.filter((item) => item.threshold > 0 && item.count >= item.threshold);
  if (!triggered.length) {
    return new Response(JSON.stringify({ ok: true, triggered: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const text = formatAlertText({ lookbackMinutes, triggered });
  const subject = `Security alerts (${lookbackMinutes}m)`;

  const results: Record<string, boolean> = {};
  results.webhook = await sendWebhookAlert({ text, lookbackMinutes, triggered });

  const emailTo = env('SECURITY_ALERT_EMAIL_TO') ?? env('SECURITY_ALERT_TO');
  if (emailTo && isSendgridEnabled()) {
    results.email = await sendSendgridEmail({
      to: emailTo,
      subject,
      html: `<pre>${text}</pre>`,
      text,
    });
  } else if (emailTo) {
    results.email = await sendResendEmail({ to: emailTo, subject, text });
  } else {
    results.email = false;
  }

  return new Response(JSON.stringify({ ok: true, triggered, results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
