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

test('el panel principal conserva una jerarquía única y pestañas anunciables', async () => {
  const panel = await readSource('src/pages/portal/index.astro');
  const h1Headings = [...panel.matchAll(/<h1\b/g)];

  assert.equal(h1Headings.length, 1, 'el panel debe tener un solo h1');
  assert.match(panel, /id="tab-resumen"[^>]*role="region"[^>]*aria-labelledby="tab-resumen-title"[^>]*aria-hidden="false"/);
  assert.match(panel, /id="tab-perfil"[^>]*role="region"[^>]*aria-labelledby="tab-perfil-title"[^>]*aria-hidden="true"/);
  assert.match(panel, /id="account-loading"[^>]*role="status" aria-live="polite"/);
  assert.doesNotMatch(panel, /onclick=/);
});

test('los diálogos del panel controlan foco, Escape y tamaños táctiles', async () => {
  const [panel, dashboard] = await Promise.all([
    readSource('src/pages/portal/index.astro'),
    readSource('src/scripts/portal-dashboard.js'),
  ]);

  for (const id of ['onboarding-modal', 'portal-alert-modal', 'portal-confirm-modal', 'booking-inspector-modal']) {
    assert.match(panel, new RegExp(`id="${id}"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-[^>]+aria-hidden="true"`));
  }
  for (const id of ['portal-alert-close', 'portal-confirm-close', 'booking-inspector-close']) {
    assert.match(panel, new RegExp(`id="${id}"[^>]*aria-label="[^"]+"[^>]*w-11 h-11`));
  }
  assert.match(dashboard, /function getPortalModalFocusables/);
  assert.match(dashboard, /event\.key === 'Escape'/);
  assert.match(dashboard, /event\.key !== 'Tab'/);
  assert.match(dashboard, /returnFocus\?\.focus\(\)/);
  assert.match(dashboard, /content\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(dashboard, /content\.setAttribute\('aria-hidden', 'true'\)/);
});

test('los controles generados por el panel mantienen objetivos táctiles y nombres accesibles', async () => {
  const [panel, dashboard] = await Promise.all([
    readSource('src/pages/portal/index.astro'),
    readSource('src/scripts/portal-dashboard.js'),
  ]);

  assert.match(panel, /id="church-participants-page-size"[^>]*min-h-11 min-w-11/);
  assert.match(dashboard, /btn-view-participant-booking min-h-11/);
  assert.match(dashboard, /church-installment-action min-h-11/);
  assert.match(dashboard, /admin-followups-page-btn min-h-11/);
  assert.match(dashboard, /data-role="assign-church" aria-label="Asignar una iglesia a \$\{safeContactLabel\}"[^>]*min-h-11/);
});

test('el selector de iglesias y el registro manual protegen foco, datos y formularios largos', async () => {
  const [selectorView, selectorLogic, registrationView, registrationLogic] = await Promise.all([
    readSource('src/components/portal/ChurchSelector.astro'),
    readSource('src/scripts/ChurchSelector.js'),
    readSource('src/components/portal/RegistrationModal.astro'),
    readSource('src/scripts/RegistrationModal.js'),
  ]);

  assert.match(selectorView, /id="church-selector-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/);
  assert.match(selectorView, /id="close-church-selector"[^>]*aria-label="Cerrar selector de iglesias"[^>]*h-11 w-11/);
  assert.match(selectorLogic, /const escapeHtml =/);
  assert.match(selectorLogic, /handleModalKeydown\(event\)/);
  assert.match(selectorLogic, /setAttribute\('aria-hidden', 'false'\)/);
  assert.match(selectorLogic, /this\.returnFocus\?\.focus\(\)/);

  assert.match(registrationView, /id="manual-registration-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/);
  assert.match(registrationView, /id="custom-alert-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/);
  assert.match(registrationLogic, /handleModalKeydown\(event\)/);
  assert.match(registrationLogic, /handleAlertKeydown\(event\)/);
  assert.doesNotMatch(registrationLogic, /if \(e\.target === this\.modal\) this\.close\(\)/);
});

test('gestión de eventos protege el formulario largo y mantiene controles táctiles', async () => {
  const [eventsView, eventsLogic] = await Promise.all([
    readSource('src/pages/portal/events.astro'),
    readSource('src/scripts/portal-events.js'),
  ]);

  assert.match(eventsView, /id="event-filters"[^>]*role="group"[^>]*aria-label="Estado del evento"/);
  assert.match(eventsView, /data-event-filter="active" aria-pressed="true"/);
  assert.match(eventsView, /id="event-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="event-modal-title"[^>]*aria-hidden="true"/);
  assert.match(eventsView, /id="close-modal"[^>]*h-11 w-11[^>]*aria-label="Cerrar formulario de evento"/);
  assert.match(eventsView, /\.event-filter \{[\s\S]*?min-height: 44px;/);
  assert.match(eventsView, /:global\(\.event-action\) \{[\s\S]*?min-height: 44px;/);
  assert.match(eventsView, /:global\(\.event-calendar-confirm\) \{[\s\S]*?min-height: 44px;/);

  assert.match(eventsLogic, /function getEventModalFocusableElements\(\)/);
  assert.match(eventsLogic, /function requestCloseEventModal\(\)/);
  assert.match(eventsLogic, /event\.key === 'Escape'[\s\S]*?closeModal\?\.focus\(\)/);
  assert.match(eventsLogic, /event\.key !== 'Tab'/);
  assert.match(eventsLogic, /eventModalReturnFocus/);
  assert.match(eventsLogic, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(eventsLogic, /event\.target === eventModal\) closeEventModal\(\)/);
});
