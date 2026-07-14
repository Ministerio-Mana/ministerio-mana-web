export type CampusPaymentCurrency = 'COP' | 'USD';

export function normalizeCampusMoneyAmount(
  value: unknown,
  currency: CampusPaymentCurrency,
): number {
  let amount: number;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (currency === 'COP') {
      const digits = raw.replace(/[^\d]/g, '');
      amount = digits ? Number(digits) : 0;
    } else {
      let normalized = raw.replace(/[^0-9.,]/g, '');
      if (normalized.includes(',') && !normalized.includes('.')) {
        normalized = normalized.replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
      amount = Number(normalized);
    }
  } else {
    amount = Number(value);
  }

  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return currency === 'COP' ? Math.round(amount) : Math.round(amount * 100) / 100;
}

export function buildCampusAllocationAmounts(params: {
  selectedSlugs: string[];
  allocations: unknown;
  amount: unknown;
  currency: CampusPaymentCurrency;
}): { slug: string; amount: number }[] {
  const { selectedSlugs, allocations, amount, currency } = params;

  if (Array.isArray(allocations) && allocations.length > 0) {
    const bySlug = new Map<string, number>();
    allocations.forEach((item: any) => {
      const slug = String(item?.slug || '').trim();
      if (!selectedSlugs.includes(slug)) return;
      const allocationAmount = normalizeCampusMoneyAmount(item?.amount, currency);
      if (allocationAmount > 0) bySlug.set(slug, allocationAmount);
    });

    return selectedSlugs.map((slug) => ({
      slug,
      amount: bySlug.get(slug) || 0,
    }));
  }

  const legacyAmount = normalizeCampusMoneyAmount(amount, currency);
  return selectedSlugs.map((slug) => ({ slug, amount: legacyAmount }));
}

export function resolveCampusPaymentProvider(currency: CampusPaymentCurrency): {
  provider: 'wompi' | 'stripe';
  financeProvider: 'WOMPI' | 'STRIPE';
} {
  return currency === 'COP'
    ? { provider: 'wompi', financeProvider: 'WOMPI' }
    : { provider: 'stripe', financeProvider: 'STRIPE' };
}
