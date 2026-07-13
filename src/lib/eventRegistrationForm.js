export const DEFAULT_EVENT_REGISTRATION_FORM_CONFIG = Object.freeze({
  phone: 'OPTIONAL',
  church: false,
  whatsapp_updates: false,
  fields: [],
});

const PHONE_MODES = new Set(['HIDDEN', 'OPTIONAL', 'REQUIRED']);
export const EVENT_CUSTOM_FIELD_TYPES = Object.freeze([
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'YES_NO',
  'DATE',
]);
export const MAX_EVENT_CUSTOM_FIELDS = 10;
export const MAX_EVENT_CUSTOM_FIELD_OPTIONS = 12;

const CUSTOM_FIELD_TYPE_SET = new Set(EVENT_CUSTOM_FIELD_TYPES);
const CHOICE_FIELD_TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE']);
const FIELD_ID_PATTERN = /^field_[a-z0-9]{8,32}$/;

function normalizeText(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeFieldOptions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((options, item) => {
    const normalized = normalizeText(item, 80);
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key) || options.length >= MAX_EVENT_CUSTOM_FIELD_OPTIONS) return options;
    seen.add(key);
    options.push(normalized);
    return options;
  }, []);
}

function normalizeCustomField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim().toLowerCase();
  const type = String(value.type || '').trim().toUpperCase();
  const label = normalizeText(value.label, 120);
  if (!FIELD_ID_PATTERN.test(id) || !CUSTOM_FIELD_TYPE_SET.has(type) || !label) return null;

  const field = {
    id,
    type,
    label,
    help_text: normalizeText(value.help_text, 240),
    required: Boolean(value.required),
    options: [],
  };
  if (CHOICE_FIELD_TYPES.has(type)) {
    const options = normalizeFieldOptions(value.options);
    if (options.length < 2) return null;
    field.options = options;
  }
  return field;
}

export function isEventCustomChoiceField(type) {
  return CHOICE_FIELD_TYPES.has(String(type || '').toUpperCase());
}

export function normalizeEventRegistrationFormConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const phone = String(source.phone || DEFAULT_EVENT_REGISTRATION_FORM_CONFIG.phone).toUpperCase();
  const usedIds = new Set();
  const fields = (Array.isArray(source.fields) ? source.fields : [])
    .map(normalizeCustomField)
    .filter((field) => field && !usedIds.has(field.id))
    .filter((field) => {
      usedIds.add(field.id);
      return true;
    })
    .slice(0, MAX_EVENT_CUSTOM_FIELDS);
  return {
    phone: PHONE_MODES.has(phone) ? phone : DEFAULT_EVENT_REGISTRATION_FORM_CONFIG.phone,
    church: Boolean(source.church),
    whatsapp_updates: Boolean(source.whatsapp_updates),
    fields,
  };
}

export function normalizeWhatsAppNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}
