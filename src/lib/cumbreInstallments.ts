import type { Currency } from './cumbre2026';

export type InstallmentFrequency = 'MONTHLY' | 'BIWEEKLY';

const DEFAULT_DEADLINE = '2026-05-15';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

export function getInstallmentDeadline(): string {
  const raw = env('CUMBRE_INSTALLMENT_DEADLINE');
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_DEADLINE;
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonthUTC(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addMonthsUTC(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const maxDay = daysInMonthUTC(targetYear, targetMonth);
  const safeDay = Math.min(day, maxDay);
  return new Date(Date.UTC(targetYear, targetMonth, safeDay));
}

function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function roundCurrency(amount: number, currency: Currency): number {
  if (currency === 'COP') return Math.round(amount);
  return Math.round(amount * 100) / 100;
}

export type InstallmentScheduleItem = {
  installmentIndex: number;
  dueDate: string;
  amount: number;
};

export type InstallmentSchedule = {
  startDate: string;
  endDate: string;
  installmentCount: number;
  installmentAmount: number;
  installments: InstallmentScheduleItem[];
};

export function buildInstallmentSchedule(params: {
  totalAmount: number;
  currency: Currency;
  frequency: InstallmentFrequency;
  startDate?: Date;
  deadline?: string;
}): InstallmentSchedule {
  const totalAmount = Number(params.totalAmount || 0);
  const start = toDateOnly(params.startDate ?? new Date());
  const deadlineValue = params.deadline ?? getInstallmentDeadline();
  let end = parseDateOnly(deadlineValue);
  if (end < start) {
    end = start;
  }

  const dueDates: Date[] = [];
  let current = start;
  const step = params.frequency === 'BIWEEKLY' ? 14 : 30;

  while (current <= end) {
    dueDates.push(current);
    current = params.frequency === 'BIWEEKLY'
      ? addDaysUTC(current, step)
      : addMonthsUTC(current, 1);
  }

  if (dueDates.length === 0) {
    dueDates.push(start);
  }

  const installmentCount = dueDates.length;
  const rawAmount = totalAmount / installmentCount;
  const installmentAmount = roundCurrency(rawAmount, params.currency);

  let accumulated = 0;
  const installments = dueDates.map((date, index) => {
    const isLast = index === installmentCount - 1;
    let amount = installmentAmount;
    if (isLast) {
      amount = roundCurrency(totalAmount - accumulated, params.currency);
    }
    accumulated = roundCurrency(accumulated + amount, params.currency);
    return {
      installmentIndex: index + 1,
      dueDate: formatDateOnly(date),
      amount,
    };
  });

  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    installmentCount,
    installmentAmount,
    installments,
  };
}

export function buildInstallmentSummary(params: {
  totalAmount: number;
  currency: Currency;
  frequency: InstallmentFrequency;
  startDate?: Date;
  deadline?: string;
}): { count: number; amount: number; endDate: string } {
  const schedule = buildInstallmentSchedule(params);
  return {
    count: schedule.installmentCount,
    amount: schedule.installmentAmount,
    endDate: schedule.endDate,
  };
}
