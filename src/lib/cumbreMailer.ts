import { isSendgridEnabled, sendSendgridEmail } from './sendgrid';

type CumbreEmailKind =
  | 'booking_received'
  | 'payment_received'
  | 'deposit_ok'
  | 'paid'
  | 'payment_failed'
  | 'installment_reminder';

interface CumbreEmailPayload {
  to: string;
  fullName?: string;
  bookingId: string;
  amount?: number;
  currency?: string;
  totalPaid?: number;
  totalAmount?: number;
  dueDate?: string;
  installmentIndex?: number;
  installmentCount?: number;
  paymentLink?: string;
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

const APP_NAME = env('CUMBRE_EMAIL_APP_NAME') || 'Cumbre Mundial 2026';
const SUPPORT_EMAIL = env('CUMBRE_EMAIL_SUPPORT') || 'info@ministeriomana.org';
const SUPPORT_WHATSAPP = env('CUMBRE_SUPPORT_WHATSAPP') || '+57 314 829 7534';

const TEMPLATE_IDS: Record<CumbreEmailKind, string | undefined> = {
  booking_received: env('SENDGRID_TEMPLATE_CUMBRE_BOOKING'),
  payment_received: env('SENDGRID_TEMPLATE_CUMBRE_PAYMENT_RECEIVED'),
  deposit_ok: env('SENDGRID_TEMPLATE_CUMBRE_DEPOSIT_OK'),
  paid: env('SENDGRID_TEMPLATE_CUMBRE_PAID'),
  payment_failed: env('SENDGRID_TEMPLATE_CUMBRE_PAYMENT_FAILED'),
  installment_reminder: env('SENDGRID_TEMPLATE_CUMBRE_INSTALLMENT_REMINDER'),
};

function getFromEmail(): string {
  return env('CUMBRE_EMAIL_FROM') || 'info@ministeriomana.org';
}

function formatAmount(amount?: number, currency?: string): string {
  if (amount == null) return '';
  if (!currency) return `${amount}`;
  if (currency === 'COP') return `$ ${Math.round(amount).toLocaleString('es-CO')} COP`;
  return `$ ${amount.toFixed(2)} ${currency}`;
}

function buildSubject(kind: CumbreEmailKind): string {
  switch (kind) {
    case 'booking_received':
      return 'Inscripcion recibida - Cumbre Mundial 2026';
    case 'payment_received':
      return 'Abono confirmado - Cumbre Mundial 2026';
    case 'deposit_ok':
      return 'Cupo garantizado (>= 50%) - Cumbre Mundial 2026';
    case 'paid':
      return 'Pago completo confirmado - Cumbre Mundial 2026';
    case 'payment_failed':
      return 'Pago no confirmado - Cumbre Mundial 2026';
    case 'installment_reminder':
      return 'Recordatorio de cuota - Cumbre Mundial 2026';
    default:
      return 'Cumbre Mundial 2026';
  }
}

function buildTemplateData(kind: CumbreEmailKind, payload: CumbreEmailPayload, subject: string): Record<string, unknown> {
  const total = payload.totalAmount != null ? formatAmount(payload.totalAmount, payload.currency) : '';
  const paid = payload.totalPaid != null ? formatAmount(payload.totalPaid, payload.currency) : '';
  const amount = payload.amount != null ? formatAmount(payload.amount, payload.currency) : '';
  const dueDate = payload.dueDate ? new Date(`${payload.dueDate}T00:00:00-05:00`) : null;
  const dueLabel = dueDate
    ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(dueDate)
    : '';

  return {
    subject,
    app_name: APP_NAME,
    kind,
    full_name: payload.fullName ?? '',
    booking_id: payload.bookingId,
    amount,
    total_amount: total,
    total_paid: paid,
    currency: payload.currency ?? '',
    due_date: dueLabel,
    installment_index: payload.installmentIndex ?? '',
    installment_count: payload.installmentCount ?? '',
    payment_link: payload.paymentLink ?? '',
    support_email: SUPPORT_EMAIL,
    support_whatsapp: SUPPORT_WHATSAPP,
  };
}

function buildHtml(kind: CumbreEmailKind, payload: CumbreEmailPayload): string {
  const greeting = payload.fullName ? `Hola ${payload.fullName},` : 'Hola,';
  const total = payload.totalAmount != null ? formatAmount(payload.totalAmount, payload.currency) : '';
  const paid = payload.totalPaid != null ? formatAmount(payload.totalPaid, payload.currency) : '';
  const amount = payload.amount != null ? formatAmount(payload.amount, payload.currency) : '';
  const dueDate = payload.dueDate ? new Date(`${payload.dueDate}T00:00:00-05:00`) : null;
  const dueLabel = dueDate
    ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(dueDate)
    : '';

  let body = '';
  switch (kind) {
    case 'booking_received':
      body = `Recibimos tu inscripcion para la Cumbre Mundial 2026.`;
      break;
    case 'payment_received':
      body = `Recibimos tu abono por ${amount}.`;
      break;
    case 'deposit_ok':
      body = `Tu cupo quedo garantizado.`;
      break;
    case 'paid':
      body = `Tu pago completo fue confirmado.`;
      break;
    case 'payment_failed':
      body = `No pudimos confirmar tu pago. Puedes intentar de nuevo.`;
      break;
    case 'installment_reminder': {
      const index = payload.installmentIndex ? ` ${payload.installmentIndex}` : '';
      const totalInstallments = payload.installmentCount ? `/${payload.installmentCount}` : '';
      const due = dueLabel ? ` con vencimiento ${dueLabel}` : '';
      body = `Este es un recordatorio de tu cuota${index}${totalInstallments}${due}.`;
      break;
    }
    default:
      body = 'Gracias por ser parte de la Cumbre Mundial 2026.';
      break;
  }

  const totals = total || paid
    ? `<p>Total: <strong>${total || '-'}</strong><br/>Pagado: <strong>${paid || '-'}</strong></p>`
    : '';

  const action = payload.paymentLink
    ? `<p style=\"margin:16px 0 0;\">\n      <a href=\"${payload.paymentLink}\" style=\"display:inline-block;background:#20b2c5;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;\">Pagar cuota</a>\n    </p>`
    : '';

  const installmentInfo =
    kind === 'installment_reminder'
      ? `<p style=\"margin:0 0 12px;\">Valor de la cuota: <strong>${amount || '-'}</strong></p>`
      : '';

  return `
  <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin:0 0 8px;">${APP_NAME}</h2>
    <p style="margin:0 0 12px;">${greeting}</p>
    <p style="margin:0 0 12px;">${body}</p>
    ${installmentInfo}
    ${totals}
    ${action}
    <p style="margin:16px 0 0;">
      Si necesitas ayuda, escribe por WhatsApp al ${SUPPORT_WHATSAPP}.
    </p>
    <p style="margin:8px 0 0; font-size: 12px; color: #6b7280;">
      O escríbenos a ${SUPPORT_EMAIL}.
    </p>
    <p style="margin:16px 0 0; font-size: 12px; color: #6b7280;">
      Booking ID: ${payload.bookingId}
    </p>
  </div>
  `;
}

async function sendWithResend(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return false;
  const from = getFromEmail();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}

export async function sendCumbreEmail(kind: CumbreEmailKind, payload: CumbreEmailPayload): Promise<void> {
  if (!payload.to) return;
  const subject = buildSubject(kind);
  const html = buildHtml(kind, payload);
  const templateId = TEMPLATE_IDS[kind];
  let ok = false;

  try {
    if (isSendgridEnabled()) {
      ok = await sendSendgridEmail({
        to: payload.to,
        subject,
        html: templateId ? undefined : html,
        templateId,
        dynamicTemplateData: templateId ? buildTemplateData(kind, payload, subject) : undefined,
      });
    }
  } catch (err) {
    console.error('[cumbre.email] sendgrid failed', err);
  }

  if (!ok) {
    try {
      ok = await sendWithResend(payload.to, subject, html);
    } catch (err) {
      console.error('[cumbre.email] resend failed', err);
    }
  }

  if (!ok && process.env.NODE_ENV !== 'production') {
    console.warn('[cumbre.email] no provider configured');
  }
}

export type { CumbreEmailKind, CumbreEmailPayload };
