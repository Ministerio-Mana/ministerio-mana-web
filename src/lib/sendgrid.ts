function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

const SENDGRID_API_KEY = env('SENDGRID_API_KEY');
const SENDGRID_FROM = env('SENDGRID_FROM') || env('AUTH_EMAIL_FROM') || env('CUMBRE_EMAIL_FROM');
const SENDGRID_REPLY_TO = env('SENDGRID_REPLY_TO') || env('AUTH_EMAIL_REPLY_TO');

export function isSendgridEnabled(): boolean {
  return Boolean(SENDGRID_API_KEY && SENDGRID_FROM);
}

export async function sendSendgridEmail(params: {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
}): Promise<boolean> {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM) return false;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: params.to }],
        ...(params.dynamicTemplateData ? { dynamic_template_data: params.dynamicTemplateData } : {}),
      }],
      from: { email: SENDGRID_FROM },
      ...(SENDGRID_REPLY_TO ? { reply_to: { email: SENDGRID_REPLY_TO } } : {}),
      ...(params.templateId ? { template_id: params.templateId } : {}),
      ...(params.templateId ? {} : { subject: params.subject || '' }),
      ...(params.templateId ? {} : { content: [{ type: 'text/html', value: params.html || '' }] }),
    }),
  });

  return res.ok;
}
