import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { logSecurityEvent } from '@lib/securityEvents';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import {
  createInstallmentLinkToken,
  listInstallmentsByDueDates,
  hasInstallmentReminder,
  recordInstallmentReminder,
} from '@lib/cumbreStore';

export const prerender = false;

const REMINDER_KEYS: Record<number, string> = {
  0: 'D0',
  2: 'D2',
  3: 'D3',
};

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateCron(request: Request): boolean {
  const secret = env('CUMBRE_CRON_SECRET');
  if (!secret) return true;
  const header = request.headers.get('x-cron-secret');
  if (header && header === secret) return true;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && token === secret);
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

function getBogotaDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00-05:00`);
  date.setDate(date.getDate() + days);
  return getBogotaDateString(date);
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00-05:00`).getTime();
  const to = new Date(`${toDate}T00:00:00-05:00`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

async function sendWhatsappMessage(params: {
  to: string;
  message: string;
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
      meta: params.meta ?? null,
    }),
  });
  return res.ok;
}

function hasEmailProvider(): boolean {
  return Boolean(env('SENDGRID_API_KEY') || env('RESEND_API_KEY'));
}

function hasWhatsappProvider(): boolean {
  return Boolean(env('WHATSAPP_WEBHOOK_URL'));
}

export const POST: APIRoute = async ({ request }) => {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'cumbre.installments.reminders',
      detail: 'Cron secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const today = getBogotaDateString();
  const dueDates = [today, addDays(today, 2), addDays(today, 3)];
  const installments = await listInstallmentsByDueDates(dueDates, 250);

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const installment of installments) {
    const plan = installment.plan;
    const booking = installment.booking;

    if (!plan || !booking) {
      skipped += 1;
      continue;
    }

    if (plan.status !== 'ACTIVE') {
      skipped += 1;
      continue;
    }

    if (plan.provider === 'wompi' && plan.provider_payment_method_id) {
      // Autodebito activo, no se envia recordatorio manual.
      skipped += 1;
      continue;
    }

    if (plan.provider === 'stripe') {
      // Stripe usa suscripcion/autodebito por defecto.
      if (plan.provider_subscription_id) {
        skipped += 1;
        continue;
      }
    }

    const diff = diffDays(today, installment.due_date);
    const reminderKey = REMINDER_KEYS[diff];
    if (!reminderKey) {
      continue;
    }

    const amount = Number(installment.amount || 0);
    if (!amount || amount <= 0) {
      skipped += 1;
      continue;
    }

    processed += 1;

    let paymentLink: string | null = null;

    try {
      const baseUrl = resolveBaseUrl(request);
      const token = await createInstallmentLinkToken(installment.id);
      paymentLink = token ? `${baseUrl}/cumbre2026/pagar/${token}` : null;
    } catch (error: any) {
      errors += 1;
      await recordInstallmentReminder({
        installmentId: installment.id,
        reminderKey,
        channel: 'system',
        payload: {
          bookingId: booking.id,
          planId: plan.id,
          dueDate: installment.due_date,
          amount,
          currency: plan.currency,
        },
        error: error?.message || 'No se pudo generar el link de pago',
      });
      continue;
    }

    if (!paymentLink) {
      errors += 1;
      await recordInstallmentReminder({
        installmentId: installment.id,
        reminderKey,
        channel: 'system',
        payload: {
          bookingId: booking.id,
          planId: plan.id,
          dueDate: installment.due_date,
          amount,
          currency: plan.currency,
        },
        error: 'Link de pago vacío',
      });
      continue;
    }

    const dueDateLabel = formatDateLong(installment.due_date);
    const amountLabel = formatCurrency(amount, plan.currency || 'COP');

    if (booking.contact_email && hasEmailProvider()) {
      const alreadySent = await hasInstallmentReminder({
        installmentId: installment.id,
        reminderKey,
        channel: 'email',
      });
      if (!alreadySent) {
        try {
          await sendCumbreEmail('installment_reminder', {
            to: booking.contact_email,
            fullName: booking.contact_name ?? undefined,
            bookingId: booking.id,
            amount,
            currency: plan.currency,
            dueDate: installment.due_date,
            installmentIndex: installment.installment_index,
            installmentCount: plan.installment_count,
            paymentLink,
          });
          await recordInstallmentReminder({
            installmentId: installment.id,
            reminderKey,
            channel: 'email',
            payload: {
              bookingId: booking.id,
              planId: plan.id,
              dueDate: installment.due_date,
              amount,
              currency: plan.currency,
              paymentLink,
            },
          });
          sent += 1;
        } catch (error: any) {
          errors += 1;
          await recordInstallmentReminder({
            installmentId: installment.id,
            reminderKey,
            channel: 'email',
            payload: {
              bookingId: booking.id,
              planId: plan.id,
              dueDate: installment.due_date,
              amount,
              currency: plan.currency,
              paymentLink,
            },
            error: error?.message || 'Email failed',
          });
        }
      }
    }

    if (booking.contact_phone && hasWhatsappProvider()) {
      const alreadySent = await hasInstallmentReminder({
        installmentId: installment.id,
        reminderKey,
        channel: 'whatsapp',
      });
      if (!alreadySent) {
        const message = `Cumbre Mundial 2026: Hola${booking.contact_name ? ` ${booking.contact_name}` : ''}. ` +
          `Tu cuota ${installment.installment_index}/${plan.installment_count} vence el ${dueDateLabel}. ` +
          `Valor: ${amountLabel}. ` +
          `Paga aqui: ${paymentLink} ` +
          `Medios: tarjeta, PSE, Nequi o cuenta de ahorros. ` +
          `Si ya realizaste el pago, puedes ignorar este mensaje.`;
        try {
          const ok = await sendWhatsappMessage({
            to: booking.contact_phone,
            message,
            meta: {
              bookingId: booking.id,
              planId: plan.id,
              installmentId: installment.id,
              dueDate: installment.due_date,
              amount,
              currency: plan.currency,
              paymentLink,
            },
          });
          await recordInstallmentReminder({
            installmentId: installment.id,
            reminderKey,
            channel: 'whatsapp',
            payload: {
              bookingId: booking.id,
              planId: plan.id,
              dueDate: installment.due_date,
              amount,
              currency: plan.currency,
              paymentLink,
              ok,
            },
            error: ok ? null : 'Webhook WhatsApp fallo',
          });
          if (ok) sent += 1;
        } catch (error: any) {
          errors += 1;
          await recordInstallmentReminder({
            installmentId: installment.id,
            reminderKey,
            channel: 'whatsapp',
            payload: {
              bookingId: booking.id,
              planId: plan.id,
              dueDate: installment.due_date,
              amount,
              currency: plan.currency,
              paymentLink,
            },
            error: error?.message || 'WhatsApp failed',
          });
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      sent,
      skipped,
      errors,
      dueDates,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};
