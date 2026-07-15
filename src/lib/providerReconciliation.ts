export const FINANCE_PROVIDERS = ['WOMPI', 'STRIPE'] as const;

export type FinanceProvider = typeof FINANCE_PROVIDERS[number];
export type ProviderValueSource = 'PROVIDER_API' | 'PROVIDER_REPORT' | 'BANK_REPORT' | 'MANUAL_VERIFIED';

export type ProviderAmountRecord = {
  provider: FinanceProvider;
  providerTransactionId: string;
  currency: string;
  currencyExponent: number;
  grossAmountMinor: number;
  feeAmountMinor: number | null;
  taxAmountMinor: number | null;
  withholdingAmountMinor: number | null;
  adjustmentAmountMinor: number | null;
  netAmountMinor: number | null;
  valuesSource: ProviderValueSource;
  exactAmounts: boolean;
};

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = integerOrNull(value);
  if (parsed === null) throw new Error(`${field} debe venir en unidades menores enteras.`);
  return parsed;
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Moneda de proveedor inválida.');
  return currency;
}

function normalizeProviderTransactionId(value: unknown): string {
  const id = String(value || '').trim();
  if (!id || id.length > 180) throw new Error('ID de transacción de proveedor inválido.');
  return id;
}

export function normalizeStripeBalanceTransaction(
  balanceTransaction: Record<string, unknown>,
  currencyExponent = 2,
): ProviderAmountRecord {
  const gross = requiredInteger(balanceTransaction.amount, 'amount');
  const fee = requiredInteger(balanceTransaction.fee, 'fee');
  const net = requiredInteger(balanceTransaction.net, 'net');
  if (gross - fee !== net) throw new Error('Stripe devolvió valores bruto, comisión y neto inconsistentes.');
  return {
    provider: 'STRIPE',
    providerTransactionId: normalizeProviderTransactionId(balanceTransaction.id),
    currency: normalizeCurrency(balanceTransaction.currency),
    currencyExponent,
    grossAmountMinor: gross,
    feeAmountMinor: fee,
    taxAmountMinor: null,
    withholdingAmountMinor: null,
    adjustmentAmountMinor: 0,
    netAmountMinor: net,
    valuesSource: 'PROVIDER_API',
    exactAmounts: true,
  };
}

export function normalizeWompiTransaction(
  transaction: Record<string, unknown>,
): ProviderAmountRecord {
  return {
    provider: 'WOMPI',
    providerTransactionId: normalizeProviderTransactionId(transaction.id),
    currency: normalizeCurrency(transaction.currency || 'COP'),
    currencyExponent: 2,
    grossAmountMinor: requiredInteger(transaction.amount_in_cents, 'amount_in_cents'),
    feeAmountMinor: null,
    taxAmountMinor: null,
    withholdingAmountMinor: null,
    adjustmentAmountMinor: null,
    netAmountMinor: null,
    valuesSource: 'PROVIDER_API',
    exactAmounts: false,
  };
}

export function hasExactProviderNet(record: ProviderAmountRecord): boolean {
  return record.exactAmounts
    && record.feeAmountMinor !== null
    && record.netAmountMinor !== null;
}
