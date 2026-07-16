import { createHash } from 'node:crypto';
import type { FinanceProvider, ProviderValueSource } from './providerReconciliation.ts';

export const PROVIDER_REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const PROVIDER_REPORT_MAX_ROWS = 10_000;

export type ProviderReportType = 'SALES' | 'PAYOUT_RECONCILIATION';

export type ProviderReportWarning = {
  code: string;
  message: string;
};

export type ProviderReportTransaction = {
  providerTransactionId: string;
  providerBalanceTransactionId: string | null;
  providerSettlementId: string | null;
  reference: string | null;
  currency: string;
  currencyExponent: number;
  grossAmountMinor: number;
  feeAmountMinor: number | null;
  taxAmountMinor: number | null;
  withholdingAmountMinor: number | null;
  adjustmentAmountMinor: number | null;
  netAmountMinor: number | null;
  paymentMethod: string | null;
  status: string | null;
  valuesSource: ProviderValueSource;
  exactAmounts: boolean;
  occurredAt: string;
  availableAt: string | null;
  settledAt: string | null;
  providerPayloadSha256: string;
};

export type ProviderReportSettlement = {
  providerSettlementId: string;
  currency: string;
  currencyExponent: number;
  periodStart: string;
  periodEnd: string;
  grossAmountMinor: number;
  feeAmountMinor: number | null;
  taxAmountMinor: number | null;
  withholdingAmountMinor: number | null;
  adjustmentAmountMinor: number | null;
  netAmountMinor: number | null;
  bankDepositAmountMinor: number | null;
  transferReference: string | null;
  status: 'PENDING' | 'PAID';
  valuesSource: ProviderValueSource;
  settledAt: string | null;
};

export type ProviderReportCurrencyTotal = {
  currency: string;
  currencyExponent: number;
  rowCount: number;
  exactRowCount: number;
  incompleteRowCount: number;
  grossAmountMinor: number;
  feeAmountMinor: number | null;
  netAmountMinor: number | null;
};

export type ProviderReportPreview = {
  provider: FinanceProvider;
  reportType: ProviderReportType;
  sourceFileName: string;
  fileSha256: string;
  rowCount: number;
  settlementCount: number;
  periodStart: string;
  periodEnd: string;
  exactNet: boolean;
  totals: ProviderReportCurrencyTotal[];
  ignoredSensitiveColumns: string[];
  warnings: ProviderReportWarning[];
};

export type ParsedProviderReport = {
  preview: ProviderReportPreview;
  transactions: ProviderReportTransaction[];
  settlements: ProviderReportSettlement[];
};

type CsvTable = {
  headers: string[];
  normalizedHeaders: string[];
  rows: string[][];
};

const WOMPI_HEADERS = {
  currency: 'moneda_de_la_transaccion',
  occurredAt: 'fecha_de_la_transaccion',
  transactionId: 'id_de_la_transaccion',
  reference: 'referencia_de_la_transaccion',
  paymentMethod: 'medio_de_pago_de_la_transaccion',
  gross: 'monto_de_la_transaccion',
  settlementId: 'id_de_conciliacion_de_abono',
  status: 'mensaje_de_estado_de_la_transaccion',
} as const;

const STRIPE_HEADERS = {
  settlementId: 'automatic_payout_id',
  settledAt: 'automatic_payout_effective_at',
  balanceTransactionId: 'balance_transaction_id',
  occurredAt: 'created',
  availableAt: 'available_on',
  currency: 'currency',
  gross: 'gross',
  fee: 'fee',
  net: 'net',
} as const;

const SENSITIVE_HEADER_PATTERNS = [
  /nombre.*pagador/,
  /telefono.*pagador/,
  /correo.*pagador/,
  /documento.*pagador/,
  /^account_name$/,
];

function sha256(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function safeAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${field} supera el límite numérico seguro.`);
  return result;
}

function normalizeHeader(value: string): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanText(value: unknown, maxLength: number): string | null {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function requiredIdentifier(value: unknown, label: string): string {
  const id = cleanText(value, 180);
  if (!id) throw new Error(`${label} está vacío.`);
  return id;
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Moneda inválida: ${currency || 'vacía'}.`);
  return currency;
}

function parseAmountMinor(value: unknown, exponent: number, label: string): number {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  const match = raw.match(/^([+-]?)(\d+)(?:[.,](\d+))?$/);
  if (!match) throw new Error(`${label} no es un valor monetario válido.`);
  const fraction = match[3] || '';
  if (fraction.length > exponent) throw new Error(`${label} tiene más decimales de los permitidos.`);
  const scale = 10n ** BigInt(exponent);
  const absolute = (BigInt(match[2]) * scale) + BigInt((fraction + '0'.repeat(exponent)).slice(0, exponent) || '0');
  const signed = match[1] === '-' ? -absolute : absolute;
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} supera el límite numérico seguro.`);
  return result;
}

function isoFromParts(parts: number[], offset: 'Z' | '-05:00', label: string): string {
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
  if (
    year < 2000 || year > 2200
    || month < 1 || month > 12
    || day < 1 || day > 31
    || hour < 0 || hour > 23
    || minute < 0 || minute > 59
    || second < 0 || second > 59
  ) throw new Error(`${label} no es una fecha válida.`);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) throw new Error(`${label} no es una fecha válida.`);
  const source = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${offset}`;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} no es una fecha válida.`);
  return date.toISOString();
}

function parseWompiDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error('La fecha de Wompi no tiene el formato DD-MM-AAAA HH:mm.');
  return isoFromParts([
    Number(match[3]), Number(match[2]), Number(match[1]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
  ], '-05:00', 'La fecha de Wompi');
}

function parseStripeDate(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z)?$/);
  if (!match) throw new Error(`${label} no tiene el formato UTC esperado.`);
  return isoFromParts(match.slice(1, 7).map(Number), 'Z', label);
}

function sanitizeFileName(value: string): string {
  const base = String(value || 'reporte.csv').split(/[\\/]/).pop() || 'reporte.csv';
  const safe = base.replace(/[^a-zA-Z0-9._ -]/g, '-').replace(/\s+/g, ' ').trim();
  return (safe || 'reporte.csv').slice(0, 180);
}

function parseCsv(text: string): CsvTable {
  if (!text.trim()) throw new Error('El archivo CSV está vacío.');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  const pushField = () => {
    if (field.length > 20_000) throw new Error('Una celda del CSV supera el tamaño permitido.');
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.length > 80) throw new Error('El CSV contiene demasiadas columnas.');
    if (record.some((value) => value.trim() !== '')) records.push(record);
    record = [];
    if (records.length > PROVIDER_REPORT_MAX_ROWS + 1) {
      throw new Error(`El CSV supera ${PROVIDER_REPORT_MAX_ROWS.toLocaleString('es-CO')} movimientos.`);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n') {
      pushRecord();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('El CSV tiene una comilla sin cerrar.');
  if (field || record.length) pushRecord();
  if (records.length < 2) throw new Error('El CSV no contiene movimientos.');

  const headers = records[0].map((value) => value.replace(/^\uFEFF/, '').trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  if (normalizedHeaders.some((header) => !header)) throw new Error('El CSV contiene un encabezado vacío.');
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error('El CSV contiene encabezados duplicados.');
  }
  const rows = records.slice(1);
  const invalidRow = rows.findIndex((row) => row.length !== headers.length);
  if (invalidRow >= 0) throw new Error(`La fila ${invalidRow + 2} no tiene ${headers.length} columnas.`);
  return { headers, normalizedHeaders, rows };
}

function makeRowReader(table: CsvTable) {
  const indexByHeader = new Map(table.normalizedHeaders.map((header, index) => [header, index]));
  return {
    has(header: string) {
      return indexByHeader.has(header);
    },
    value(row: string[], header: string): string {
      const index = indexByHeader.get(header);
      return index === undefined ? '' : row[index] ?? '';
    },
  };
}

function requireHeaders(reader: ReturnType<typeof makeRowReader>, required: string[], provider: FinanceProvider) {
  const missing = required.filter((header) => !reader.has(header));
  if (missing.length) throw new Error(`El reporte de ${provider === 'WOMPI' ? 'Wompi' : 'Stripe'} no contiene las columnas requeridas.`);
}

function rowPayloadHash(transaction: Omit<ProviderReportTransaction, 'providerPayloadSha256'>): string {
  return sha256(JSON.stringify(transaction));
}

function parseWompiReport(table: CsvTable): Omit<ParsedProviderReport, 'preview'> {
  const reader = makeRowReader(table);
  requireHeaders(reader, [
    WOMPI_HEADERS.currency,
    WOMPI_HEADERS.occurredAt,
    WOMPI_HEADERS.transactionId,
    WOMPI_HEADERS.gross,
  ], 'WOMPI');

  const settlementGroups = new Map<string, ProviderReportSettlement>();
  const transactions = table.rows.map((row, index) => {
    try {
      const settlementId = cleanText(reader.value(row, WOMPI_HEADERS.settlementId), 180);
      const currency = normalizeCurrency(reader.value(row, WOMPI_HEADERS.currency));
      const gross = parseAmountMinor(reader.value(row, WOMPI_HEADERS.gross), 2, 'El monto Wompi');
      const occurredAt = parseWompiDate(reader.value(row, WOMPI_HEADERS.occurredAt));
      const base: Omit<ProviderReportTransaction, 'providerPayloadSha256'> = {
        providerTransactionId: requiredIdentifier(reader.value(row, WOMPI_HEADERS.transactionId), 'El ID de transacción Wompi'),
        providerBalanceTransactionId: null,
        providerSettlementId: settlementId,
        reference: cleanText(reader.value(row, WOMPI_HEADERS.reference), 500),
        currency,
        currencyExponent: 2,
        grossAmountMinor: gross,
        feeAmountMinor: null,
        taxAmountMinor: null,
        withholdingAmountMinor: null,
        adjustmentAmountMinor: null,
        netAmountMinor: null,
        paymentMethod: cleanText(reader.value(row, WOMPI_HEADERS.paymentMethod), 120),
        status: cleanText(reader.value(row, WOMPI_HEADERS.status), 120),
        valuesSource: 'PROVIDER_REPORT',
        exactAmounts: false,
        occurredAt,
        availableAt: null,
        settledAt: null,
      };
      if (settlementId) {
        const groupKey = `${settlementId}\u0000${currency}`;
        const current = settlementGroups.get(groupKey);
        if (current) {
          current.grossAmountMinor = safeAdd(current.grossAmountMinor, gross, 'El bruto del abono Wompi');
          if (occurredAt < current.periodStart) current.periodStart = occurredAt;
          if (occurredAt > current.periodEnd) current.periodEnd = occurredAt;
        } else {
          settlementGroups.set(groupKey, {
            providerSettlementId: settlementId,
            currency,
            currencyExponent: 2,
            periodStart: occurredAt,
            periodEnd: occurredAt,
            grossAmountMinor: gross,
            feeAmountMinor: null,
            taxAmountMinor: null,
            withholdingAmountMinor: null,
            adjustmentAmountMinor: null,
            netAmountMinor: null,
            bankDepositAmountMinor: null,
            transferReference: null,
            status: 'PENDING',
            valuesSource: 'PROVIDER_REPORT',
            settledAt: null,
          });
        }
      }
      return { ...base, providerPayloadSha256: rowPayloadHash(base) };
    } catch (error) {
      throw new Error(`Fila ${index + 2}: ${error instanceof Error ? error.message : 'dato inválido'}`);
    }
  });
  return { transactions, settlements: Array.from(settlementGroups.values()) };
}

function parseStripeReport(table: CsvTable): Omit<ParsedProviderReport, 'preview'> {
  const reader = makeRowReader(table);
  requireHeaders(reader, Object.values(STRIPE_HEADERS), 'STRIPE');
  const settlementGroups = new Map<string, ProviderReportSettlement>();

  const transactions = table.rows.map((row, index) => {
    try {
      const settlementId = requiredIdentifier(reader.value(row, STRIPE_HEADERS.settlementId), 'El ID de payout Stripe');
      const balanceTransactionId = requiredIdentifier(reader.value(row, STRIPE_HEADERS.balanceTransactionId), 'El ID de balance Stripe');
      const currency = normalizeCurrency(reader.value(row, STRIPE_HEADERS.currency));
      const gross = parseAmountMinor(reader.value(row, STRIPE_HEADERS.gross), 2, 'El bruto Stripe');
      const fee = parseAmountMinor(reader.value(row, STRIPE_HEADERS.fee), 2, 'La comisión Stripe');
      const net = parseAmountMinor(reader.value(row, STRIPE_HEADERS.net), 2, 'El neto Stripe');
      if (gross - fee !== net) throw new Error('bruto menos comisión no coincide con el neto Stripe.');
      const occurredAt = parseStripeDate(reader.value(row, STRIPE_HEADERS.occurredAt), 'La fecha de creación Stripe');
      const availableAt = parseStripeDate(reader.value(row, STRIPE_HEADERS.availableAt), 'La fecha disponible Stripe');
      const settledAt = parseStripeDate(reader.value(row, STRIPE_HEADERS.settledAt), 'La fecha de payout Stripe');
      const base: Omit<ProviderReportTransaction, 'providerPayloadSha256'> = {
        providerTransactionId: balanceTransactionId,
        providerBalanceTransactionId: balanceTransactionId,
        providerSettlementId: settlementId,
        reference: null,
        currency,
        currencyExponent: 2,
        grossAmountMinor: gross,
        feeAmountMinor: fee,
        taxAmountMinor: null,
        withholdingAmountMinor: null,
        adjustmentAmountMinor: 0,
        netAmountMinor: net,
        paymentMethod: null,
        status: 'PAID',
        valuesSource: 'PROVIDER_REPORT',
        exactAmounts: true,
        occurredAt,
        availableAt,
        settledAt,
      };

      const groupKey = `${settlementId}\u0000${currency}`;
      const current = settlementGroups.get(groupKey);
      if (current) {
        current.grossAmountMinor = safeAdd(current.grossAmountMinor, gross, 'El bruto del payout');
        current.feeAmountMinor = safeAdd(current.feeAmountMinor, fee, 'La comisión del payout');
        current.netAmountMinor = safeAdd(current.netAmountMinor, net, 'El neto del payout');
        if (occurredAt < current.periodStart) current.periodStart = occurredAt;
        if (occurredAt > current.periodEnd) current.periodEnd = occurredAt;
      } else {
        settlementGroups.set(groupKey, {
          providerSettlementId: settlementId,
          currency,
          currencyExponent: 2,
          periodStart: occurredAt,
          periodEnd: occurredAt,
          grossAmountMinor: gross,
          feeAmountMinor: fee,
          taxAmountMinor: null,
          withholdingAmountMinor: null,
          adjustmentAmountMinor: 0,
          netAmountMinor: net,
          bankDepositAmountMinor: null,
          transferReference: null,
          status: 'PAID',
          valuesSource: 'PROVIDER_REPORT',
          settledAt,
        });
      }
      return { ...base, providerPayloadSha256: rowPayloadHash(base) };
    } catch (error) {
      throw new Error(`Fila ${index + 2}: ${error instanceof Error ? error.message : 'dato inválido'}`);
    }
  });
  return { transactions, settlements: Array.from(settlementGroups.values()) };
}

function buildTotals(transactions: ProviderReportTransaction[]): ProviderReportCurrencyTotal[] {
  const totals = new Map<string, ProviderReportCurrencyTotal>();
  transactions.forEach((transaction) => {
    const current = totals.get(transaction.currency) || {
      currency: transaction.currency,
      currencyExponent: transaction.currencyExponent,
      rowCount: 0,
      exactRowCount: 0,
      incompleteRowCount: 0,
      grossAmountMinor: 0,
      feeAmountMinor: 0,
      netAmountMinor: 0,
    };
    current.rowCount += 1;
    current.grossAmountMinor = safeAdd(current.grossAmountMinor, transaction.grossAmountMinor, 'El total bruto');
    if (transaction.exactAmounts && transaction.feeAmountMinor !== null && transaction.netAmountMinor !== null) {
      current.exactRowCount += 1;
      if (current.incompleteRowCount === 0) {
        current.feeAmountMinor = safeAdd(current.feeAmountMinor || 0, transaction.feeAmountMinor, 'El total de comisiones');
        current.netAmountMinor = safeAdd(current.netAmountMinor || 0, transaction.netAmountMinor, 'El total neto');
      }
    } else {
      current.incompleteRowCount += 1;
      current.feeAmountMinor = null;
      current.netAmountMinor = null;
    }
    totals.set(transaction.currency, current);
  });
  return Array.from(totals.values()).sort((left, right) => left.currency.localeCompare(right.currency));
}

function assertUniqueTransactions(transactions: ProviderReportTransaction[]) {
  const seen = new Set<string>();
  transactions.forEach((transaction) => {
    if (seen.has(transaction.providerTransactionId)) {
      throw new Error(`El archivo repite la transacción ${transaction.providerTransactionId}.`);
    }
    seen.add(transaction.providerTransactionId);
  });
}

export function parseProviderReportCsv(params: {
  bytes: Uint8Array;
  sourceFileName: string;
  providerHint?: FinanceProvider | null;
}): ParsedProviderReport {
  if (!(params.bytes instanceof Uint8Array) || params.bytes.byteLength === 0) throw new Error('El archivo CSV está vacío.');
  if (params.bytes.byteLength > PROVIDER_REPORT_MAX_BYTES) throw new Error('El archivo CSV supera 4 MB.');
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(params.bytes);
  } catch {
    throw new Error('El archivo debe estar codificado en UTF-8.');
  }
  if (text.includes('\u0000')) throw new Error('El archivo contiene bytes no permitidos.');
  const table = parseCsv(text);
  const reader = makeRowReader(table);
  const isWompi = reader.has(WOMPI_HEADERS.transactionId) && reader.has(WOMPI_HEADERS.gross);
  const isStripe = reader.has(STRIPE_HEADERS.balanceTransactionId) && reader.has(STRIPE_HEADERS.net);
  if (isWompi === isStripe) throw new Error('No fue posible reconocer un reporte oficial de Wompi o Stripe.');
  const provider: FinanceProvider = isWompi ? 'WOMPI' : 'STRIPE';
  if (params.providerHint && params.providerHint !== provider) {
    throw new Error(`El archivo corresponde a ${provider}, no a ${params.providerHint}.`);
  }

  const parsed = provider === 'WOMPI' ? parseWompiReport(table) : parseStripeReport(table);
  assertUniqueTransactions(parsed.transactions);
  const orderedDates = parsed.transactions.map((transaction) => transaction.occurredAt).sort();
  const ignoredSensitiveColumns = table.headers.filter((_, index) => (
    SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(table.normalizedHeaders[index]))
  ));
  const warnings: ProviderReportWarning[] = provider === 'WOMPI'
    ? [{
      code: 'WOMPI_NET_PENDING',
      message: 'Este reporte confirma el bruto, pero no trae comisión ni neto. Esos valores quedarán pendientes del reporte oficial de desembolsos.',
    }]
    : [{
      code: 'BANK_DEPOSIT_PENDING',
      message: 'El neto del payout es exacto; el abono bancario seguirá pendiente hasta cruzarlo con el extracto del banco.',
    }];
  if (ignoredSensitiveColumns.length) {
    warnings.push({
      code: 'PII_IGNORED',
      message: 'Las columnas con datos personales se detectaron, pero no se guardarán en conciliación.',
    });
  }

  const preview: ProviderReportPreview = {
    provider,
    reportType: provider === 'WOMPI' ? 'SALES' : 'PAYOUT_RECONCILIATION',
    sourceFileName: sanitizeFileName(params.sourceFileName),
    fileSha256: sha256(params.bytes),
    rowCount: parsed.transactions.length,
    settlementCount: parsed.settlements.length,
    periodStart: orderedDates[0],
    periodEnd: orderedDates[orderedDates.length - 1],
    exactNet: parsed.transactions.every((transaction) => transaction.exactAmounts),
    totals: buildTotals(parsed.transactions),
    ignoredSensitiveColumns,
    warnings,
  };
  return { preview, ...parsed };
}

export function serializeProviderReportForRpc(report: ParsedProviderReport) {
  return {
    provider: report.preview.provider,
    reportType: report.preview.reportType,
    sourceFileName: report.preview.sourceFileName,
    fileSha256: report.preview.fileSha256,
    rowCount: report.preview.rowCount,
    periodStart: report.preview.periodStart,
    periodEnd: report.preview.periodEnd,
    settlements: report.settlements.map((settlement) => ({
      provider_settlement_id: settlement.providerSettlementId,
      currency: settlement.currency,
      currency_exponent: settlement.currencyExponent,
      period_start: settlement.periodStart,
      period_end: settlement.periodEnd,
      gross_amount_minor: settlement.grossAmountMinor,
      fee_amount_minor: settlement.feeAmountMinor,
      tax_amount_minor: settlement.taxAmountMinor,
      withholding_amount_minor: settlement.withholdingAmountMinor,
      adjustment_amount_minor: settlement.adjustmentAmountMinor,
      net_amount_minor: settlement.netAmountMinor,
      bank_deposit_amount_minor: settlement.bankDepositAmountMinor,
      transfer_reference: settlement.transferReference,
      status: settlement.status,
      values_source: settlement.valuesSource,
      settled_at: settlement.settledAt,
    })),
    transactions: report.transactions.map((transaction) => ({
      provider_transaction_id: transaction.providerTransactionId,
      provider_balance_transaction_id: transaction.providerBalanceTransactionId,
      provider_settlement_id: transaction.providerSettlementId,
      reference: transaction.reference,
      currency: transaction.currency,
      currency_exponent: transaction.currencyExponent,
      gross_amount_minor: transaction.grossAmountMinor,
      fee_amount_minor: transaction.feeAmountMinor,
      tax_amount_minor: transaction.taxAmountMinor,
      withholding_amount_minor: transaction.withholdingAmountMinor,
      adjustment_amount_minor: transaction.adjustmentAmountMinor,
      net_amount_minor: transaction.netAmountMinor,
      payment_method: transaction.paymentMethod,
      status: transaction.status,
      values_source: transaction.valuesSource,
      exact_amounts: transaction.exactAmounts,
      occurred_at: transaction.occurredAt,
      available_at: transaction.availableAt,
      settled_at: transaction.settledAt,
      provider_payload_sha256: transaction.providerPayloadSha256,
    })),
  };
}
