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

test('el footer intenta cargar el devocional actual sin bloquear la página', async () => {
  const [source, player] = await Promise.all([
    readProjectFile('src/components/Footer.astro'),
    readProjectFile('src/scripts/devotional-footer-player.js'),
  ]);

  assert.match(source, /const current = cached \?\? \{ ts: 0, data: fallbackDevotionalList \}/);
  assert.match(source, /Promise\.race\(\[/);
  assert.match(source, /setTimeout\(\(\) => resolve\(current\.data\), 320\)/);
  assert.match(source, /https:\/\/i\.ytimg\.com\/vi\/\$\{fallbackVideoId\}\/hqdefault\.jpg/);
  assert.doesNotMatch(source, /front-devocional-mana\.png/);
  assert.match(player, /!state\.ytPlayer && !frame\.getAttribute\('src'\)[\s\S]*?buildEmbedUrl\(videoId, true\)[\s\S]*?ensureYouTubePlayer\(player\)/);
});

test('el detalle público de Peticiones anuncia el diálogo y devuelve el foco', async () => {
  const [view, logic] = await Promise.all([
    readProjectFile('src/components/PrayerWall.astro'),
    readProjectFile('src/scripts/prayer-wall.js'),
  ]);

  assert.match(view, /data-prayer-detail hidden aria-live="polite" role="dialog" aria-modal="false"/);
  assert.match(logic, /detail\.querySelector\('\[data-prayer-detail-close\]'\)\?\.focus\(\)/);
  assert.match(logic, /event\.key !== 'Escape'/);
  assert.match(logic, /trigger instanceof HTMLElement && trigger\.isConnected/);
});

test('Peticiones reserva ranuras reales y mantiene papeles accesibles', async () => {
  const [view, logic] = await Promise.all([
    readProjectFile('src/components/PrayerWall.astro'),
    readProjectFile('src/scripts/prayer-wall.js'),
  ]);

  assert.match(logic, /position\[4\] === 'vertical'/);
  assert.match(logic, /note\.setAttribute\('role', 'button'\)/);
  assert.match(logic, /note\.setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(logic, /MOBILE_SLOTS\.length : DESKTOP_SLOTS\.length/);
  assert.doesNotMatch(logic, /dataset\.labelSide/);
  assert.match(view, /\.prayer-note\[data-paper-orientation="vertical"\]/);
  assert.match(view, /#muro,[\s\S]*?#peticion[\s\S]*?--layout-prayer-anchor-offset:[\s\S]*?var\(--space-4\)[\s\S]*?scroll-margin-top: var\(--layout-prayer-anchor-offset\)/);
  assert.match(view, /min-height: 2\.75rem/);
  assert.match(view, /font-family: "Summer Loving", "Segoe Print", cursive/);
});

test('el mapa público mantiene marcadores y acciones con área táctil accesible', async () => {
  const [map, directory] = await Promise.all([
    readProjectFile('src/components/ChurchesMap.astro'),
    readProjectFile('src/pages/iglesias/index.astro'),
  ]);

  assert.match(map, /iconSize: \[44, 44\]/);
  assert.match(map, /marker\.getElement\(\)\?\.setAttribute\('aria-label'/);
  assert.match(map, /\.leaflet-popup-close-button[\s\S]*height: 44px/);
  assert.match(map, /\.mana-popup-btn[\s\S]*min-height: 44px/);
  assert.match(directory, /class="flex min-h-11 items-center justify-center gap-2 py-3/);
});

test('el selector de idioma funciona con CSP y declara el idioma del documento', async () => {
  const [switchView, switchLogic, layout] = await Promise.all([
    readProjectFile('src/components/LangSwitch.astro'),
    readProjectFile('src/scripts/lang-switch.js'),
    readProjectFile('src/layouts/BaseLayout.astro'),
  ]);

  assert.match(switchView, /data-language-switch/);
  assert.match(switchView, /data-next-locale=\{next\}/);
  assert.doesNotMatch(switchView, /onclick=/);
  assert.match(switchLogic, /document\.addEventListener\('click'/);
  assert.match(switchLogic, /SameSite=Lax/);
  assert.match(layout, /<html lang=\{documentLocale\}/);
});

test('la cuenta pública se resincroniza después de navegar sin mostrar un login falso', async () => {
  const [view, logic] = await Promise.all([
    readProjectFile('src/components/AccountButton.astro'),
    readProjectFile('src/scripts/account-button.js'),
  ]);

  assert.match(view, /data-account-button aria-busy="true"/);
  assert.match(view, /data-account-loading/);
  assert.match(logic, /document\.addEventListener\('astro:page-load', checkSession\)/);
  assert.match(logic, /supabase\.auth\.onAuthStateChange/);
  assert.match(logic, /window\.addEventListener\('pageshow', checkSession\)/);
});

test('la ruta histórica en inglés de eventos conserva compatibilidad', async () => {
  const source = await readProjectFile('src/pages/events/[...path].astro');

  assert.match(source, /`\/eventos\$\{path \? `\/\$\{path\}` : ''\}\$\{Astro\.url\.search\}`/);
  assert.match(source, /Astro\.redirect\(destination, 301\)/);
});

test('las historias usan contraste oscuro solo cuando la escena realmente tiene foto', async () => {
  const source = await readProjectFile('src/components/cms/CmsStorySection.astro');

  assert.match(source, /const hasBackdropMedia = Boolean\(image\) && \(isBackdrop \|\| isPoster\)/);
  assert.match(source, /hasBackdropMedia && 'cms-story-panel--media'/);
  assert.match(source, /\.cms-story-panel--media \{[\s\S]*?color: #fff;/);
  assert.match(source, /\.cms-story-panel--media \.cms-story-title \{[\s\S]*?color: #fff;/);
  assert.doesNotMatch(source, /\.cms-story-panel--backdrop,\s*\n\s*\.cms-story-panel--poster \{/);
});

test('Campus etiqueta los datos de pago y deshabilita la acción inválida', async () => {
  const [view, logic] = await Promise.all([
    readProjectFile('src/components/campus/DonationForm.astro'),
    readProjectFile('src/scripts/campus-donation.js'),
  ]);

  assert.match(view, /for=\{amountInputId\}/);
  assert.match(view, /autocomplete="name"/);
  assert.match(view, /autocomplete="email"/);
  assert.match(view, /role="alert" aria-live="assertive"/);
  assert.match(view, /<button type="button" disabled class="donate-cta/);
  assert.match(logic, /this\.dom\.cta\.disabled = !ctaEnabled/);
});
