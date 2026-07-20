import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasEventLandingContent, normalizeEventLandingSettings } from '../src/lib/eventLanding.ts';

test('normaliza los bloques guiados sin aceptar markup ni estructura libre', () => {
  const settings = normalizeEventLandingSettings({
    template: 'STORY',
    theme: 'warm',
    promote_on_church_pages: true,
    promotion_priority: 50,
    promotion_eyebrow: '',
    whatToExpect: '  Adoración   y palabra  ',
    agenda: '09:00 Registro\n\n\n10:00 Plenaria',
    practicalInfo: 'Trae tu documento',
    hostInfo: 'Equipo pastoral',
    accessibilityInfo: 'Acceso por rampa',
    frequentlyAskedQuestions: '¿Puedo ir con niños? Sí.',
    changePolicy: 'Los cambios se informarán por correo.',
    arbitrary_html: '<script>alert(1)</script>',
  });
  assert.deepEqual(settings, {
    template: 'STORY',
    theme: 'warm',
    promote_on_church_pages: true,
    promotion_priority: 50,
    promotion_eyebrow: '',
    what_to_expect: 'Adoración y palabra',
    agenda: '09:00 Registro\n\n10:00 Plenaria',
    practical_info: 'Trae tu documento',
    host_info: 'Equipo pastoral',
    accessibility_info: 'Acceso por rampa',
    frequently_asked_questions: '¿Puedo ir con niños? Sí.',
    change_policy: 'Los cambios se informarán por correo.',
  });
  assert.equal(hasEventLandingContent(settings), true);
});

test('limita cada bloque y reconoce una landing vacía', () => {
  assert.equal(normalizeEventLandingSettings({ agenda: 'x'.repeat(3000) }).agenda.length, 1600);
  assert.equal(hasEventLandingContent({}), false);
  assert.deepEqual(normalizeEventLandingSettings({ template: 'LIBRE', theme: 'neon' }), {
    template: 'ESSENTIAL',
    theme: 'navy',
    promote_on_church_pages: true,
    promotion_priority: 50,
    promotion_eyebrow: '',
    what_to_expect: '',
    agenda: '',
    practical_info: '',
    host_info: '',
    accessibility_info: '',
    frequently_asked_questions: '',
    change_policy: '',
  });
});

test('protege la configuración promocional para las páginas de iglesias', () => {
  const settings = normalizeEventLandingSettings({
    promoteOnChurchPages: 'false',
    promotionPriority: 900,
    promotionEyebrow: '  Una   experiencia global  ',
  });
  assert.equal(settings.promote_on_church_pages, false);
  assert.equal(settings.promotion_priority, 100);
  assert.equal(settings.promotion_eyebrow, 'Una experiencia global');
});

test('conserva la capitalización natural de las fechas en español', () => {
  const source = readFileSync(new URL('../src/pages/eventos/[slug].astro', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /class="[^"]*capitalize[^"]*"[^>]*>\{formattedSchedule\}/);
});
