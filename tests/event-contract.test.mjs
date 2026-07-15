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
  canUseEventPaymentModeForScope,
  getEventPaymentProvidersForMode,
  getEventProviderPrice,
  getRequiredEventProviderCurrency,
  isValidEventProviderCurrency,
  normalizeEventOnlinePaymentMode,
} from '../src/lib/eventPaymentContract.js';
import { getEventInvitationBounds, getEventInvitationLayout } from '../src/lib/eventInvitationLayout.js';
import { selectPreferredEventPayments, summarizeEventPayments } from '../src/lib/eventPaymentReporting.js';
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

test('configura cobro dual únicamente para eventos globales', () => {
  assert.equal(normalizeEventOnlinePaymentMode('dual'), 'DUAL');
  assert.deepEqual(getEventPaymentProvidersForMode('DUAL'), ['WOMPI', 'STRIPE']);
  assert.deepEqual(getEventPaymentProvidersForMode('STRIPE'), ['STRIPE']);
  assert.equal(canUseEventPaymentModeForScope('DUAL', 'GLOBAL'), true);
  assert.equal(canUseEventPaymentModeForScope('DUAL', 'NATIONAL'), false);
  assert.equal(canUseEventPaymentModeForScope('WOMPI', 'NATIONAL', 'Colombia'), true);
  assert.equal(canUseEventPaymentModeForScope('WOMPI', 'NATIONAL', 'Francia'), false);
  assert.equal(canUseEventPaymentModeForScope('WOMPI', 'LOCAL', 'Colombia'), false);
  assert.equal(canUseEventPaymentModeForScope('STRIPE', 'GLOBAL'), true);
  assert.equal(canUseEventPaymentModeForScope('STRIPE', 'NATIONAL', 'Ecuador'), false);
});

test('mantiene precios COP y USD separados con respaldo para eventos anteriores', () => {
  const dual = { price: 300000, currency: 'COP', price_cop: 300000, price_usd: 80 };
  assert.equal(getEventProviderPrice(dual, 'WOMPI'), 300000);
  assert.equal(getEventProviderPrice(dual, 'STRIPE'), 80);
  assert.equal(getEventProviderPrice({ price: 55, currency: 'USD' }, 'STRIPE'), 55);
  assert.equal(getEventProviderPrice({ price: 300000, currency: 'COP' }, 'STRIPE'), 0);
});

test('prioriza el pago aprobado y reporta cada moneda por separado', () => {
  const payments = [
    { registration_id: 'r1', provider: 'WOMPI', currency: 'COP', amount: 300000, status: 'APPROVED', created_at: '2026-07-13T10:00:00Z' },
    { registration_id: 'r1', provider: 'WOMPI', currency: 'COP', amount: 300000, status: 'FAILED', created_at: '2026-07-13T10:05:00Z' },
    { registration_id: 'r2', provider: 'STRIPE', currency: 'USD', amount: 80, status: 'APPROVED', created_at: '2026-07-13T10:02:00Z' },
  ];
  assert.equal(selectPreferredEventPayments(payments).get('r1').status, 'APPROVED');
  assert.deepEqual(summarizeEventPayments(payments), [
    { provider: 'WOMPI', currency: 'COP', payment_count: 2, approved_count: 1, approved_amount: 300000, pending_count: 0 },
    { provider: 'STRIPE', currency: 'USD', payment_count: 1, approved_count: 1, approved_amount: 80, pending_count: 0 },
  ]);
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
  }), { phone: 'REQUIRED', church: true, whatsapp_updates: true, fields: [] });
  assert.deepEqual(normalizeEventRegistrationFormConfig({ phone: 'cualquiera' }), {
    phone: 'OPTIONAL', church: false, whatsapp_updates: false, fields: [],
  });
  assert.equal(normalizeWhatsAppNumber('+57 (300) 123-4567'), '573001234567');
  assert.equal(normalizeWhatsAppNumber('123'), '');
});

test('limita y normaliza las preguntas configurables de un evento', () => {
  const config = normalizeEventRegistrationFormConfig({
    fields: [
      { id: 'field_pregunta01', type: 'short_text', label: 'Ciudad de origen', required: true },
      { id: 'field_opciones01', type: 'multiple_choice', label: 'Intereses', options: ['Niños', 'Jóvenes', 'Niños'] },
      { id: 'campo_invalido', type: 'DATE', label: 'No debe entrar' },
    ],
  });
  assert.deepEqual(config.fields, [
    { id: 'field_pregunta01', type: 'SHORT_TEXT', label: 'Ciudad de origen', help_text: '', required: true, options: [] },
    { id: 'field_opciones01', type: 'MULTIPLE_CHOICE', label: 'Intereses', help_text: '', required: false, options: ['Niños', 'Jóvenes'] },
  ]);
});
