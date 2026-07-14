import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readSource = async (path) => readFile(new URL(path, root), 'utf8');

test('el layout compartido permite saltar al contenido y anuncia el diálogo global', async () => {
  const layout = await readSource('src/layouts/BaseLayout.astro');

  assert.match(layout, /href="#main-content"[^>]*class="skip-link"/);
  assert.match(layout, /<main id="main-content" tabindex="-1"/);
  assert.match(layout, /mainContent\.focus\(\{ preventScroll: true \}\)/);
  assert.match(layout, /history\.replaceState\(null, '', '#main-content'\)/);
  assert.match(layout, /id="app-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title" aria-hidden="true"/);
  assert.match(layout, /id="app-modal-close"[^>]*aria-label="Cerrar aviso"[^>]*h-11 w-11/);
});

test('el diálogo global encierra el foco, cierra con Escape y devuelve el foco', async () => {
  const modal = await readSource('src/scripts/app-modal.js');

  assert.match(modal, /getModalFocusableElements/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /modalReturnFocus\?\.focus\(\)/);
  assert.match(modal, /setAttribute\('aria-hidden', 'false'\)/);
  assert.match(modal, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(modal, /document\.addEventListener\('invalid'/);
  assert.match(modal, /queueMicrotask\(\(\) => \{/);
  assert.match(modal, /setAttribute\('aria-invalid', 'true'\)/);
});

test('la navegación interna conserva ubicación, permisos visibles y controles táctiles', async () => {
  const sidebar = await readSource('src/components/portal/Sidebar.astro');
  const links = [...sidebar.matchAll(/<a href="\/portal[^>]+class="([^"]+)"/g)];

  assert.ok(links.length >= 10, 'debe cubrir las rutas principales del portal');
  for (const [, className] of links) {
    assert.match(className, /\bmin-h-11\b/);
  }
  assert.match(sidebar, /setAttribute\('aria-current', 'page'\)/);
  assert.match(sidebar, /event\.key !== 'Escape'/);
  assert.match(sidebar, /getPortalSession/);
});

test('ingreso, registro y activación mantienen etiquetas, ayuda y estados accesibles', async () => {
  const [login, register, activate] = await Promise.all([
    readSource('src/pages/portal/ingresar.astro'),
    readSource('src/pages/portal/registro.astro'),
    readSource('src/pages/portal/activar.astro'),
  ]);

  assert.match(login, /label for="password-email"/);
  assert.match(login, /id="login-status-container"[^>]*role="status" aria-live="polite"/);
  assert.match(register, /aria-describedby="reg-password-help"/);
  assert.match(register, /href="\/privacidad"/);
  assert.match(register, /grid-cols-1[^\n]+sm:grid-cols-2/);
  assert.match(activate, /aria-describedby="activate-password-help"/);
  assert.match(activate, /id="activate-status-container"[^>]*role="status" aria-live="polite"/);
});
