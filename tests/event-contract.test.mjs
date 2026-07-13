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
import { getEventInvitationBounds, getEventInvitationLayout } from '../src/lib/eventInvitationLayout.js';
import { normalizeEventRegistrationFormConfig, normalizeWhatsAppNumber } from '../src/lib/eventRegistrationForm.js';

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

test('elige la plantilla de invitación sin pedir medidas al usuario', () => {
  assert.equal(getEventInvitationLayout(1600, 900), 'HORIZONTAL');
  assert.equal(getEventInvitationLayout(1080, 1080), 'SQUARE');
  assert.equal(getEventInvitationLayout(1080, 1350), 'VERTICAL');
  assert.deepEqual(getEventInvitationBounds('HORIZONTAL'), { width: 1600, height: 1200 });
  assert.deepEqual(getEventInvitationBounds('SQUARE'), { width: 1200, height: 1200 });
  assert.deepEqual(getEventInvitationBounds('VERTICAL'), { width: 1080, height: 1350 });
});

test('normaliza una configuración simple de formulario y WhatsApp', () => {
  assert.deepEqual(normalizeEventRegistrationFormConfig({
    phone: 'required',
    church: 1,
    whatsapp_updates: true,
  }), { phone: 'REQUIRED', church: true, whatsapp_updates: true });
  assert.deepEqual(normalizeEventRegistrationFormConfig({ phone: 'cualquiera' }), {
    phone: 'OPTIONAL', church: false, whatsapp_updates: false,
  });
  assert.equal(normalizeWhatsAppNumber('+57 (300) 123-4567'), '573001234567');
  assert.equal(normalizeWhatsAppNumber('123'), '');
});
