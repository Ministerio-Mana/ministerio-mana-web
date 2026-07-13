export const DEFAULT_EVENT_TIMEZONE = 'America/Bogota';
export const DEFAULT_EVENT_ATTENDANCE_MODE = 'IN_PERSON';

export const EVENT_TIMEZONES = Object.freeze([
  'America/Bogota', 'America/Guayaquil', 'America/Mexico_City', 'America/Panama',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/Madrid', 'Europe/Paris', 'Australia/Sydney', 'UTC',
]);
export const EVENT_ATTENDANCE_MODES = Object.freeze(['IN_PERSON', 'ONLINE', 'HYBRID']);

const EVENT_TIMEZONE_ALIASES = new Map([
  ['AMERICABOGOTA', DEFAULT_EVENT_TIMEZONE], ['BOGOTA', DEFAULT_EVENT_TIMEZONE], ['COLOMBIABOGOTA', DEFAULT_EVENT_TIMEZONE],
  ['AMERICAGUAYAQUIL', 'America/Guayaquil'], ['ECUADORGUAYAQUIL', 'America/Guayaquil'],
  ['AMERICAMEXICOCITY', 'America/Mexico_City'], ['MEXICOCIUDADDEMEXICO', 'America/Mexico_City'],
  ['AMERICAPANAMA', 'America/Panama'], ['CENTROAMERICAPANAMA', 'America/Panama'],
  ['AMERICANEWYORK', 'America/New_York'], ['ESTADOSUNIDOSESTE', 'America/New_York'],
  ['AMERICACHICAGO', 'America/Chicago'], ['ESTADOSUNIDOSCENTRO', 'America/Chicago'],
  ['AMERICADENVER', 'America/Denver'], ['ESTADOSUNIDOSMONTANA', 'America/Denver'],
  ['AMERICALOSANGELES', 'America/Los_Angeles'], ['ESTADOSUNIDOSPACIFICO', 'America/Los_Angeles'],
  ['EUROPEMADRID', 'Europe/Madrid'], ['EUROPAMADRID', 'Europe/Madrid'],
  ['EUROPEPARIS', 'Europe/Paris'], ['EUROPAPARIS', 'Europe/Paris'],
  ['AUSTRALIASYDNEY', 'Australia/Sydney'], ['AUSTRALIASIDNEY', 'Australia/Sydney'], ['UTC', 'UTC'],
]);

const EVENT_ATTENDANCE_MODE_ALIASES = new Map([
  ['INPERSON', 'IN_PERSON'], ['IN_PERSON', 'IN_PERSON'], ['ON_SITE', 'IN_PERSON'], ['ONSITE', 'IN_PERSON'],
  ['PRESENCIAL', 'IN_PERSON'], ['PRESENTIAL', 'IN_PERSON'], ['ONLINE', 'ONLINE'], ['VIRTUAL', 'ONLINE'],
  ['HYBRID', 'HYBRID'], ['HIBRIDO', 'HYBRID'],
]);

function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeEventTimeZone(value, fallback = '') {
  const raw = String(value || '').trim().slice(0, 80);
  if (!raw) return fallback;
  const key = stripDiacritics(raw).toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return EVENT_TIMEZONE_ALIASES.get(key) || raw;
}

export function normalizeAttendanceMode(value, fallback = '') {
  const normalized = stripDiacritics(value).trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return EVENT_ATTENDANCE_MODE_ALIASES.get(normalized) || fallback || normalized;
}

export function isValidEventTimeZone(value) {
  const timezone = normalizeEventTimeZone(value);
  if (!EVENT_TIMEZONES.includes(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
