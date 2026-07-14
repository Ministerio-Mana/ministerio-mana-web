import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFinanceReportFilters,
  buildFinanceCsv,
  financeExportFilename,
  financeRecordCurrency,
  financeRecordOriginLabel,
  parseFinanceReportFilters,
} from '../src/lib/financeReporting.ts';

test('calcula períodos usando el día de Colombia', () => {
  const parsed = parseFinanceReportFilters(
    new URLSearchParams({ period: '30d', account: 'wompi', currency: 'cop' }),
    new Date('2026-07-13T17:00:00.000Z'),
  );
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.filters, {
    period: '30d',
    dateFrom: '2026-06-14',
    dateTo: '2026-07-13',
    account: 'WOMPI',
    currency: 'COP',
  });
});

test('rechaza rangos personalizados invertidos', () => {
  const parsed = parseFinanceReportFilters(new URLSearchParams({
    period: 'custom',
    dateFrom: '2026-07-14',
    dateTo: '2026-07-13',
  }));
  assert.match(parsed.error || '', /fecha inicial/i);
});

test('rechaza cuentas y monedas fuera del contrato', () => {
  assert.match(
    parseFinanceReportFilters(new URLSearchParams({ account: 'otra-cuenta' })).error || '',
    /cuenta financiera/i,
  );
  assert.match(
    parseFinanceReportFilters(new URLSearchParams({ currency: 'eur' })).error || '',
    /moneda financiera/i,
  );
});

test('aplica período, moneda y proveedor al query', () => {
  const operations: Array<[string, string, string]> = [];
  const query = {
    gte(column: string, value: string) {
      operations.push(['gte', column, value]);
      return this;
    },
    lte(column: string, value: string) {
      operations.push(['lte', column, value]);
      return this;
    },
    eq(column: string, value: string) {
      operations.push(['eq', column, value]);
      return this;
    },
    or(value: string) {
      operations.push(['or', 'filter', value]);
      return this;
    },
  };
  applyFinanceReportFilters(query, {
    period: 'custom',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-13',
    account: 'WOMPI',
    currency: 'COP',
  });
  assert.deepEqual(operations, [
    ['gte', 'created_at', '2026-07-01T00:00:00-05:00'],
    ['lte', 'created_at', '2026-07-13T23:59:59.999-05:00'],
    ['or', 'filter', 'currency.eq.COP,provider.eq.WOMPI,and(currency.is.null,finance_scope_type.in.(NATIONAL,REGIONAL,LOCAL))'],
    ['eq', 'provider', 'WOMPI'],
  ]);
});

test('filtra cuentas locales por alcance financiero', () => {
  const operations: Array<[string, string, string]> = [];
  const query = {
    gte() { return this; },
    lte() { return this; },
    or() { return this; },
    eq(column: string, value: string) {
      operations.push(['eq', column, value]);
      return this;
    },
  };
  applyFinanceReportFilters(query, {
    period: 'all',
    dateFrom: '',
    dateTo: '',
    account: 'LOCAL',
    currency: '',
  });
  assert.deepEqual(operations, [['eq', 'finance_scope_type', 'LOCAL']]);
});

test('genera CSV seguro, con BOM y una sola moneda', () => {
  const csv = buildFinanceCsv([{
    created_at: '2026-07-13T12:00:00-05:00',
    concept_label: 'Eventos',
    donor_name: '=HYPERLINK("https://example.com")',
    amount: 300000,
    currency: 'COP',
    provider: 'WOMPI',
    status: 'APPROVED',
    finance_scope_type: 'NATIONAL',
    finance_scope_country_key: 'colombia',
  }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Wompi · Nacional Colombia/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /,300000,"COP",/);
  assert.doesNotMatch(csv, /"USD"/);
});

test('mantiene los nombres operativos de cada origen', () => {
  assert.equal(financeRecordOriginLabel({ provider: 'WOMPI' }), 'Wompi · Nacional Colombia');
  assert.equal(financeRecordOriginLabel({ provider: 'STRIPE' }), 'Stripe · Global');
  assert.equal(financeRecordOriginLabel({ finance_scope_type: 'LOCAL' }), 'Pago local · Iglesia');
});

test('normaliza la moneda histórica usando el proveedor como contrato', () => {
  assert.equal(financeRecordCurrency({ provider: 'WOMPI', currency: null }), 'COP');
  assert.equal(financeRecordCurrency({ provider: 'STRIPE', currency: null }), 'USD');
  assert.equal(financeRecordCurrency({ provider: 'PHYSICAL', currency: null }), 'COP');
});

test('nombra exportes con moneda, cuenta y período', () => {
  assert.equal(financeExportFilename({
    period: 'custom',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-13',
    account: 'WOMPI',
    currency: 'COP',
  }), 'finanzas-cop-wompi-2026-07-01_2026-07-13.csv');
});
