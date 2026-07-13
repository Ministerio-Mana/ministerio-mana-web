export const EVENT_ONLINE_PAYMENT_PROVIDERS = Object.freeze(['NONE', 'WOMPI', 'STRIPE']);

export const EVENT_PROVIDER_CURRENCIES = Object.freeze({
  WOMPI: 'COP',
  STRIPE: 'USD',
});

export function normalizeEventOnlinePaymentProvider(value) {
  const provider = String(value || 'NONE').trim().toUpperCase();
  return EVENT_ONLINE_PAYMENT_PROVIDERS.includes(provider) ? provider : 'NONE';
}

export function getRequiredEventProviderCurrency(value) {
  const provider = normalizeEventOnlinePaymentProvider(value);
  return EVENT_PROVIDER_CURRENCIES[provider] || null;
}

export function isValidEventProviderCurrency(provider, currency) {
  const requiredCurrency = getRequiredEventProviderCurrency(provider);
  return !requiredCurrency || String(currency || '').trim().toUpperCase() === requiredCurrency;
}
