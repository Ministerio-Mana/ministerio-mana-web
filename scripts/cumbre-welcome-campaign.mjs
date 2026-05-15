import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'docs', 'email-templates', 'sendgrid', 'cumbre_welcome_guide.html');

for (const envFile of ['.env.local', '.env.production.local', '.env', 'sendgrid-ids.env']) {
  loadEnv({ path: path.join(ROOT, envFile), override: false, quiet: true });
}

const DEFAULT_GUIDE_URL = 'https://ministeriomana.org/eventos/cumbre-mundial-2026/bienvenida';
const DEFAULT_LOGO_URL = 'https://ministeriomana.org/images/cumbre/cumbre-2026-logo-white.svg?v=20260514';
const DEFAULT_MAPS_URL = 'https://www.google.com/maps/place/De+La+Salle+Casa+de+Encuentros/data=!4m2!3m1!1s0x0:0x4e396d4a9a3349a5?sa=X&ved=1t:2428&ictx=111&cshid=1778777449001802';
const DEFAULT_WAZE_URL = 'https://www.waze.com/es/live-map/directions/co/antioquia/rionegro/de-la-salle-casa-de-encuentros?to=place.ChIJi_SE7SOfRo4RpUkzmkptOU4';
const DEFAULT_COMFAMA_URL = 'https://www.comfama.com/cultura-y-ocio/parques/parque-rionegro/';
const DEFAULT_REPLY_TO = ['info@ministeriomana.org', 'administracion@ministeriomana.org'];
const BLOCKED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'ANULADA', 'ANULADO', 'VOID', 'REFUNDED', 'EXPIRED']);
const SENDABLE_STATUSES = new Set(['DEPOSIT_OK', 'PAID']);

const PACKAGE_PRICES = {
  COP: {
    lodging: 850000,
    no_lodging: 660000,
    child_0_7: 300000,
    child_7_13: 550000,
  },
  USD: {
    lodging: 220,
    no_lodging: 170,
    child_0_7: 80,
    child_7_13: 140,
  },
};

const PACKAGE_LABELS = {
  lodging: 'Asistencia + alimentacion + alojamiento',
  no_lodging: 'Asistencia + alimentacion (sin alojamiento)',
  child_0_7: 'Nino 0-4',
  child_7_13: 'Nino 5-10',
};

const args = parseArgs(process.argv.slice(2));
const shouldSend = Boolean(args.send);
const includePending = Boolean(args['include-pending']);
const allowWarnings = Boolean(args['allow-warnings']);
const testEmail = typeof args['test-email'] === 'string' ? args['test-email'].trim() : '';
const testRecipients = toArray(args['test-recipient']).map(parseTestRecipient).filter((item) => item.email);
const isTestMode = Boolean(testEmail || testRecipients.length);
const limit = Number.parseInt(String(args.limit || ''), 10);
const previewHtmlPath = typeof args['preview-html'] === 'string' ? args['preview-html'] : '';
const auditJsonPath = typeof args['audit-json'] === 'string' ? args['audit-json'] : '';
const whatsappCsvPath = typeof args['whatsapp-csv'] === 'string' ? args['whatsapp-csv'] : '';
const participantsJsonPath = typeof args['participants-json'] === 'string' ? args['participants-json'] : '';
const bookingsCsvPath = typeof args['bookings-csv'] === 'string' ? args['bookings-csv'] : '';
const confirm = typeof args.confirm === 'string' ? args.confirm : '';

const config = {
  subject: process.env.CUMBRE_WELCOME_SUBJECT || 'Tu reserva y guia de bienvenida | Cumbre Mundial de Discipulado',
  appName: process.env.CUMBRE_EMAIL_APP_NAME || 'Cumbre Mundial de Discipulado',
  supportEmails: parseEmailList(process.env.CUMBRE_EMAIL_SUPPORTS || process.env.SENDGRID_REPLY_TO_LIST, DEFAULT_REPLY_TO),
  supportWhatsapp: process.env.CUMBRE_SUPPORT_WHATSAPP || '+57 314 829 7534',
  guideUrl: process.env.CUMBRE_WELCOME_GUIDE_URL || DEFAULT_GUIDE_URL,
  logoUrl: process.env.CUMBRE_WELCOME_LOGO_URL || DEFAULT_LOGO_URL,
  mapsUrl: process.env.CUMBRE_WELCOME_MAPS_URL || DEFAULT_MAPS_URL,
  wazeUrl: process.env.CUMBRE_WELCOME_WAZE_URL || DEFAULT_WAZE_URL,
  comfamaUrl: process.env.CUMBRE_COMFAMA_URL || DEFAULT_COMFAMA_URL,
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === '--send') {
      out.send = true;
      continue;
    }
    if (arg === '--include-pending') {
      out['include-pending'] = true;
      continue;
    }
    if (arg === '--allow-warnings') {
      out['allow-warnings'] = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function parseTestRecipient(value) {
  const [emailRaw, ...nameParts] = String(value || '').split('|');
  return {
    email: normalizeEmail(emailRaw),
    name: normalizeText(nameParts.join('|')),
  };
}

function env(key) {
  return process.env[key];
}

function parseEmailList(value, fallback = []) {
  const source = value ? String(value).split(/[,\s]+/) : fallback;
  return [...new Set(source.map(normalizeEmail).filter(isValidEmail))];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('57')) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  return `+${digits}`;
}

function whatsappUrl(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function status(value) {
  return normalizeText(value).toUpperCase();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyTolerance(currency) {
  return currency === 'COP' ? 100 : 0.5;
}

function amountsMatch(a, b, currency) {
  return Math.abs(numberValue(a) - numberValue(b)) <= moneyTolerance(currency);
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(2, user.length - visible.length))}@${domain}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function render(template, data) {
  const withRaw = template.replace(/{{{\s*([a-zA-Z0-9_]+)\s*}}}/g, (_, key) => String(data[key] ?? ''));
  return withRaw.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => escapeHtml(data[key] ?? ''));
}

function formatMoney(amount, currency) {
  const value = numberValue(amount);
  const safeCurrency = currency === 'USD' ? 'USD' : 'COP';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: safeCurrency,
    maximumFractionDigits: safeCurrency === 'COP' ? 0 : 2,
  }).format(value);
}

function firstName(fullName) {
  return normalizeText(fullName).split(/\s+/).filter(Boolean)[0] || '';
}

function packageLabel(value) {
  const raw = normalizeText(value).toLowerCase();
  return PACKAGE_LABELS[raw] || normalizeText(value) || 'Pendiente por revisar';
}

function lodgingLabel(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'lodging') return 'Con alojamiento';
  if (raw === 'no_lodging') return 'Sin alojamiento';
  if (raw === 'child_0_7' || raw === 'child_7_13') return 'Segun registro familiar';
  return 'Pendiente por revisar';
}

function menuLabel(value, packageType) {
  const raw = normalizeText(value).toUpperCase().replace(/\s+/g, ' ');
  if (raw === 'GENERAL' || raw === 'TRADICIONAL') return 'Tradicional';
  if (raw === 'VEGETARIAN' || raw === 'VEGETARIANO') return 'Vegetariano';
  if (raw === 'KIDS' || raw === 'INFANTIL') return 'Infantil';
  if (raw === 'SIN ALIMENTACION' || raw === 'SIN_ALIMENTACION') return 'Sin alimentacion';
  if (normalizeText(packageType).toLowerCase() === 'child_0_7') return 'Sin alimentacion';
  if (normalizeText(packageType).toLowerCase() === 'child_7_13') return 'Infantil';
  return raw || 'Pendiente por confirmar';
}

function packageTypeFromLabel(value) {
  const raw = normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (raw === 'lodging' || raw.includes('con alojamiento')) return 'lodging';
  if (raw === 'no_lodging' || raw.includes('sin alojamiento')) return 'no_lodging';
  if (raw === 'child_0_7' || raw.includes('0-4') || raw.includes('0 a 4')) return 'child_0_7';
  if (raw === 'child_7_13' || raw.includes('5-10') || raw.includes('5 a 10') || raw.includes('7-13')) return 'child_7_13';
  return normalizeText(value);
}

function dietTypeFromLabel(value) {
  const raw = normalizeText(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  if (raw === 'GENERAL' || raw === 'TRADICIONAL') return 'TRADICIONAL';
  if (raw === 'VEGETARIAN' || raw === 'VEGETARIANO') return 'VEGETARIANO';
  if (raw === 'KIDS' || raw === 'INFANTIL') return 'INFANTIL';
  if (raw === 'SIN ALIMENTACION' || raw === 'SIN_ALIMENTACION') return 'SIN ALIMENTACION';
  return raw;
}

function needsMenu(participant) {
  const type = normalizeText(participant?.package_type).toLowerCase();
  return type === 'lodging' || type === 'no_lodging';
}

function participantMissingItems(participant) {
  const missing = [];
  if (!normalizeText(participant?.full_name)) missing.push('nombre');
  if (!normalizeText(participant?.document_type) || !normalizeText(participant?.document_number)) missing.push('documento');
  if (!normalizeText(participant?.birthdate)) missing.push('fecha de nacimiento');
  if (!normalizeText(participant?.gender)) missing.push('genero');
  if (needsMenu(participant) && !normalizeText(participant?.diet_type)) missing.push('menu');
  return missing;
}

function expectedParticipantPrice(participant, currency) {
  const packageType = normalizeText(participant?.package_type).toLowerCase();
  return PACKAGE_PRICES[currency]?.[packageType] ?? null;
}

function expectedBookingTotal(participants, currency) {
  let total = 0;
  for (const participant of participants) {
    const price = expectedParticipantPrice(participant, currency);
    if (price == null) return null;
    total += price;
  }
  return total;
}

function isEligibleBooking(booking) {
  const bookingStatus = status(booking?.status);
  if (BLOCKED_STATUSES.has(bookingStatus)) return false;
  if (SENDABLE_STATUSES.has(bookingStatus)) return true;
  if (numberValue(booking?.total_paid) > 0) return true;
  return includePending && numberValue(booking?.total_amount) > 0;
}

function resolveReservationState(booking) {
  const currency = booking.currency === 'USD' ? 'USD' : 'COP';
  const totalAmount = numberValue(booking.total_amount);
  const totalPaid = numberValue(booking.total_paid);
  const depositThreshold = numberValue(booking.deposit_threshold) || (totalAmount > 0 ? totalAmount * 0.5 : 0);
  const balance = Math.max(totalAmount - totalPaid, 0);

  if (totalAmount > 0 && amountsMatch(balance, 0, currency)) {
    return {
      title: 'Reserva pagada en su totalidad',
      note: `Tenemos registrado el pago completo de ${formatMoney(totalAmount, currency)}.`,
      tone: 'paid',
    };
  }

  if (totalPaid > 0 && totalPaid + moneyTolerance(currency) >= depositThreshold) {
    return {
      title: 'Cupo confirmado con saldo pendiente',
      note: `Tenemos registrado ${formatMoney(totalPaid, currency)} de ${formatMoney(totalAmount, currency)}. Saldo pendiente: ${formatMoney(balance, currency)}.`,
      tone: 'partial',
    };
  }

  if (totalPaid > 0) {
    return {
      title: 'Pago parcial registrado',
      note: `Tenemos registrado ${formatMoney(totalPaid, currency)} de ${formatMoney(totalAmount, currency)}. Para confirmar completamente la reserva, revisa el saldo pendiente: ${formatMoney(balance, currency)}.`,
      tone: 'partial_unconfirmed',
    };
  }

  return {
    title: 'Reserva pendiente de pago',
    note: `Aun no vemos pagos registrados sobre el total de ${formatMoney(totalAmount, currency)}.`,
    tone: 'pending',
  };
}

function reservationBadge(tone) {
  if (tone === 'paid') return 'Pagada';
  if (tone === 'partial') return 'Confirmada';
  if (tone === 'partial_unconfirmed') return 'Parcial';
  return 'Pendiente';
}

function buildParticipantsHtml(participants) {
  if (!participants.length) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6edf3;border-radius:18px;background:#f9fbfc;"><tr><td style="padding:16px;color:#64748b;font-size:14px;">No hay participantes asignados a este correo.</td></tr></table>';
  }

  return participants.map((participant) => {
    const missing = participantMissingItems(participant);
    const missingText = missing.length ? `Pendiente: ${missing.join(', ')}` : 'Sin pendientes basicos registrados';
    const missingColor = missing.length ? '#b45309' : '#0f7a61';
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e4edf4;border-radius:20px;background:#f9fbfc;margin:0 0 10px;overflow:hidden;">
        <tr>
          <td style="padding:17px 18px 16px;">
            <p style="margin:0 0 4px;color:#10172f;font-size:18px;line-height:1.25;font-weight:900;">${escapeHtml(normalizeText(participant.full_name) || 'Participante sin nombre')}</p>
            <p style="margin:0 0 12px;color:#64748b;font-size:12px;line-height:1.4;">${escapeHtml(packageLabel(participant.package_type))}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td width="50%" style="padding:0 6px 8px 0;">
                  <p style="margin:0;color:#63709a;font-size:10px;letter-spacing:1.8px;text-transform:uppercase;font-weight:900;">Alojamiento</p>
                  <p style="margin:5px 0 0;color:#10172f;font-size:14px;font-weight:800;">${escapeHtml(lodgingLabel(participant.package_type))}</p>
                </td>
                <td width="50%" style="padding:0 0 8px 6px;">
                  <p style="margin:0;color:#63709a;font-size:10px;letter-spacing:1.8px;text-transform:uppercase;font-weight:900;">Menu</p>
                  <p style="margin:5px 0 0;color:#10172f;font-size:14px;font-weight:800;">${escapeHtml(menuLabel(participant.diet_type, participant.package_type))}</p>
                </td>
              </tr>
            </table>
            <p style="margin:4px 0 0;color:${missingColor};font-size:12px;line-height:1.45;font-weight:800;">${escapeHtml(missingText)}</p>
          </td>
        </tr>
      </table>
    `;
  }).join('');
}

function buildReviewNote(recipient) {
  const missing = recipient.participants
    .map((participant) => {
      const items = participantMissingItems(participant);
      return items.length ? `${normalizeText(participant.full_name) || 'Participante'}: ${items.join(', ')}` : '';
    })
    .filter(Boolean);

  if (missing.length) {
    return `Por favor revisa estos datos pendientes o por confirmar: ${missing.join(' | ')}. Si algo no coincide, responde este correo o comunicate con el equipo de la Cumbre antes del evento.`;
  }

  return 'Revisa cuidadosamente tu nombre, alojamiento, menu y estado de pago. Si ves una incoherencia o necesitas hacer un cambio, responde este correo para corregirlo antes de la Cumbre.';
}

function buildTemplateData(recipient) {
  const booking = recipient.booking;
  const currency = booking.currency === 'USD' ? 'USD' : 'COP';
  const state = resolveReservationState(booking);
  const totalAmount = numberValue(booking.total_amount);
  const totalPaid = numberValue(booking.total_paid);
  const balance = Math.max(totalAmount - totalPaid, 0);
  const displayName = normalizeText(recipient.name) || 'amado hermano';

  return {
    subject: config.subject,
    app_name: config.appName,
    full_name: displayName,
    first_name: firstName(displayName),
    greeting: `Hola ${displayName},`,
    hero_title: 'Tu guia de bienvenida',
    reservation_status: state.title,
    reservation_note: state.note,
    total_paid: formatMoney(totalPaid, currency),
    total_amount: formatMoney(totalAmount, currency),
    balance_due: formatMoney(balance, currency),
    reservation_badge: reservationBadge(state.tone),
    participants_html: buildParticipantsHtml(recipient.participants),
    review_note: buildReviewNote(recipient),
    guide_url: config.guideUrl,
    logo_url: config.logoUrl,
    maps_url: config.mapsUrl,
    waze_url: config.wazeUrl,
    comfama_url: config.comfamaUrl,
    support_email: config.supportEmails[0] || DEFAULT_REPLY_TO[0],
    support_emails: config.supportEmails.join(' y '),
    support_whatsapp: config.supportWhatsapp,
    support_whatsapp_url: whatsappUrl(config.supportWhatsapp),
  };
}

function buildTextEmail(recipient) {
  const data = buildTemplateData(recipient);
  const participantLines = recipient.participants.map((participant) => (
    `- ${normalizeText(participant.full_name) || 'Participante'} | ${packageLabel(participant.package_type)} | ${lodgingLabel(participant.package_type)} | Menu: ${menuLabel(participant.diet_type, participant.package_type)}`
  ));

  return [
    data.greeting,
    '',
    'Ya esta lista tu guia de bienvenida para la Cumbre Mundial de Discipulado.',
    '',
    `Estado de reserva: ${data.reservation_status}`,
    data.reservation_note,
    `Pagado: ${data.total_paid}`,
    `Total reserva: ${data.total_amount}`,
    `Saldo pendiente: ${data.balance_due}`,
    '',
    'Participantes registrados:',
    ...participantLines,
    '',
    'Fecha: 6 al 8 de junio',
    'Lugar: Casa de Encuentros La Salle, Rionegro, Antioquia',
    'Mesa de bienvenida: sabado desde las 7:00 a.m.',
    'Sabado en la tarde: Comfama Tutucan. Recomendamos llevar traje de bano para piscinas climatizadas.',
    'Lunes: almuerzo incluido y cierre de la Cumbre.',
    '',
    `Guia completa: ${config.guideUrl}`,
    `Google Maps: ${config.mapsUrl}`,
    `Waze: ${config.wazeUrl}`,
    '',
    `Si algo no coincide, responde este correo o escribe a ${config.supportEmails.join(' / ')}. WhatsApp ${config.supportWhatsapp}`,
  ].join('\n');
}

function buildSampleRecipient(email) {
  return buildSampleRecipientFor({
    email,
    name: 'Daniela Gomez Ramirez',
    bookingId: 'preview-cumbre-2026',
    totalAmount: 850000,
    totalPaid: 850000,
  });
}

function buildSampleRecipientFor({ email, name, bookingId, totalAmount, totalPaid }) {
  const fullName = normalizeText(name) || 'Asistente Cumbre';
  const booking = {
    id: bookingId,
    contact_name: fullName,
    contact_email: email,
    contact_phone: '+573148297534',
    currency: 'COP',
    total_amount: totalAmount,
    total_paid: totalPaid,
    deposit_threshold: totalAmount * 0.5,
    status: totalPaid >= totalAmount ? 'PAID' : 'DEPOSIT_OK',
    created_at: new Date().toISOString(),
  };
  const participants = [
    {
      id: `${bookingId}-p1`,
      booking_id: booking.id,
      full_name: fullName,
      email,
      package_type: 'lodging',
      relationship: 'Responsable',
      birthdate: '1991-05-20',
      gender: 'F',
      document_type: 'CC',
      document_number: '123456789',
      diet_type: 'TRADICIONAL',
    },
  ];
  return {
    email,
    name: fullName,
    phone: normalizePhone(booking.contact_phone),
    bookingId: booking.id,
    source: 'test',
    booking,
    participants,
  };
}

function bookingParticipantGroups(booking, participants) {
  const groups = new Map();
  const contactEmail = normalizeEmail(booking.contact_email);

  for (const participant of participants) {
    const participantEmail = normalizeEmail(participant.email);
    const email = participantEmail || contactEmail;
    if (!email) continue;
    const current = groups.get(email) || {
      email,
      participants: [],
      hasParticipantEmail: false,
    };
    current.participants.push(participant);
    current.hasParticipantEmail = current.hasParticipantEmail || Boolean(participantEmail);
    groups.set(email, current);
  }

  if (!participants.length && contactEmail) {
    groups.set(contactEmail, {
      email: contactEmail,
      participants: [],
      hasParticipantEmail: false,
    });
  }

  return [...groups.values()].map((group) => {
    const singleParticipantName = group.participants.length === 1 ? group.participants[0]?.full_name : '';
    const name = normalizeText(singleParticipantName) || normalizeText(booking.contact_name) || normalizeText(group.participants[0]?.full_name);
    return {
      email: group.email,
      name,
      phone: normalizePhone(booking.contact_phone),
      bookingId: booking.id,
      source: group.hasParticipantEmail ? 'participant' : 'booking',
      booking,
      participants: group.participants,
    };
  });
}

function auditBookings(bookings, participantsByBooking, paymentsByBooking) {
  const blockers = [];
  const warnings = [];

  for (const booking of bookings) {
    const bookingId = booking.id;
    const currency = booking.currency === 'USD' ? 'USD' : 'COP';
    const participants = participantsByBooking.get(bookingId) || [];
    const totalAmount = numberValue(booking.total_amount);
    const totalPaid = numberValue(booking.total_paid);

    if (!participants.length) {
      blockers.push({ booking_id: bookingId, issue: 'Reserva sin participantes registrados.' });
    }

    if (!normalizeEmail(booking.contact_email) && participants.every((participant) => !normalizeEmail(participant.email))) {
      warnings.push({ booking_id: bookingId, issue: 'Reserva sin correo de contacto ni correos de participantes. No se enviara email para esta reserva.' });
    }

    if (totalAmount <= 0) {
      blockers.push({ booking_id: bookingId, issue: `Total de reserva invalido: ${booking.total_amount}` });
    }

    if (totalPaid > totalAmount + moneyTolerance(currency)) {
      blockers.push({ booking_id: bookingId, issue: `Total pagado (${totalPaid}) supera el total de reserva (${totalAmount}).` });
    }

    const expectedTotal = expectedBookingTotal(participants, currency);
    if (expectedTotal == null) {
      blockers.push({ booking_id: bookingId, issue: 'Hay participantes con paquete desconocido.' });
    } else if (!amountsMatch(expectedTotal, totalAmount, currency)) {
      blockers.push({
        booking_id: bookingId,
        issue: `El total por paquetes (${expectedTotal}) no coincide con total_amount (${totalAmount}).`,
      });
    }

    const depositThreshold = numberValue(booking.deposit_threshold) || (totalAmount > 0 ? totalAmount * 0.5 : 0);
    const computedStatus = totalAmount > 0 && amountsMatch(totalPaid, totalAmount, currency)
      ? 'PAID'
      : totalPaid + moneyTolerance(currency) >= depositThreshold && depositThreshold > 0 ? 'DEPOSIT_OK' : 'PENDING';
    if (status(booking.status) && status(booking.status) !== computedStatus && !includePending) {
      warnings.push({
        booking_id: bookingId,
        issue: `Estado guardado ${booking.status} no coincide con el estado calculado ${computedStatus}.`,
      });
    }

    const payments = paymentsByBooking.get(bookingId) || [];
    const approvedTotal = payments
      .filter((payment) => status(payment.status) === 'APPROVED')
      .reduce((sum, payment) => sum + numberValue(payment.amount), 0);
    if (approvedTotal > 0 && !amountsMatch(approvedTotal, totalPaid, currency)) {
      warnings.push({
        booking_id: bookingId,
        issue: `Pagos APPROVED suman ${approvedTotal}, pero booking.total_paid es ${totalPaid}. Revisar pagos manuales o conciliacion.`,
      });
    }

    for (const participant of participants) {
      if (!normalizeText(participant.full_name)) {
        blockers.push({ booking_id: bookingId, participant_id: participant.id, issue: 'Participante sin nombre.' });
      }
      if (!normalizeEmail(participant.email) && !normalizeEmail(booking.contact_email)) {
        warnings.push({ booking_id: bookingId, participant_id: participant.id, issue: 'Participante sin correo ni correo de contacto. No se enviara email para este participante.' });
      }
      const missing = participantMissingItems(participant);
      if (missing.length) {
        warnings.push({
          booking_id: bookingId,
          participant_id: participant.id,
          issue: `${participant.full_name || 'Participante'} tiene datos pendientes: ${missing.join(', ')}.`,
        });
      }
    }
  }

  return { blockers, warnings };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.some((value) => normalizeText(value)))
    .map((dataRow) => Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ''])));
}

async function loadRecipientsFromExports() {
  if (!participantsJsonPath || !bookingsCsvPath) return null;

  const [participantsText, bookingsText] = await Promise.all([
    fs.readFile(path.resolve(ROOT, participantsJsonPath), 'utf8'),
    fs.readFile(path.resolve(ROOT, bookingsCsvPath), 'utf8'),
  ]);

  const participantRows = JSON.parse(participantsText);
  if (!Array.isArray(participantRows)) {
    throw new Error('El archivo --participants-json no contiene un arreglo JSON.');
  }

  const bookingRows = parseCsv(bookingsText);
  const bookingsById = new Map();
  const paymentsByBooking = new Map();

  for (const row of bookingRows) {
    const bookingId = normalizeText(row.booking_id);
    if (!bookingId) continue;
    if (!bookingsById.has(bookingId)) {
      bookingsById.set(bookingId, {
        id: bookingId,
        contact_name: normalizeText(row.contact_name),
        contact_email: normalizeEmail(row.contact_email),
        contact_phone: normalizeText(row.contact_phone),
        currency: normalizeText(row.currency) || 'COP',
        total_amount: numberValue(row.total_amount),
        total_paid: numberValue(row.total_paid),
        deposit_threshold: numberValue(row.deposit_threshold),
        status: normalizeText(row.booking_status),
        created_at: normalizeText(row.booking_created_at),
      });
    }

    const paymentId = normalizeText(row.payment_id);
    if (paymentId) {
      const list = paymentsByBooking.get(bookingId) || [];
      if (!list.some((payment) => payment.id === paymentId)) {
        list.push({
          id: paymentId,
          booking_id: bookingId,
          amount: numberValue(row.payment_amount),
          currency: normalizeText(row.payment_currency) || normalizeText(row.currency) || 'COP',
          status: normalizeText(row.payment_status),
          created_at: normalizeText(row.payment_created_at),
        });
        paymentsByBooking.set(bookingId, list);
      }
    }
  }

  const participantsByBooking = new Map();
  for (const [index, row] of participantRows.entries()) {
    const bookingId = normalizeText(row.booking_id);
    if (!bookingId) continue;
    const participant = {
      id: normalizeText(row.participant_id) || `${bookingId}-${index + 1}`,
      booking_id: bookingId,
      full_name: normalizeText(row.participante_nombre),
      email: normalizeEmail(row.email),
      package_type: packageTypeFromLabel(row.tipo_alojamiento),
      relationship: normalizeText(row.es_responsable_pago).toUpperCase() === 'SI'
        ? 'Responsable'
        : normalizeText(row.participant_relationship),
      birthdate: normalizeText(row.fecha_nacimiento),
      gender: normalizeText(row.sexo),
      nationality: normalizeText(row.pais_origen),
      document_type: normalizeText(row.documento_tipo),
      document_number: normalizeText(row.documento_numero),
      room_preference: '',
      diet_type: dietTypeFromLabel(row.alimentacion),
      diet_notes: '',
      created_at: normalizeText(row.fecha_inscripcion),
    };
    const list = participantsByBooking.get(bookingId) || [];
    list.push(participant);
    participantsByBooking.set(bookingId, list);
  }

  for (const row of participantRows) {
    const bookingId = normalizeText(row.booking_id);
    if (!bookingId || bookingsById.has(bookingId)) continue;
    bookingsById.set(bookingId, {
      id: bookingId,
      contact_name: normalizeText(row.titular_reserva),
      contact_email: normalizeEmail(row.email),
      contact_phone: normalizeText(row.telefono),
      currency: normalizeText(row.proximo_pago_moneda) || 'COP',
      total_amount: 0,
      total_paid: numberValue(row.valor_pagado_total),
      deposit_threshold: 0,
      status: '',
      created_at: normalizeText(row.fecha_inscripcion),
    });
  }

  const eligibleBookings = [...bookingsById.values()].filter((booking) => (
    participantsByBooking.has(booking.id) && isEligibleBooking(booking)
  ));
  const audit = auditBookings(eligibleBookings, participantsByBooking, paymentsByBooking);
  const recipients = [];
  const emailBookingCount = new Map();

  for (const booking of eligibleBookings) {
    const groups = bookingParticipantGroups(booking, participantsByBooking.get(booking.id) || []);
    for (const recipient of groups) {
      if (!isValidEmail(recipient.email)) {
        audit.blockers.push({ booking_id: booking.id, issue: `Correo invalido: ${recipient.email || '(vacio)'}` });
        continue;
      }
      emailBookingCount.set(recipient.email, (emailBookingCount.get(recipient.email) || 0) + 1);
      recipients.push(recipient);
    }
  }

  for (const [email, count] of emailBookingCount.entries()) {
    if (count > 1) {
      audit.warnings.push({ email, issue: `El correo ${email} aparece en ${count} reservas elegibles. Recibira un correo por reserva.` });
    }
  }

  const limitedRecipients = Number.isFinite(limit) && limit > 0 ? recipients.slice(0, limit) : recipients;
  return {
    recipients: limitedRecipients,
    audit,
    skipped: { ineligibleBookings: bookingsById.size - eligibleBookings.length },
  };
}

async function loadRecipients() {
  if (isTestMode) {
    const items = testRecipients.length
      ? testRecipients
      : [{ email: normalizeEmail(testEmail), name: 'Daniela Gomez Ramirez' }];
    const recipients = items.map((item, index) => buildSampleRecipientFor({
      email: item.email,
      name: item.name,
      bookingId: `preview-cumbre-2026-${index + 1}`,
      totalAmount: 850000,
      totalPaid: 850000,
    }));
    return {
      recipients,
      audit: { blockers: [], warnings: [] },
      skipped: { ineligibleBookings: 0 },
    };
  }

  const exportRecipients = await loadRecipientsFromExports();
  if (exportRecipients) return exportRecipients;

  const supabaseUrl = env('SUPABASE_URL') || env('PUBLIC_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE') || env('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para leer asistentes.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data: bookings, error: bookingsError } = await supabase
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, currency, total_amount, total_paid, status, deposit_threshold, created_at')
    .order('created_at', { ascending: true });

  if (bookingsError) throw new Error(`Supabase bookings error: ${bookingsError.message}`);

  const eligibleBookings = (bookings || []).filter(isEligibleBooking);
  const bookingIds = eligibleBookings.map((booking) => booking.id);
  if (!bookingIds.length) {
    return {
      recipients: [],
      audit: { blockers: [], warnings: [] },
      skipped: { ineligibleBookings: (bookings || []).length },
    };
  }

  const { data: participants, error: participantsError } = await supabase
    .from('cumbre_participants')
    .select('id, booking_id, full_name, email, package_type, relationship, birthdate, gender, nationality, document_type, document_number, room_preference, diet_type, diet_notes, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true });

  if (participantsError) throw new Error(`Supabase participants error: ${participantsError.message}`);

  const { data: payments, error: paymentsError } = await supabase
    .from('cumbre_payments')
    .select('id, booking_id, amount, currency, status, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true });

  if (paymentsError) throw new Error(`Supabase payments error: ${paymentsError.message}`);

  const participantsByBooking = new Map();
  for (const participant of participants || []) {
    const list = participantsByBooking.get(participant.booking_id) || [];
    list.push(participant);
    participantsByBooking.set(participant.booking_id, list);
  }

  const paymentsByBooking = new Map();
  for (const payment of payments || []) {
    const list = paymentsByBooking.get(payment.booking_id) || [];
    list.push(payment);
    paymentsByBooking.set(payment.booking_id, list);
  }

  const audit = auditBookings(eligibleBookings, participantsByBooking, paymentsByBooking);
  const recipients = [];
  const emailBookingCount = new Map();

  for (const booking of eligibleBookings) {
    const groups = bookingParticipantGroups(booking, participantsByBooking.get(booking.id) || []);
    for (const recipient of groups) {
      if (!isValidEmail(recipient.email)) {
        audit.blockers.push({ booking_id: booking.id, issue: `Correo invalido: ${recipient.email || '(vacio)'}` });
        continue;
      }
      emailBookingCount.set(recipient.email, (emailBookingCount.get(recipient.email) || 0) + 1);
      recipients.push(recipient);
    }
  }

  for (const [email, count] of emailBookingCount.entries()) {
    if (count > 1) {
      audit.warnings.push({ email, issue: `El correo ${email} aparece en ${count} reservas elegibles. Recibira un correo por reserva.` });
    }
  }

  const limitedRecipients = Number.isFinite(limit) && limit > 0 ? recipients.slice(0, limit) : recipients;
  return {
    recipients: limitedRecipients,
    audit,
    skipped: { ineligibleBookings: (bookings || []).length - eligibleBookings.length },
  };
}

function sendgridReplyToPayload() {
  const replyTo = parseEmailList(env('SENDGRID_REPLY_TO') || env('AUTH_EMAIL_REPLY_TO') || env('CUMBRE_EMAIL_SUPPORT'), []);
  const replyToList = config.supportEmails.length ? config.supportEmails : replyTo;
  if (replyToList.length > 1) {
    return {
      reply_to_list: replyToList.map((email) => ({ email })),
    };
  }
  const single = replyToList[0] || replyTo[0];
  return single ? { reply_to: { email: single } } : {};
}

async function sendEmail(recipient, htmlTemplate) {
  const apiKey = env('SENDGRID_API_KEY');
  const from = env('SENDGRID_FROM') || env('AUTH_EMAIL_FROM') || env('CUMBRE_EMAIL_FROM');
  if (!apiKey || !from) {
    throw new Error('Faltan SENDGRID_API_KEY y SENDGRID_FROM/CUMBRE_EMAIL_FROM.');
  }

  const html = render(htmlTemplate, buildTemplateData(recipient));
  const payload = {
    subject: config.subject,
    personalizations: [{
      to: [{ email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) }],
      subject: config.subject,
      custom_args: {
        campaign: 'cumbre_welcome_guide',
        booking_id: recipient.bookingId,
        source: recipient.source,
      },
    }],
    from: { email: from, name: 'Ministerio Mana' },
    ...sendgridReplyToPayload(),
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
    ['name', 'phone', 'booking_id', 'message'].join(','),
    ...recipients
      .filter((recipient) => recipient.phone)
      .map((recipient) => {
        const message = `Hola ${recipient.name || ''}, ya esta lista tu guia de bienvenida para la Cumbre Mundial de Discipulado: ${config.guideUrl}`.trim();
        return [recipient.name, recipient.phone, recipient.bookingId, message]
          .map((value) => `"${String(value || '').replaceAll('"', '""')}"`)
          .join(',');
      }),
  ];
  await fs.writeFile(path.resolve(ROOT, whatsappCsvPath), `${rows.join('\n')}\n`, 'utf8');
}

async function writeAuditJson(recipients, audit, skipped) {
  if (!auditJsonPath) return;
  const payload = {
    generated_at: new Date().toISOString(),
    campaign: 'cumbre_welcome_guide',
    recipients: recipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name,
      booking_id: recipient.bookingId,
      source: recipient.source,
      participants: recipient.participants.map((participant) => ({
        id: participant.id,
        full_name: participant.full_name,
        package_type: participant.package_type,
        diet_type: participant.diet_type,
      })),
    })),
    audit,
    skipped,
  };
  await fs.writeFile(path.resolve(ROOT, auditJsonPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function printAudit(audit) {
  if (audit.blockers.length) {
    console.log(`Bloqueos de datos: ${audit.blockers.length}`);
    for (const item of audit.blockers.slice(0, 12)) {
      console.log(`  - ${item.booking_id || item.email || 'sin-id'}: ${item.issue}`);
    }
    if (audit.blockers.length > 12) console.log(`  - ... ${audit.blockers.length - 12} bloqueos adicionales`);
  }

  if (audit.warnings.length) {
    console.log(`Advertencias de datos: ${audit.warnings.length}`);
    for (const item of audit.warnings.slice(0, 12)) {
      console.log(`  - ${item.booking_id || item.email || 'sin-id'}: ${item.issue}`);
    }
    if (audit.warnings.length > 12) console.log(`  - ... ${audit.warnings.length - 12} advertencias adicionales`);
  }
}

async function main() {
  if (shouldSend && !isTestMode && confirm !== 'ENVIAR') {
    throw new Error('Para envio masivo usa --send --confirm=ENVIAR. Para prueba: --test-email=correo@dominio.com --send');
  }

  const htmlTemplate = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const { recipients, audit, skipped } = await loadRecipients();
  const sample = recipients.slice(0, 8).map((recipient) => {
    const participantsLabel = recipient.participants.length === 1 ? '1 participante' : `${recipient.participants.length} participantes`;
    return `${recipient.name || 'Sin nombre'} <${maskEmail(recipient.email)}> (${participantsLabel})`;
  }).join('\n  - ');

  console.log(`Campana: ${config.subject}`);
  console.log(`Destinatarios email: ${recipients.length}`);
  console.log(`Reservas omitidas por estado/filtro: ${skipped.ineligibleBookings}`);
  if (sample) console.log(`Muestra:\n  - ${sample}`);
  console.log(`Modo: ${shouldSend ? 'ENVIO' : 'DRY-RUN'}`);
  printAudit(audit);

  if (previewHtmlPath) {
    const previewRecipient = recipients[0] || buildSampleRecipient('preview@ministeriomana.org');
    const html = render(htmlTemplate, buildTemplateData(previewRecipient));
    await fs.writeFile(path.resolve(ROOT, previewHtmlPath), html, 'utf8');
    console.log(`Preview HTML: ${previewHtmlPath}`);
  }

  await writeAuditJson(recipients, audit, skipped);
  if (auditJsonPath) console.log(`Auditoria JSON: ${auditJsonPath}`);

  await writeWhatsappCsv(recipients);
  if (whatsappCsvPath) console.log(`CSV WhatsApp: ${whatsappCsvPath}`);

  if (shouldSend && audit.blockers.length) {
    throw new Error('Envio bloqueado: hay datos que pueden producir correos incorrectos. Corrige los bloqueos antes de enviar.');
  }
  if (shouldSend && !isTestMode && audit.warnings.length && !allowWarnings) {
    throw new Error('Envio bloqueado por advertencias. Revisa la auditoria y, solo si estan aceptadas, usa --allow-warnings.');
  }

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
