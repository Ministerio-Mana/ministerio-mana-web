import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EVENT_ATTENDANCE_MODE,
  DEFAULT_EVENT_TIMEZONE,
  isValidEventTimeZone,
  normalizeAttendanceMode,
  normalizeEventTimeZone,
} from '../src/lib/eventContract.js';
import {
  getRequiredEventProviderCurrency,
  isValidEventProviderCurrency,
} from '../src/lib/eventPaymentContract.js';

test('normaliza etiquetas visibles de zona horaria al identificador IANA', () => {
  assert.equal(normalizeEventTimeZone('Colombia · Bogotá'), 'America/Bogota');
  assert.equal(normalizeEventTimeZone('Bogotá'), 'America/Bogota');
  assert.equal(normalizeEventTimeZone('México · Ciudad de México'), 'America/Mexico_City');
  assert.equal(normalizeEventTimeZone('', DEFAULT_EVENT_TIMEZONE), 'America/Bogota');
  assert.equal(isValidEventTimeZone('Colombia · Bogotá'), true);
});

test('normaliza etiquetas visibles de modalidad al identificador SQL', () => {
  assert.equal(normalizeAttendanceMode('Presencial'), 'IN_PERSON');
  assert.equal(normalizeAttendanceMode('Virtual'), 'ONLINE');
  assert.equal(normalizeAttendanceMode('Híbrido'), 'HYBRID');
  assert.equal(normalizeAttendanceMode('IN_PERSON'), 'IN_PERSON');
  assert.equal(normalizeAttendanceMode('', DEFAULT_EVENT_ATTENDANCE_MODE), 'IN_PERSON');
});

test('conserva valores desconocidos para que la API pueda rechazarlos', () => {
  assert.equal(normalizeEventTimeZone('Mars/Olympus_Mons'), 'Mars/Olympus_Mons');
  assert.equal(isValidEventTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(normalizeAttendanceMode('telepathy'), 'TELEPATHY');
});

test('aplica la moneda obligatoria de cada cobro automático', () => {
  assert.equal(getRequiredEventProviderCurrency('WOMPI'), 'COP');
  assert.equal(getRequiredEventProviderCurrency('stripe'), 'USD');
  assert.equal(isValidEventProviderCurrency('WOMPI', 'COP'), true);
  assert.equal(isValidEventProviderCurrency('WOMPI', 'USD'), false);
  assert.equal(isValidEventProviderCurrency('STRIPE', 'USD'), true);
  assert.equal(isValidEventProviderCurrency('STRIPE', 'COP'), false);
});
