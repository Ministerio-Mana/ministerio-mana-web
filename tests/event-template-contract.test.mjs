import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editorSource = readFileSync(new URL('../src/pages/portal/events.astro', import.meta.url), 'utf8');
const editorScript = readFileSync(new URL('../src/scripts/portal-events.js', import.meta.url), 'utf8');
const publicPageSource = readFileSync(new URL('../src/pages/eventos/[slug].astro', import.meta.url), 'utf8');

test('el editor ofrece solo las tres plantillas protegidas y las tres paletas aprobadas', () => {
  for (const template of ['ESSENTIAL', 'STORY', 'MOSAIC']) {
    assert.match(editorSource, new RegExp(`name="page_template" value="${template}"`));
  }
  for (const theme of ['navy', 'light', 'warm']) {
    assert.match(editorSource, new RegExp(`name="page_theme" value="${theme}"`));
  }
  assert.match(editorSource, /El sistema conserva contraste, espacios y adaptación móvil/);
});

test('plantilla y paleta se cargan, previsualizan y guardan dentro de page_settings', () => {
  assert.match(editorScript, /landingSettings\.template/);
  assert.match(editorScript, /landingSettings\.theme/);
  assert.match(editorScript, /previewCard\.dataset\.template/);
  assert.match(editorScript, /previewCard\.dataset\.theme/);
  assert.match(editorScript, /payload\.page_settings = normalizeEventLandingSettings/);
});

test('la página pública conecta Historia con Stories Plus y mantiene variantes Esencial y Mosaico', () => {
  assert.match(publicPageSource, /<CmsStorySection payload=\{eventStoryPayload\}/);
  assert.match(publicPageSource, /landingTemplate !== 'STORY'/);
  assert.match(publicPageSource, /event-public--mosaic/);
  assert.match(publicPageSource, /event-public--theme-/);
});
