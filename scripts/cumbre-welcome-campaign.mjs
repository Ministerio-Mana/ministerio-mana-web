import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'email-templates', 'sendgrid', 'cumbre_welcome_guide.html');

for (const envFile of ['.env.local', '.env', 'sendgrid-ids.env']) {
  loadEnv({ path: path.join(ROOT, envFile), override: false, quiet: true });
}

const DEFAULT_GUIDE_URL = 'https://ministeriomana.org/eventos/cumbre-mundial-2026/bienvenida';
const DEFAULT_LOGO_URL = 'https://ministeriomana.org/images/cumbre/cumbre-2026-logo-white.svg';
const DEFAULT_MAPS_URL = 'https://www.google.com/maps/place/De+La+Salle+Casa+de+Encuentros/data=!4m2!3m1!1s0x0:0x4e396d4a9a3349a5?sa=X&ved=1t:2428&ictx=111&cshid=1778777449001802';
const DEFAULT_WAZE_URL = 'https://www.waze.com/es/live-map/directions/co/antioquia/rionegro/de-la-salle-casa-de-encuentros?to=place.ChIJi_SE7SOfRo4RpUkzmkptOU4';

const args = parseArgs(process.argv.slice(2));
const shouldSend = Boolean(args.send);
const testEmail = typeof args['test-email'] === 'string' ? args['test-email'].trim() : '';
const limit = Number.parseInt(String(args.limit || ''), 10);
const previewHtmlPath = typeof args['preview-html'] === 'string' ? args['preview-html'] : '';
const whatsappCsvPath = typeof args['whatsapp-csv'] === 'string' ? args['whatsapp-csv'] : '';
const confirm = typeof args.confirm === 'string' ? args.confirm : '';

const config = {
  subject: process.env.CUMBRE_WELCOME_SUBJECT || 'Guia de bienvenida | Cumbre Mundial de Discipulado',
  appName: process.env.CUMBRE_EMAIL_APP_NAME || 'Cumbre Mundial de Discipulado',
  supportEmail: process.env.CUMBRE_EMAIL_SUPPORT || 'info@ministeriomana.org',
  supportWhatsapp: process.env.CUMBRE_SUPPORT_WHATSAPP || '+57 314 829 7534',
  guideUrl: process.env.CUMBRE_WELCOME_GUIDE_URL || DEFAULT_GUIDE_URL,
  logoUrl: process.env.CUMBRE_WELCOME_LOGO_URL || DEFAULT_LOGO_URL,
  mapsUrl: process.env.CUMBRE_WELCOME_MAPS_URL || DEFAULT_MAPS_URL,
  wazeUrl: process.env.CUMBRE_WELCOME_WAZE_URL || DEFAULT_WAZE_URL,
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === '--send') {
      out.send = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function env(key) {
  return process.env[key];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57')) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  return `+${digits}`;
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(2, user.length - visible.length))}@${domain}`;
}

function isEligibleBooking(booking) {
  const totalPaid = Number(booking?.total_paid || 0);
  const status = String(booking?.status || '').toUpperCase();
  return totalPaid > 0 || status === 'DEPOSIT_OK' || status === 'PAID';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function render(template, data) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => escapeHtml(data[key] ?? ''));
}

function buildTextEmail(recipient) {
  return [
    `${recipient.greeting}`,
    '',
    'Ya esta lista la guia de bienvenida para la Cumbre Mundial de Discipulado.',
    '',
    'Fecha: 6 al 8 de junio',
    'Lugar: Casa de Encuentros La Salle, Rionegro, Antioquia',
    '',
    `Guia: ${config.guideUrl}`,
    `Google Maps: ${config.mapsUrl}`,
    `Waze: ${config.wazeUrl}`,
    '',
    'Te recomendamos revisar la ruta antes de salir y venir con un corazon dispuesto.',
    '',
    `Ayuda: ${config.supportEmail} | WhatsApp ${config.supportWhatsapp}`,
  ].join('\n');
}

function buildTemplateData(recipient) {
  return {
    subject: config.subject,
    app_name: config.appName,
    full_name: recipient.name,
    greeting: recipient.greeting,
    guide_url: config.guideUrl,
    logo_url: config.logoUrl,
    maps_url: config.mapsUrl,
    waze_url: config.wazeUrl,
    support_email: config.supportEmail,
    support_whatsapp: config.supportWhatsapp,
  };
}

async function loadRecipients() {
  if (testEmail) {
    return [{
      email: normalizeEmail(testEmail),
      name: 'Equipo Mana',
      greeting: 'Hola,',
      phone: '',
      bookingId: 'test',
      source: 'test',
    }];
  }

  const supabaseUrl = env('SUPABASE_URL') || env('PUBLIC_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE') || env('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para leer asistentes.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data: bookings, error: bookingsError } = await supabase
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, total_paid, status, created_at')
    .order('created_at', { ascending: true });

  if (bookingsError) throw new Error(`Supabase bookings error: ${bookingsError.message}`);

  const eligibleBookings = (bookings || []).filter(isEligibleBooking);
  const bookingIds = eligibleBookings.map((booking) => booking.id);
  if (!bookingIds.length) return [];

  const { data: participants, error: participantsError } = await supabase
    .from('cumbre_participants')
    .select('id, booking_id, full_name, email, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true });

  if (participantsError) throw new Error(`Supabase participants error: ${participantsError.message}`);

  const participantsByBooking = new Map();
  for (const participant of participants || []) {
    const list = participantsByBooking.get(participant.booking_id) || [];
    list.push(participant);
    participantsByBooking.set(participant.booking_id, list);
  }

  const recipientsByEmail = new Map();
  for (const booking of eligibleBookings) {
    const bookingParticipants = participantsByBooking.get(booking.id) || [];
    const participantRecipients = bookingParticipants
      .map((participant) => ({
        email: normalizeEmail(participant.email),
        name: String(participant.full_name || booking.contact_name || '').trim(),
        phone: normalizePhone(booking.contact_phone),
        bookingId: booking.id,
        source: 'participant',
      }))
      .filter((item) => item.email);

    const bookingRecipients = participantRecipients.length
      ? participantRecipients
      : [{
          email: normalizeEmail(booking.contact_email),
          name: String(booking.contact_name || '').trim(),
          phone: normalizePhone(booking.contact_phone),
          bookingId: booking.id,
          source: 'booking',
        }];

    for (const item of bookingRecipients) {
      if (!item.email || recipientsByEmail.has(item.email)) continue;
      recipientsByEmail.set(item.email, {
        ...item,
        greeting: item.name ? `Hola ${item.name},` : 'Hola,',
      });
    }
  }

  const recipients = [...recipientsByEmail.values()];
  return Number.isFinite(limit) && limit > 0 ? recipients.slice(0, limit) : recipients;
}

async function sendEmail(recipient, htmlTemplate) {
  const apiKey = env('SENDGRID_API_KEY');
  const from = env('SENDGRID_FROM') || env('AUTH_EMAIL_FROM') || env('CUMBRE_EMAIL_FROM');
  const replyTo = env('SENDGRID_REPLY_TO') || env('AUTH_EMAIL_REPLY_TO') || env('CUMBRE_EMAIL_SUPPORT');
  if (!apiKey || !from) {
    throw new Error('Faltan SENDGRID_API_KEY y SENDGRID_FROM/CUMBRE_EMAIL_FROM.');
  }

  const html = render(htmlTemplate, {
    ...buildTemplateData(recipient),
  });

  const payload = {
    subject: config.subject,
    personalizations: [{
      to: [{ email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) }],
      subject: config.subject,
      custom_args: {
        campaign: 'cumbre_welcome_guide',
        booking_id: recipient.bookingId,
      },
    }],
    from: { email: from, name: 'Ministerio Mana' },
    ...(replyTo ? { reply_to: { email: replyTo } } : {}),
    categories: ['cumbre_welcome_guide'],
    content: [
      { type: 'text/plain', value: buildTextEmail(recipient) },
      { type: 'text/html', value: html },
    ],
  };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`SendGrid ${res.status}: ${detail || res.statusText}`);
  }
}

async function writeWhatsappCsv(recipients) {
  if (!whatsappCsvPath) return;
  const rows = [
    ['name', 'phone', 'message'].join(','),
    ...recipients
      .filter((recipient) => recipient.phone)
      .map((recipient) => {
        const message = `Hola ${recipient.name || ''}, ya esta lista la guia de bienvenida para la Cumbre Mundial de Discipulado: ${config.guideUrl}`.trim();
        return [recipient.name, recipient.phone, message]
          .map((value) => `"${String(value || '').replaceAll('"', '""')}"`)
          .join(',');
      }),
  ];
  await fs.writeFile(path.resolve(ROOT, whatsappCsvPath), `${rows.join('\n')}\n`, 'utf8');
}

async function main() {
  if (shouldSend && !testEmail && confirm !== 'ENVIAR') {
    throw new Error('Para envio masivo usa --send --confirm=ENVIAR. Para prueba: --test-email=correo@dominio.com --send');
  }

  const htmlTemplate = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const recipients = await loadRecipients();
  const sample = recipients.slice(0, 8).map((recipient) => `${recipient.name || 'Sin nombre'} <${maskEmail(recipient.email)}>`).join('\n  - ');

  console.log(`Campana: ${config.subject}`);
  console.log(`Destinatarios email: ${recipients.length}`);
  if (sample) console.log(`Muestra:\n  - ${sample}`);
  console.log(`Modo: ${shouldSend ? 'ENVIO' : 'DRY-RUN'}`);

  if (previewHtmlPath) {
    const previewRecipient = recipients[0] || {
      name: 'Equipo Mana',
      greeting: 'Hola,',
      email: 'preview@ministeriomana.org',
      bookingId: 'preview',
    };
    const html = render(htmlTemplate, {
      ...buildTemplateData(previewRecipient),
    });
    await fs.writeFile(path.resolve(ROOT, previewHtmlPath), html, 'utf8');
    console.log(`Preview HTML: ${previewHtmlPath}`);
  }

  await writeWhatsappCsv(recipients);
  if (whatsappCsvPath) console.log(`CSV WhatsApp: ${whatsappCsvPath}`);

  if (!shouldSend) {
    console.log('No se envio nada. Agrega --send para prueba o --send --confirm=ENVIAR para envio masivo.');
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      await sendEmail(recipient, htmlTemplate);
      sent += 1;
      console.log(`OK ${sent}/${recipients.length}: ${maskEmail(recipient.email)}`);
      await new Promise((resolve) => setTimeout(resolve, 160));
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${maskEmail(recipient.email)}: ${err.message}`);
    }
  }
  console.log(`Resultado: enviados=${sent}, fallidos=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
