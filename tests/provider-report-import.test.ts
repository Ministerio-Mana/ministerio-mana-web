import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseProviderReportCsv,
  serializeProviderReportForRpc,
} from '../src/lib/providerReportImport.ts';

const IMPORT_SQL = readFileSync(new URL('../docs/sql/finance_provider_report_import.sql', import.meta.url), 'utf8');
const IMPORT_API = readFileSync(new URL('../src/pages/api/portal/finance-reconciliation-import.ts', import.meta.url), 'utf8');
const FINANCE_PAGE = readFileSync(new URL('../src/pages/portal/finances.astro', import.meta.url), 'utf8');

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const WOMPI_HEADERS = [
  'iva de la transaccion',
  'moneda de la transaccion',
  'fecha de la transaccion',
  'id de la transaccion',
  'referencia de la transaccion',
  'impuesto consumo de la transaccion',
  'medio de pago de la transaccion',
  'monto de la transaccion',
  'id link de pago',
  'id de conciliacion de abono',
  'nombre del pagador',
  'telefono del pagador',
  'correo electronico del pagador',
  'mensaje de estado de la transaccion',
];

function wompiCsv(rows: string[][]): string {
  return [WOMPI_HEADERS, ...rows].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

const STRIPE_HEADERS = [
  'account_id',
  'account_name',
  'automatic_payout_id',
  'automatic_payout_effective_at',
  'balance_transaction_id',
  'created',
  'available_on',
  'currency',
  'gross',
  'fee',
  'net',
  'reporting_category',
  'description',
];

function stripeCsv(rows: string[][]): string {
  return [STRIPE_HEADERS, ...rows].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n');
}

test('Wompi guarda bruto y agrupación, pero nunca inventa comisión o neto', () => {
  const report = parseProviderReportCsv({
    bytes: bytes(wompiCsv([
      ['0', 'COP', '04-07-2026 14:43', 'wompi-1', 'MANA-DON-1', '0', 'PSE', '100000.00', '', 'abono-1', 'Persona', '3000000000', 'persona@example.com', 'APROBADA'],
      ['0', 'COP', '04-07-2026 15:00', 'wompi-2', 'CAMP-2', '0', 'CARD', '50000.00', '', 'abono-1', 'Otra', '3000000001', 'otra@example.com', 'APROBADA'],
    ])),
    sourceFileName: '../../reporte privado.csv',
    providerHint: 'WOMPI',
  });

  assert.equal(report.preview.provider, 'WOMPI');
  assert.equal(report.preview.sourceFileName, 'reporte privado.csv');
  assert.equal(report.preview.rowCount, 2);
  assert.equal(report.preview.settlementCount, 1);
  assert.equal(report.preview.exactNet, false);
  assert.deepEqual(report.preview.totals[0], {
    currency: 'COP',
    currencyExponent: 2,
    rowCount: 2,
    exactRowCount: 0,
    incompleteRowCount: 2,
    grossAmountMinor: 15_000_000,
    feeAmountMinor: null,
    netAmountMinor: null,
  });
  assert.equal(report.transactions[0].feeAmountMinor, null);
  assert.equal(report.transactions[0].netAmountMinor, null);
  assert.equal(report.settlements[0].grossAmountMinor, 15_000_000);
  assert.equal(report.settlements[0].netAmountMinor, null);
  assert.ok(report.preview.ignoredSensitiveColumns.includes('correo electronico del pagador'));

  const rpc = serializeProviderReportForRpc(report);
  assert.equal(rpc.transactions[0].provider_transaction_id, 'wompi-1');
  assert.equal(Object.hasOwn(rpc.transactions[0], 'donor_email'), false);
  assert.equal(JSON.stringify(rpc).includes('persona@example.com'), false);
});

test('Stripe conserva la ecuación exacta y agrupa los movimientos por payout', () => {
  const report = parseProviderReportCsv({
    bytes: bytes(stripeCsv([
      ['acct_1', 'Organización', 'po_1', '2026-03-02 00:24:18', 'txn_1', '2026-02-26 18:58:53', '2026-03-02 00:00:00', 'usd', '340.00', '10.16', '329.84', 'charge', 'Donación'],
      ['acct_1', 'Organización', 'po_1', '2026-03-02 00:24:18', 'txn_2', '2026-02-27 18:58:53', '2026-03-02 00:00:00', 'usd', '220.00', '6.68', '213.32', 'charge', 'Evento'],
    ])),
    sourceFileName: 'stripe.csv',
  });

  assert.equal(report.preview.provider, 'STRIPE');
  assert.equal(report.preview.reportType, 'PAYOUT_RECONCILIATION');
  assert.equal(report.preview.exactNet, true);
  assert.equal(report.preview.settlementCount, 1);
  assert.equal(report.preview.totals[0].grossAmountMinor, 56_000);
  assert.equal(report.preview.totals[0].feeAmountMinor, 1_684);
  assert.equal(report.preview.totals[0].netAmountMinor, 54_316);
  assert.equal(report.settlements[0].netAmountMinor, 54_316);
  assert.equal(report.settlements[0].bankDepositAmountMinor, null);
});

test('rechaza un archivo duplicado internamente, una ecuación falsa y un proveedor incorrecto', () => {
  const duplicate = stripeCsv([
    ['acct_1', 'Org', 'po_1', '2026-03-02 00:24:18', 'txn_1', '2026-02-26 18:58:53', '2026-03-02 00:00:00', 'usd', '100.00', '3.20', '96.80', 'charge', 'Uno'],
    ['acct_1', 'Org', 'po_1', '2026-03-02 00:24:18', 'txn_1', '2026-02-27 18:58:53', '2026-03-02 00:00:00', 'usd', '100.00', '3.20', '96.80', 'charge', 'Dos'],
  ]);
  assert.throws(() => parseProviderReportCsv({ bytes: bytes(duplicate), sourceFileName: 'stripe.csv' }), /repite la transacción/i);

  const falseEquation = stripeCsv([
    ['acct_1', 'Org', 'po_1', '2026-03-02 00:24:18', 'txn_1', '2026-02-26 18:58:53', '2026-03-02 00:00:00', 'usd', '100.00', '3.20', '97.00', 'charge', 'Uno'],
  ]);
  assert.throws(() => parseProviderReportCsv({ bytes: bytes(falseEquation), sourceFileName: 'stripe.csv' }), /no coincide/i);

  assert.throws(() => parseProviderReportCsv({
    bytes: bytes(falseEquation.replace('97.00', '96.80')),
    sourceFileName: 'stripe.csv',
    providerHint: 'WOMPI',
  }), /corresponde a STRIPE/i);
});

test('rechaza fechas inexistentes, encabezados incompletos y filas mal formadas', () => {
  const invalidDate = wompiCsv([
    ['0', 'COP', '31-02-2026 14:43', 'wompi-1', 'REF', '0', 'PSE', '100000.00', '', 'abono-1', '', '', '', 'APROBADA'],
  ]);
  assert.throws(() => parseProviderReportCsv({ bytes: bytes(invalidDate), sourceFileName: 'wompi.csv' }), /fecha válida/i);
  assert.throws(() => parseProviderReportCsv({ bytes: bytes('id,monto\n1,100'), sourceFileName: 'otro.csv' }), /reconocer/i);
  assert.throws(() => parseProviderReportCsv({ bytes: bytes('a,b\n1'), sourceFileName: 'otro.csv' }), /no tiene 2 columnas/i);
});

test('el guardado es privado, atómico y exige confirmar la huella de la vista previa', () => {
  assert.match(IMPORT_SQL, /create or replace function public\.import_finance_provider_report_secure/i);
  assert.match(IMPORT_SQL, /security definer/i);
  assert.match(IMPORT_SQL, /revoke all on function public\.import_finance_provider_report_secure[\s\S]*authenticated/i);
  assert.match(IMPORT_SQL, /grant execute on function public\.import_finance_provider_report_secure[\s\S]*service_role/i);
  assert.match(IMPORT_SQL, /contradice bruto o moneda ya guardados/i);
  assert.match(IMPORT_API, /confirmationSha256/);
  assert.match(IMPORT_API, /canImportProvider/);
  assert.match(FINANCE_PAGE, /Vista previa verificada/);
  assert.match(FINANCE_PAGE, /máximo 4 MB y 10\.000 movimientos/);
});
