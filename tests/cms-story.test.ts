import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CMS_STORY_MAX_SCENES,
  createDefaultCmsStoryPayload,
  normalizeCmsStoryPayload,
} from '../src/lib/cmsStory.ts';

test('crea una historia guiada con tres escenas y opciones seguras', () => {
  const payload = createDefaultCmsStoryPayload('Una iglesia para todos');
  assert.equal(payload.preset, 'editorial');
  assert.equal(payload.theme, 'navy');
  assert.equal(payload.scenes.length, 3);
  assert.equal(payload.scenes[0].title, 'Una iglesia para todos');
});

test('normaliza opciones desconocidas y elimina URLs inseguras', () => {
  const result = normalizeCmsStoryPayload({
    preset: 'rapido',
    theme: 'neon',
    scenes: [{
      id: '<script>',
      title: 'Escena',
      image: 'javascript:alert(1)',
      primaryHref: 'http://inseguro.test',
      layout: 'freeform',
      focalPoint: 'outside',
      ignored: '<img onerror=alert(1)>',
    }],
  });

  assert.equal(result.payload.preset, 'editorial');
  assert.equal(result.payload.theme, 'navy');
  assert.equal(result.payload.scenes[0].image, '');
  assert.equal(result.payload.scenes[0].primaryHref, '');
  assert.equal(result.payload.scenes[0].layout, 'backdrop');
  assert.equal(result.payload.scenes[0].focalPoint, 'center');
  assert.equal('ignored' in result.payload.scenes[0], false);
});

test('la publicación exige escenas completas y accesibles', () => {
  const incomplete = normalizeCmsStoryPayload({
    scenes: [{ title: 'Solo una', image: 'https://ik.imagekit.io/mana/una.webp' }],
  }, { requirePublishable: true });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.errors.join(' '), /al menos 2 escenas/i);
  assert.match(incomplete.errors.join(' '), /Describe la imagen/i);

  const complete = normalizeCmsStoryPayload({
    scenes: [
      { title: 'Uno', image: '/uno.webp', imageAlt: 'Comunidad reunida' },
      { title: 'Dos', image: 'https://ik.imagekit.io/mana/dos.webp', imageAlt: 'Pastores conversando' },
    ],
  }, { requirePublishable: true });
  assert.equal(complete.ok, true);
});

test('limita el número de escenas sin inflar el documento', () => {
  const result = normalizeCmsStoryPayload({
    scenes: Array.from({ length: CMS_STORY_MAX_SCENES + 4 }, (_, index) => ({ title: `Escena ${index}` })),
  });
  assert.equal(result.payload.scenes.length, CMS_STORY_MAX_SCENES);
  assert.match(result.errors[0], /máximo 8 escenas/i);
});
