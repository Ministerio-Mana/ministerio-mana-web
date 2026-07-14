import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('el componente Historia Maná publica un contrato común y restringido', async () => {
  const source = await readProjectFile('src/components/story/ManaStoryDeck.astro');

  assert.match(source, /data-mana-story-deck/);
  assert.match(source, /data-story-preset=\{preset\}/);
  assert.match(source, /data-cumbre-static-breakpoint/);
  assert.match(source, /isStoryMotionPreset/);
});

test('Peregrinaciones usa el preset editorial sin anidar otro main', async () => {
  const source = await readProjectFile('src/pages/peregrinaciones/turquia-islas-griegas-2026.astro');

  assert.match(source, /<ManaStoryDeck[\s\S]*preset="editorial"/);
  assert.doesNotMatch(source, /<main class="pilgrim-page"/);
});

test('la bienvenida de Cumbre conserva el preset cinematográfico sin main anidado', async () => {
  const source = await readProjectFile('src/pages/eventos/cumbre-mundial-2026/bienvenida.astro');

  assert.match(source, /<ManaStoryDeck[\s\S]*as="section"[\s\S]*preset="cinematic"/);
  assert.doesNotMatch(source, /<main class="cumbre-welcome-story"/);
});

test('el Home deja todas las escenas accesibles en modo estático', async () => {
  const source = await readProjectFile('src/pages/home-ministerio.astro');

  assert.match(source, /const prefersStatic = prefersReduced \|\| window\.matchMedia\('\(max-width: 519px\)'\)\.matches/);
  assert.match(source, /scene\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(source, /@media \(max-width: 519px\)/);
  assert.doesNotMatch(source, /Volver a Cumbre/);
});
