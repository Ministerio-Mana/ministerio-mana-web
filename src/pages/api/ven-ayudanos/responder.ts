import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { containsBlockedSequence, sanitizePlainText } from '@lib/validation';
import { isSendgridEnabled, sendSendgridEmail } from '@lib/sendgrid';

export const prerender = false;

const allowedMinistries = new Set(['campus', 'varones', 'ninos', 'mujeres', 'mana', 'no-estoy-seguro']);
const allowedHelpTypes = new Set([
  'tiempo',
  'talentos',
  'ideas',
  'servicio',
  'oracion',
  'generosidad',
  'apadrinamiento',
  'difusion',
  'ilustracion',
  'animacion',
  'guiones',
  'manualidades',
  'ensenanza-kids',
  'musica-kids',
  'produccion-kids',
  'materiales-kids',
  'propuesta-kids',
]);
const allowedAvailability = new Set(['semanal', 'mensual', 'eventos-especiales', 'no-estoy-seguro']);

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function parseEmailList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

function clean(value: FormDataEntryValue | null, max = 120): string {
  return sanitizePlainText(String(value || ''), max);
}

async function notifyTeam(payload: Record<string, unknown>) {
  if (!isSendgridEnabled()) return;

  const recipients = parseEmailList(
    env('VEN_AYUDANOS_NOTIFY_EMAILS') || env('SENDGRID_REPLY_TO') || env('PORTAL_SUPERADMIN_EMAILS'),
  );
  if (!recipients.length) return;

  const rows = [
    ['Nombre', payload.full_name],
    ['WhatsApp', payload.whatsapp],
    ['Correo', payload.email],
    ['Ciudad', payload.city],
    ['Iglesia / sede', payload.church],
    ['Ministerio', payload.ministry],
    ['Aporta con', Array.isArray(payload.help_types) ? payload.help_types.join(', ') : ''],
    ['Disponibilidad', payload.availability],
    ['Origen', payload.origin],
    ['Lugar', payload.place],
    ['QR', payload.qr],
    ['Mensaje', payload.message],
  ];
  const htmlRows = rows
    .filter(([, value]) => String(value || '').trim())
    .map(([label, value]) => `<tr><td style="padding:8px 12px;font-weight:700;">${escapeHtml(String(label))}</td><td style="padding:8px 12px;">${escapeHtml(String(value))}</td></tr>`)
    .join('');

  await Promise.allSettled(
    recipients.map((to) =>
      sendSendgridEmail({
        to,
        subject: `Nueva respuesta Ven y Ayúdanos: ${payload.ministry || 'sin ministerio'}`,
        html: `<div style="font-family:Arial,sans-serif;color:#0b1120;"><h2>Nueva respuesta Ven y Ayúdanos</h2><table style="border-collapse:collapse;">${htmlRows}</table></div>`,
      }),
    ),
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const form = await request.formData();
    const rawValues = Array.from(form.values()).map((value) => String(value || ''));

    if (rawValues.some((value) => containsBlockedSequence(value))) {
      void logSecurityEvent({
        type: 'maintenance',
        identifier: 'ven-ayudanos.submit',
        ip: clientAddress,
        detail: 'Formulario con enlace bloqueado',
      });
      return new Response(JSON.stringify({ ok: false, error: 'No se permiten enlaces en este formulario.' }), { status: 400 });
    }

    const fullName = clean(form.get('fullName'), 100);
    const whatsapp = clean(form.get('whatsapp'), 40);
    const email = normalizeEmail(form.get('email'));
    const city = clean(form.get('city'), 90);
    const church = clean(form.get('church'), 140);
    const ministryRaw = clean(form.get('ministry'), 40);
    const ministry = allowedMinistries.has(ministryRaw) ? ministryRaw : 'no-estoy-seguro';
    const helpTypes = form
      .getAll('helpTypes')
      .map((item) => clean(item, 40))
      .filter((item) => allowedHelpTypes.has(item));
    const message = clean(form.get('message'), 700);
    const availabilityRaw = clean(form.get('availability'), 40);
    const availability = allowedAvailability.has(availabilityRaw) ? availabilityRaw : 'no-estoy-seguro';
    const origin = clean(form.get('origin'), 80);
    const place = clean(form.get('place'), 80);
    const utmSource = clean(form.get('utmSource'), 100);
    const utmMedium = clean(form.get('utmMedium'), 100);
    const utmCampaign = clean(form.get('utmCampaign'), 140);
    const qr = clean(form.get('qr'), 100);
    const path = String(form.get('path') || '').slice(0, 180).replace(/[^\w\-/?=&.]/g, '');
    const turnstileToken = String(form.get('cf-turnstile-response') || '');

    if (!fullName) {
      return new Response(JSON.stringify({ ok: false, error: 'El nombre es requerido.' }), { status: 400 });
    }

    if (whatsapp.replace(/\D/g, '').length < 7) {
      return new Response(JSON.stringify({ ok: false, error: 'Escribe un WhatsApp válido.' }), { status: 400 });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Escribe un correo válido.' }), { status: 400 });
    }

    const turnstileConfigured = Boolean(env('TURNSTILE_SECRET_KEY'));
    if (turnstileConfigured) {
      const okCaptcha = await verifyTurnstile(turnstileToken, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'ven-ayudanos.submit',
          ip: clientAddress,
          detail: 'Turnstile inválido',
        });
        return new Response(JSON.stringify({ ok: false, error: 'Captcha inválido.' }), { status: 400 });
      }
    }

    const allowed = await enforceRateLimit(`ven-ayudanos:${clientAddress ?? 'unknown'}`, 60, 4);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: `ven-ayudanos:${clientAddress ?? 'unknown'}`,
        ip: clientAddress,
        detail: 'Ven y Ayúdanos submit',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }), { status: 429 });
    }

    const payload = {
      full_name: fullName,
      whatsapp,
      email: email || null,
      city: city || null,
      church: church || null,
      ministry,
      help_types: helpTypes,
      message: message || null,
      availability,
      origin: origin || null,
      place: place || null,
      utm_source: utmSource || null,
      utm_medium: utmMedium || null,
      utm_campaign: utmCampaign || null,
      qr: qr || null,
      path: path || null,
      user_agent: request.headers.get('user-agent')?.slice(0, 400) || null,
    };

    let responseId: string | null = null;
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('ven_ayudanos_responses')
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        void logSecurityEvent({
          type: 'maintenance',
          identifier: 'ven-ayudanos.submit',
          ip: clientAddress,
          detail: 'Supabase insert error',
          meta: { error: error.message },
        });
        return new Response(JSON.stringify({ ok: false, error: 'No pudimos guardar tu respuesta. Intenta nuevamente.' }), { status: 500 });
      }

      responseId = data?.id || null;
    }

    void notifyTeam(payload);

    return new Response(JSON.stringify({ ok: true, id: responseId }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    void logSecurityEvent({
      type: 'maintenance',
      identifier: 'ven-ayudanos.submit',
      ip: clientAddress,
      detail: error?.message || 'Ven y Ayúdanos submit error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No pudimos procesar la respuesta.' }), { status: 500 });
  }
};
