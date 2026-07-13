export const DEFAULT_EVENT_REGISTRATION_FORM_CONFIG = Object.freeze({
  phone: 'OPTIONAL',
  church: false,
  whatsapp_updates: false,
});

const PHONE_MODES = new Set(['HIDDEN', 'OPTIONAL', 'REQUIRED']);

export function normalizeEventRegistrationFormConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const phone = String(source.phone || DEFAULT_EVENT_REGISTRATION_FORM_CONFIG.phone).toUpperCase();
  return {
    phone: PHONE_MODES.has(phone) ? phone : DEFAULT_EVENT_REGISTRATION_FORM_CONFIG.phone,
    church: Boolean(source.church),
    whatsapp_updates: Boolean(source.whatsapp_updates),
  };
}

export function normalizeWhatsAppNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}
