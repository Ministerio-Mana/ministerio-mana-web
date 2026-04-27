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
  'peregrinaciones',
  'general',
]);

export const DOCUMENT_TYPES_CO = new Set(['CC', 'CE', 'NIT', 'TI', 'PAS']);
export const DOCUMENT_TYPES_INTL = new Set(['PAS', 'NID', 'ID', 'DL', 'OTRO']);
export const DOCUMENT_TYPES_ANY = new Set([...DOCUMENT_TYPES_CO, ...DOCUMENT_TYPES_INTL]);
const DEFAULT_VIRTUAL_CHURCH = 'Ministerio Maná Virtual';

function readText(form: FormData, key: string, max = 120): string {
  return sanitizePlainText(form.get(key)?.toString() ?? '', max);
}

export function normalizeDonationType(raw: string): string | null {
  const value = (raw || '').toString().trim().toLowerCase();
  return DONATION_TYPES.has(value) ? value : null;
}

export function normalizeDocumentType(raw: string, allowedTypes: Set<string> = DOCUMENT_TYPES_CO): string | null {
  const value = (raw || '').toString().trim().toUpperCase();
  return allowedTypes.has(value) ? value : null;
}

type DonationFormOptions = {
  requireDocument?: boolean;
  allowedDocumentTypes?: Set<string>;
};

export function parseDonationFormBase(form: FormData, defaultCountry: string, options: DonationFormOptions = {}): {
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
  const allowedDocumentTypes = options.allowedDocumentTypes ?? DOCUMENT_TYPES_CO;
  const requireDocument = options.requireDocument ?? true;
  const documentType = normalizeDocumentType(form.get('documentType')?.toString() ?? '', allowedDocumentTypes) || '';
  const documentNumber = readText(form, 'documentNumber', 40);
  const country = safeCountry(form.get('country')?.toString()) ?? defaultCountry;
  const city = normalizeCityName(form.get('city')?.toString() ?? '');
  let church = normalizeChurchName(form.get('church')?.toString() ?? '');
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
  if (requireDocument) {
    if (!documentType) throw new Error('Tipo de documento requerido');
    if (!documentNumber) throw new Error('Documento requerido');
  } else {
    if (documentType && !documentNumber) throw new Error('Documento requerido');
    if (documentNumber && !documentType) throw new Error('Tipo de documento requerido');
  }
  if (!city) throw new Error('Ciudad requerida');
  if (!church && !campus) {
    church = normalizeChurchName(DEFAULT_VIRTUAL_CHURCH);
  }
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
