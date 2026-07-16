import type { APIRoute } from 'astro';
import { getPublicDatabaseEvent } from '@lib/publicEvents';

export const prerender = false;

function escapeIcs(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .slice(0, 1800);
}

function utcIcsDate(value: unknown): string {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeFileName(value: unknown): string {
  const normalized = String(value ?? 'evento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'evento';
}

export const GET: APIRoute = async ({ params, url }) => {
  const identifier = String(params.id || '').trim().toLowerCase();
  const event = identifier ? await getPublicDatabaseEvent(identifier) : null;
  if (!event) {
    return new Response('Evento no disponible.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
    });
  }

  const start = utcIcsDate(event.start_date);
  const end = utcIcsDate(event.end_date || event.start_date);
  if (!start || !end) {
    return new Response('El evento todavía no tiene una fecha válida.', {
      status: 409,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
    });
  }

  const location = [event.location_name, event.location_address, event.city, event.country].filter(Boolean).join(', ');
  const publicPath = event.id === '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202'
    ? '/eventos/cumbre-mundial-2026'
    : `/eventos/${event.slug || event.id}`;
  const eventUrl = new URL(publicPath, url.origin).toString();
  const stamp = utcIcsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ministerio Mana//Eventos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.id)}@ministeriomana.org`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description || `Información e inscripción: ${eventUrl}`)}`,
    `LOCATION:${escapeIcs(location)}`,
    `URL:${escapeIcs(eventUrl)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];

  return new Response(lines.join('\r\n'), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${safeFileName(event.title)}.ics"`,
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-content-type-options': 'nosniff',
    },
  });
};
