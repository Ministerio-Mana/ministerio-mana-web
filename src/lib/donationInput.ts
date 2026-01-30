import { sanitizePlainText, containsBlockedSequence } from './validation';
import { safeCountry } from './donations';
import { normalizeCityName, normalizeChurchName } from './normalization';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DONATION_TYPES = new Set([
  'diezmos',
  'ofrendas',
  'misiones',
  'campus',
  'evento',
  'general',
]);

const DOCUMENT_TYPES = new Set(['CC', 'CE', 'NIT', 'TI', 'PAS']);

function readText(form: FormData, key: string, max = 120): string {
  return sanitizePlainText(form.get(key)?.toString() ?? '', max);
}

export function normalizeDonationType(raw: string): string | null {
  const value = (raw || '').toString().trim().toLowerCase();
  return DONATION_TYPES.has(value) ? value : null;
}

export function normalizeDocumentType(raw: string): string | null {
  const value = (raw || '').toString().trim().toUpperCase();
  return DOCUMENT_TYPES.has(value) ? value : null;
}

export function parseDonationFormBase(form: FormData, defaultCountry: string): {
  fullName: string;
  email: string;
  phone: string;
  documentType: string;
  documentNumber: string;
  country: string;
  city: string;
  church: string;
  campus: string;
  donationType: string;
  projectName: string;
  eventName: string;
} {
  const fullName = readText(form, 'fullName', 120);
  const email = (form.get('email')?.toString() ?? '').trim().toLowerCase();
  const phone = readText(form, 'phone', 30);
  const documentType = normalizeDocumentType(form.get('documentType')?.toString() ?? '') || '';
  const documentNumber = readText(form, 'documentNumber', 40);
  const country = safeCountry(form.get('country')?.toString()) ?? defaultCountry;
  const city = normalizeCityName(form.get('city')?.toString() ?? '');
  const church = normalizeChurchName(form.get('church')?.toString() ?? '');
  const campus = normalizeChurchName(form.get('campus')?.toString() ?? '');
  const donationType = normalizeDonationType(form.get('donationType')?.toString() ?? '') || '';
  const projectName = readText(form, 'projectName', 120);
  const eventName = readText(form, 'eventName', 120);

  const blocked = [fullName, email, phone, documentNumber, church, campus, projectName, eventName]
    .some((value) => containsBlockedSequence(value));
  if (blocked) {
    throw new Error('Datos invalidos');
  }

  if (!fullName) throw new Error('Nombre requerido');
  if (!email || !EMAIL_REGEX.test(email)) throw new Error('Email invalido');
  if (!phone) throw new Error('Telefono requerido');
  if (!documentType) throw new Error('Tipo de documento requerido');
  if (!documentNumber) throw new Error('Documento requerido');
  if (!city) throw new Error('Ciudad requerida');
  if (!church && !campus) throw new Error('Iglesia o campus requerido');
  if (!donationType) throw new Error('Tipo de donacion requerido');
  if (!projectName) throw new Error('Proyecto requerido');
  if (!eventName) throw new Error('Evento requerido');

  return {
    fullName,
    email,
    phone,
    documentType,
    documentNumber,
    country,
    city,
    church,
    campus,
    donationType,
    projectName,
    eventName,
  };
}
