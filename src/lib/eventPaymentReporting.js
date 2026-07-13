export const EVENT_PAYMENT_PROVIDER_LABELS = Object.freeze({
  WOMPI: 'Wompi · recaudo nacional',
  STRIPE: 'Stripe · internacional',
  MANUAL: 'Pago local verificado',
  EXTERNAL: 'Enlace externo verificado',
});

export function getEventPaymentProviderLabel(provider) {
  const normalized = String(provider || '').toUpperCase();
  return EVENT_PAYMENT_PROVIDER_LABELS[normalized] || normalized;
}

const PAYMENT_STATUS_PRIORITY = Object.freeze({
  APPROVED: 5,
  UNDER_REVIEW: 4,
  PENDING: 3,
  DECLINED: 2,
  FAILED: 1,
  VOIDED: 1,
});

export function shouldPreferEventPayment(candidate, current) {
  if (!current) return true;
  const candidatePriority = PAYMENT_STATUS_PRIORITY[String(candidate?.status || '').toUpperCase()] || 0;
  const currentPriority = PAYMENT_STATUS_PRIORITY[String(current?.status || '').toUpperCase()] || 0;
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;
  return new Date(candidate?.created_at || 0).getTime() > new Date(current?.created_at || 0).getTime();
}

export function selectPreferredEventPayments(payments) {
  const byRegistration = new Map();
  for (const payment of Array.isArray(payments) ? payments : []) {
    const registrationId = String(payment?.registration_id || '');
    if (registrationId && shouldPreferEventPayment(payment, byRegistration.get(registrationId))) {
      byRegistration.set(registrationId, payment);
    }
  }
  return byRegistration;
}

export function summarizeEventPayments(payments) {
  const groups = new Map();
  for (const payment of Array.isArray(payments) ? payments : []) {
    const provider = String(payment?.provider || '').toUpperCase();
    const currency = String(payment?.currency || '').toUpperCase();
    if (!provider || !currency) continue;
    const key = `${provider}:${currency}`;
    const group = groups.get(key) || {
      provider,
      currency,
      payment_count: 0,
      approved_count: 0,
      approved_amount: 0,
      pending_count: 0,
    };
    group.payment_count += 1;
    const status = String(payment?.status || '').toUpperCase();
    if (status === 'APPROVED') {
      group.approved_count += 1;
      group.approved_amount += Number(payment?.amount || 0);
    }
    if (status === 'PENDING' || status === 'UNDER_REVIEW') group.pending_count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (
    `${left.currency}:${left.provider}`.localeCompare(`${right.currency}:${right.provider}`)
  ));
}
