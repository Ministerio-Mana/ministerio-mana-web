export const EVENT_ONLINE_PAYMENT_PROVIDERS = Object.freeze(['NONE', 'WOMPI', 'STRIPE']);
export const EVENT_ONLINE_PAYMENT_MODES = Object.freeze(['NONE', 'WOMPI', 'STRIPE', 'DUAL']);

export const EVENT_PROVIDER_CURRENCIES = Object.freeze({
  WOMPI: 'COP',
  STRIPE: 'USD',
});

export function normalizeEventOnlinePaymentProvider(value) {
  const provider = String(value || 'NONE').trim().toUpperCase();
  return EVENT_ONLINE_PAYMENT_PROVIDERS.includes(provider) ? provider : 'NONE';
}

export function normalizeEventOnlinePaymentMode(value) {
  const mode = String(value || 'NONE').trim().toUpperCase();
  return EVENT_ONLINE_PAYMENT_MODES.includes(mode) ? mode : 'NONE';
}

export function getEventPaymentProvidersForMode(value) {
  const mode = normalizeEventOnlinePaymentMode(value);
  if (mode === 'DUAL') return ['WOMPI', 'STRIPE'];
  return mode === 'NONE' ? [] : [mode];
}

export function canUseEventPaymentModeForScope(mode, scope) {
  return normalizeEventOnlinePaymentMode(mode) !== 'DUAL'
    || String(scope || '').trim().toUpperCase() === 'GLOBAL';
}

export function getRequiredEventProviderCurrency(value) {
  const provider = normalizeEventOnlinePaymentProvider(value);
  return EVENT_PROVIDER_CURRENCIES[provider] || null;
}

export function isValidEventProviderCurrency(provider, currency) {
  const requiredCurrency = getRequiredEventProviderCurrency(provider);
  return !requiredCurrency || String(currency || '').trim().toUpperCase() === requiredCurrency;
}

export function getEventProviderPrice(event, provider) {
  const normalizedProvider = normalizeEventOnlinePaymentProvider(provider);
  const requiredCurrency = getRequiredEventProviderCurrency(normalizedProvider);
  if (!requiredCurrency) return 0;
  const dedicated = normalizedProvider === 'WOMPI' ? event?.price_cop : event?.price_usd;
  const dedicatedAmount = Number(dedicated);
  if (Number.isFinite(dedicatedAmount) && dedicatedAmount > 0) return dedicatedAmount;
  const legacyAmount = Number(event?.price);
  return String(event?.currency || '').trim().toUpperCase() === requiredCurrency
    && Number.isFinite(legacyAmount)
    && legacyAmount > 0
    ? legacyAmount
    : 0;
}
