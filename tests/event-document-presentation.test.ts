import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDocumentActivityDate,
  eventDocumentPresentation,
  isEventRegistrationsWorkbook,
} from '../src/lib/eventDocumentPresentation.ts';

test('identifica el Excel de inscripciones sin depender de mayúsculas', () => {
  assert.equal(isEventRegistrationsWorkbook({ original_name: 'Inscripciones.xlsx' }), true);
  assert.equal(isEventRegistrationsWorkbook({ original_name: 'INSCRIPCIONES.XLSX' }), true);
  assert.equal(isEventRegistrationsWorkbook({ original_name: 'permiso.pdf', mime_type: 'application/pdf' }), false);
});

test('usa la fecha de actualización para un archivo reemplazado', () => {
  assert.equal(eventDocumentActivityDate({
    created_at: '2026-07-13T10:00:00.000Z',
    updated_at: '2026-07-14T15:30:00.000Z',
  }), '2026-07-14T15:30:00.000Z');
});

test('presenta el libro como Excel web y conserva documentos genéricos', () => {
  assert.deepEqual(eventDocumentPresentation({
    original_name: 'Inscripciones.xlsx',
    updated_at: '2026-07-14T15:30:00.000Z',
  }), {
    isWorkbook: true,
    activityDate: '2026-07-14T15:30:00.000Z',
    dateLabel: 'Actualizado',
    actionLabel: 'Abrir en Excel web',
  });
  assert.equal(eventDocumentPresentation({ original_name: 'permiso.pdf' }).dateLabel, 'Subido');
});
