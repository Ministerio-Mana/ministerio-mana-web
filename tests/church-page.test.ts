import assert from 'node:assert/strict';
import test from 'node:test';
import {
  churchMediaFolder,
  createChurchPageDraft,
  normalizeChurchPageDraft,
  normalizeChurchPageSlug,
  validateChurchPageForPublish,
} from '../src/lib/churchPage.ts';

test('la biblioteca usa un identificador estable y no el nombre editable', () => {
  assert.equal(
    churchMediaFolder({ id: '4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4', name: 'Nombre anterior' }),
    'iglesias/4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4',
  );
  assert.equal(
    churchMediaFolder({ id: '4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4', code: 'MANA-BOGOTA', name: 'Nombre nuevo' }),
    'iglesias/mana-bogota',
  );
});

test('normaliza enlaces públicos de iglesias sin caracteres inseguros', () => {
  assert.equal(normalizeChurchPageSlug(' Maná Belén / Medellín '), 'mana-belen-medellin');
  assert.equal(normalizeChurchPageSlug('a'), '');
});

test('limita galerías, URLs y teléfono a valores públicos válidos', () => {
  const page = normalizeChurchPageDraft({
    slug: 'iglesia-prueba',
    display_name: 'Iglesia Prueba',
    hero_image_url: 'javascript:alert(1)',
    contact_whatsapp: '+57 (300) 123-4567',
    gallery: Array.from({ length: 12 }, (_, index) => ({ url: `https://ik.imagekit.io/test/${index}.jpg`, alt: `Foto ${index}` })),
  });
  assert.equal(page.hero_image_url, '');
  assert.equal(page.contact_whatsapp, '573001234567');
  assert.equal(page.gallery.length, 8);
});

test('la plantilla esencial publica información completa sin exigir escenas', () => {
  const base = createChurchPageDraft({ name: 'Maná Prueba', code: 'mana-prueba' });
  const result = validateChurchPageForPublish({
    ...base,
    tagline: 'Una familia para crecer',
    description: 'Una comunidad local abierta para caminar juntos.',
    hero_image_url: 'https://ik.imagekit.io/test/hero.jpg',
    hero_image_alt: 'Comunidad reunida',
    service_schedule: 'Domingos · 10:00 a. m.',
    contact_whatsapp: '+57 300 123 4567',
  });
  assert.equal(result.ok, true);
});

test('Historia y Mosaico requieren al menos dos escenas publicables', () => {
  const result = validateChurchPageForPublish({
    slug: 'mana-prueba',
    template: 'STORY',
    display_name: 'Maná Prueba',
    tagline: 'Una familia para crecer',
    description: 'Una comunidad local abierta para caminar juntos.',
    hero_image_url: 'https://ik.imagekit.io/test/hero.jpg',
    hero_image_alt: 'Comunidad reunida',
    service_schedule: 'Domingos · 10:00 a. m.',
    contact_email: 'iglesia@example.org',
    story_config: { preset: 'editorial', theme: 'navy', scenes: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /al menos 2 escenas/i);
});
