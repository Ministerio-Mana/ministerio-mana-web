function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

export async function sendWhatsappMessage(params: {
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
