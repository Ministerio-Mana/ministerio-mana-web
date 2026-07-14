export type FinancePeriodFilter = 'all' | 'month' | '30d' | 'year' | 'custom';
export type FinanceAccountFilter = '' | 'WOMPI' | 'STRIPE' | 'GLOBAL' | 'NATIONAL' | 'REGIONAL' | 'LOCAL';
export type FinanceCurrencyFilter = '' | 'COP' | 'USD';

export type FinanceReportFilters = {
  period: FinancePeriodFilter;
  dateFrom: string;
  dateTo: string;
  account: FinanceAccountFilter;
  currency: FinanceCurrencyFilter;
};

type ParsedFinanceReportFilters = {
  filters: FinanceReportFilters;
  error: string | null;
};

const PERIODS = new Set<FinancePeriodFilter>(['all', 'month', '30d', 'year', 'custom']);
const ACCOUNTS = new Set<FinanceAccountFilter>(['', 'WOMPI', 'STRIPE', 'GLOBAL', 'NATIONAL', 'REGIONAL', 'LOCAL']);
const CURRENCIES = new Set<FinanceCurrencyFilter>(['', 'COP', 'USD']);
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function bogotaDateParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function subtractCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day - days));
  return formatDateParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function normalizeFinanceDate(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const [year, month, day] = candidate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) return '';
  return candidate;
}

export function parseFinanceReportFilters(
  searchParams: URLSearchParams,
  now = new Date(),
): ParsedFinanceReportFilters {
  const rawPeriod = String(searchParams.get('period') || 'all').trim().toLowerCase() as FinancePeriodFilter;
  const rawAccount = String(searchParams.get('account') || '').trim().toUpperCase() as FinanceAccountFilter;
  const rawCurrency = String(searchParams.get('currency') || '').trim().toUpperCase() as FinanceCurrencyFilter;

  if (!PERIODS.has(rawPeriod)) {
    return { filters: emptyFinanceReportFilters(), error: 'El período financiero no es válido.' };
  }
  if (!ACCOUNTS.has(rawAccount)) {
    return { filters: emptyFinanceReportFilters(), error: 'La cuenta financiera no es válida.' };
  }
  if (!CURRENCIES.has(rawCurrency)) {
    return { filters: emptyFinanceReportFilters(), error: 'La moneda financiera no es válida.' };
  }

  const todayParts = bogotaDateParts(now);
  const today = formatDateParts(todayParts.year, todayParts.month, todayParts.day);
  let dateFrom = '';
  let dateTo = '';

  if (rawPeriod === 'month') {
    dateFrom = formatDateParts(todayParts.year, todayParts.month, 1);
    dateTo = today;
  } else if (rawPeriod === '30d') {
    dateFrom = subtractCalendarDays(today, 29);
    dateTo = today;
  } else if (rawPeriod === 'year') {
    dateFrom = `${todayParts.year}-01-01`;
    dateTo = today;
  } else if (rawPeriod === 'custom') {
    dateFrom = normalizeFinanceDate(searchParams.get('dateFrom'));
    dateTo = normalizeFinanceDate(searchParams.get('dateTo'));
    if (!dateFrom || !dateTo) {
      return { filters: emptyFinanceReportFilters(), error: 'Selecciona una fecha inicial y una fecha final válidas.' };
    }
    if (dateFrom > dateTo) {
      return { filters: emptyFinanceReportFilters(), error: 'La fecha inicial no puede ser posterior a la fecha final.' };
    }
  }

  return {
    filters: {
      period: rawPeriod,
      dateFrom,
      dateTo,
      account: rawAccount,
      currency: rawCurrency,
    },
    error: null,
  };
}

export function emptyFinanceReportFilters(): FinanceReportFilters {
  return {
    period: 'all',
    dateFrom: '',
    dateTo: '',
    account: '',
    currency: '',
  };
}

export function applyFinanceReportFilters(query: any, filters: FinanceReportFilters): any {
  let next = query;
  if (filters.dateFrom) next = next.gte('created_at', `${filters.dateFrom}T00:00:00-05:00`);
  if (filters.dateTo) next = next.lte('created_at', `${filters.dateTo}T23:59:59.999-05:00`);
  if (filters.currency) next = next.eq('currency', filters.currency);

  if (filters.account === 'WOMPI' || filters.account === 'STRIPE') {
    next = next.eq('provider', filters.account);
  } else if (filters.account) {
    next = next.eq('finance_scope_type', filters.account);
  }
  return next;
}

export function financeRecordOriginLabel(transaction: Record<string, unknown> = {}): string {
  const provider = String(transaction.provider || '').trim().toUpperCase();
  const scopeType = String(transaction.finance_scope_type || '').trim().toUpperCase();
  const countryKey = String(transaction.finance_scope_country_key || '').trim();
  const country = countryKey
    ? countryKey.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : '';

  if (provider === 'WOMPI') return 'Wompi · Nacional Colombia';
  if (provider === 'STRIPE') return 'Stripe · Global';
  if (scopeType === 'LOCAL') return 'Pago local · Iglesia';
  if (scopeType === 'REGIONAL') return 'Cuenta regional';
  if (scopeType === 'NATIONAL') return `Cuenta nacional${country ? ` · ${country}` : ''}`;
  if (scopeType === 'GLOBAL') return 'Cuenta global';
  if (provider) return provider;
  return 'Sin clasificar';
}

function csvText(value: unknown): string {
  let text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

export function buildFinanceCsv(rows: Array<Record<string, any>>): string {
  const headers = [
    'Fecha',
    'Concepto',
    'Donante',
    'Correo',
    'Teléfono',
    'Cuenta',
    'Proveedor',
    'Estado',
    'Monto',
    'Moneda',
    'Referencia',
    'Alcance financiero',
    'País financiero',
    'Región',
    'Iglesia',
  ];
  const dataRows = rows.map((row) => [
    csvText(row.created_at),
    csvText(row.concept_label || 'Otros'),
    csvText(row.donor_name || 'Anónimo'),
    csvText(row.donor_email),
    csvText(row.donor_phone),
    csvText(financeRecordOriginLabel(row)),
    csvText(String(row.provider || '').toUpperCase()),
    csvText(row.status),
    csvNumber(row.amount),
    csvText(String(row.currency || '').toUpperCase()),
    csvText(row.reference),
    csvText(row.finance_scope_type),
    csvText(row.finance_scope_country_key),
    csvText(row.finance_region_id),
    csvText(row.church_id),
  ]);
  return `\uFEFF${[headers.map(csvText), ...dataRows].map((row) => row.join(',')).join('\n')}`;
}

export function financeExportFilename(filters: FinanceReportFilters): string {
  const parts = ['finanzas', filters.currency.toLowerCase()];
  if (filters.account) parts.push(filters.account.toLowerCase());
  if (filters.dateFrom && filters.dateTo) parts.push(`${filters.dateFrom}_${filters.dateTo}`);
  return `${parts.join('-')}.csv`;
}
