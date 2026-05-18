import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { logSecurityEvent } from '@lib/securityEvents';
import { sendSendgridEmail, isSendgridEnabled } from '@lib/sendgrid';
import { getDonationByReference } from '@lib/donationsStore';
import { listDueDonationReminders, recordDonationReminderLog, updateDonationReminder } from '@lib/donationReminders';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function getCronSecrets(): string[] {
  return [
    env('DONATION_REMINDER_CRON_SECRET'),
    env('CRON_SECRET'),
  ].filter((value): value is string => Boolean(value));
}

function validateCron(request: Request): boolean {
  const secrets = getCronSecrets();
  if (!secrets.length) return !isProduction();

  const header = request.headers.get('x-cron-secret');
  if (header && secrets.includes(header)) return true;

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (secrets.includes(bearerToken)) return true;
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && secrets.includes(token));
}

function getBogotaDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatCurrency(amount: number, currency: string): string {
  if (currency === 'COP') {
    return `$ ${Math.round(amount).toLocaleString('es-CO')} COP`;
  }
  return `$ ${amount.toFixed(2)} ${currency}`;
}

function formatDateLong(date: string): string {
  const dt = new Date(`${date}T00:00:00-05:00`);
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(dt);
}

async function sendWhatsappMessage(params: {
  to: string;
  message: string;
  contentSid?: string | null;
  contentVariables?: Record<string, string>;
  meta?: Record<string, unknown>;
}): Promise<boolean> {
  const webhookUrl = env('WHATSAPP_WEBHOOK_URL');
  if (!webhookUrl) return false;
  const token = env('WHATSAPP_WEBHOOK_TOKEN');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: params.to,
      message: params.message,
      ...(params.contentSid ? { contentSid: params.contentSid } : {}),
      ...(params.contentVariables ? { contentVariables: params.contentVariables } : {}),
      meta: params.meta ?? null,
    }),
  });
  return res.ok;
}

function isManualPaymentMethod(method: string | null | undefined): boolean {
  if (!method) return true;
  const value = method.toUpperCase();
  return value !== 'CARD';
}

async function handleRun(request: Request): Promise<Response> {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'donations.reminders',
      detail: 'Cron secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const today = getBogotaDateString();
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  const reminders = await listDueDonationReminders(today, 200);
  const baseUrl = resolveBaseUrl(request);

  for (const reminder of reminders) {
    processed += 1;

    if (reminder.end_date && today > reminder.end_date) {
      await updateDonationReminder({ id: reminder.id, status: 'ENDED' });
      skipped += 1;
      continue;
    }

    const donation = await getDonationByReference(reminder.provider, reminder.reference);
    if (!donation) {
      skipped += 1;
      continue;
    }

    if (donation.provider !== 'wompi' || !donation.is_recurring) {
      await updateDonationReminder({ id: reminder.id, status: 'DISABLED' });
      skipped += 1;
      continue;
    }

    if (!isManualPaymentMethod(donation.payment_method)) {
      await updateDonationReminder({ id: reminder.id, status: 'DISABLED' });
      skipped += 1;
      continue;
    }

    if (donation.status !== 'APPROVED') {
      skipped += 1;
      continue;
    }

    const amount = Number(reminder.amount || donation.amount || 0);
    const currency = reminder.currency || donation.currency || 'COP';
    const donationType = reminder.donation_type || donation.donation_type || 'diezmos';

    const donateLink = `${baseUrl}/primicias?type=${encodeURIComponent(donationType)}&amount=${encodeURIComponent(String(amount))}&recurring=1`;
    const amountLabel = formatCurrency(amount, currency);
    const startLabel = formatDateLong(reminder.start_date);
    const endLabel = formatDateLong(reminder.end_date);
    const whatsappTemplateSid = env('WHATSAPP_TITHE_REMINDER_CONTENT_SID');
    const templateVariables = whatsappTemplateSid ? {
      '1': reminder.donor_name || donation.donor_name || 'amigo',
      '2': amountLabel,
      '3': startLabel,
      '4': endLabel,
      '5': donateLink,
    } : undefined;

    const message = [
      `Este mensaje ha sido enviado bajo tu consentimiento.`,
      `Te recordamos tu diezmo mensual (${amountLabel}).`,
      `Vigencia del recordatorio: ${startLabel} hasta ${endLabel}.`,
      `Puedes donar aquí: ${donateLink}`,
      `Gracias por tu generosidad; juntos seguimos extendiendo el Reino.`,
    ].join(' ');

    let sentAny = false;

    for (const channel of reminder.channels || []) {
      if (channel === 'email' && reminder.donor_email && isSendgridEnabled()) {
        const ok = await sendSendgridEmail({
          to: reminder.donor_email,
          subject: 'Recordatorio de diezmo',
          html: `<p>${message}</p>`,
        });
        await recordDonationReminderLog({
          subscriptionId: reminder.id,
          reminderDate: today,
          channel: 'email',
          payload: { donationType, amount, currency },
          error: ok ? null : 'Email failed',
        });
        if (ok) {
          sentAny = true;
          sent += 1;
        }
      }

      if (channel === 'whatsapp' && reminder.donor_phone) {
        const ok = await sendWhatsappMessage({
          to: reminder.donor_phone,
          message,
          contentSid: whatsappTemplateSid || null,
          contentVariables: templateVariables,
          meta: { donationType, amount, currency },
        });
        await recordDonationReminderLog({
          subscriptionId: reminder.id,
          reminderDate: today,
          channel: 'whatsapp',
          payload: { donationType, amount, currency },
          error: ok ? null : 'WhatsApp failed',
        });
        if (ok) {
          sentAny = true;
          sent += 1;
        }
      }
    }

    if (sentAny) {
      await updateDonationReminder({ id: reminder.id, status: 'ENDED' });
    } else {
      errors += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed, sent, skipped, errors }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => handleRun(request);
export const GET: APIRoute = async ({ request }) => handleRun(request);
