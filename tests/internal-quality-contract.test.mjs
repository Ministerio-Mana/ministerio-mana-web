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
  assert.match(eventsView, /:global\(\.event-calendar \.flatpickr-time input\) \{[\s\S]*?min-height: 44px;/);

  assert.match(eventsLogic, /function getEventModalFocusableElements\(\)/);
  assert.match(eventsLogic, /function requestCloseEventModal\(\)/);
  assert.match(eventsLogic, /event\.key === 'Escape'[\s\S]*?closeModal\?\.focus\(\)/);
  assert.match(eventsLogic, /event\.key !== 'Tab'/);
  assert.match(eventsLogic, /eventModalReturnFocus/);
  assert.match(eventsLogic, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(eventsLogic, /event\.target === eventModal\) closeEventModal\(\)/);
});

test('la operación del evento protege comprobantes, revisión y asistencia', async () => {
  const [operationView, operationLogic] = await Promise.all([
    readSource('src/pages/portal/events/[id].astro'),
    readSource('src/scripts/portal-event-operation.js'),
  ]);

  assert.match(operationView, /href="\/portal\/events"[^>]*min-h-11/);
  assert.match(operationView, /id="event-documents-refresh"[^>]*min-h-11/);
  assert.match(operationView, /data-page-action="previous"[^>]*min-h-11/);
  assert.match(operationView, /id="event-review-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="event-review-title"[^>]*aria-describedby="event-review-summary"[^>]*aria-hidden="true"/);
  assert.match(operationView, /id="event-review-close"[^>]*h-11 w-11[^>]*aria-label="Cerrar revisión de pago"/);

  assert.match(operationLogic, /Ver comprobante<\/a>/);
  assert.match(operationLogic, /event-review-action inline-flex min-h-11/);
  assert.match(operationLogic, /event-checkin-action inline-flex min-h-11/);
  assert.match(operationLogic, /function getReviewModalFocusableElements\(\)/);
  assert.match(operationLogic, /function requestCloseReviewModal\(\)/);
  assert.match(operationLogic, /event\.key === 'Escape'[\s\S]*?reviewClose\?\.focus\(\)/);
  assert.match(operationLogic, /reviewModalReturnFocus/);
  assert.match(operationLogic, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(operationLogic, /event\.target === reviewModal\) closeReviewModal\(\)/);
});

test('usuarios protege creación, roles y alcances financieros', async () => {
  const [usersView, usersLogic, portalStyles] = await Promise.all([
    readSource('src/pages/portal/users.astro'),
    readSource('src/scripts/portal-users.js'),
    readSource('src/styles/portal.css'),
  ]);

  assert.match(usersView, /id="btn-open-create-user" type="button"[^>]*min-h-11/);
  assert.match(usersView, /id="create-user-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="create-user-title"[^>]*aria-describedby="create-user-description"[^>]*aria-hidden="true"/);
  assert.match(usersView, /label for="create-user-first-name"/);
  assert.match(usersView, /id="create-user-first-name"[^>]*name="firstName"[^>]*autocomplete="given-name"[^>]*min-h-11/);
  assert.match(usersView, /id="create-user-close"[^>]*h-11 w-11[^>]*aria-label="Cerrar creación de usuario"/);
  assert.match(usersView, /id="create-user-feedback"[^>]*role="status" aria-live="polite"/);
  assert.match(usersView, /id="finance-assignment-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="finance-assignment-title"[^>]*aria-describedby="finance-assignment-user"[^>]*aria-hidden="true"/);
  assert.match(usersView, /id="finance-assignment-close"[^>]*h-11 w-11[^>]*aria-label="Cerrar alcances financieros"/);

  assert.match(usersLogic, /data-action="copy-access-link"[^>]*min-h-11/);
  assert.match(usersLogic, /data-action="manage-finance"[^>]*min-h-11/);
  assert.match(usersLogic, /function getDialogFocusableElements\(dialog\)/);
  assert.match(usersLogic, /function showAccessibleDialog\(dialog, preferredFocus = null\)/);
  assert.match(usersLogic, /function handleAccessibleDialogKeydown\(event, dialog, closeButton\)/);
  assert.match(usersLogic, /event\.key === 'Escape'[\s\S]*?closeButton\?\.focus\(\)/);
  assert.match(usersLogic, /if \(createUserDirty && !window\.confirm/);
  assert.match(usersLogic, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(usersLogic, /event\.target === modal\) closeCreateUserModal\(\)/);
  assert.doesNotMatch(usersLogic, /event\.target === financeAssignmentModal\) closeFinanceAssignmentModal\(\)/);
  assert.match(portalStyles, /\.portal-shell \.portal-responsive-table \[data-action\] \{\s*min-height: 44px;/);
});

test('regiones protege jerarquía territorial, edición y tablas móviles', async () => {
  const [regionsView, regionsLogic] = await Promise.all([
    readSource('src/pages/portal/regions.astro'),
    readSource('src/scripts/portal-regions.js'),
  ]);

  assert.match(regionsView, /id="regions-error"[^>]*role="alert" aria-live="assertive"/);
  assert.match(regionsView, /id="regions-feedback"[^>]*role="status" aria-live="polite"/);
  for (const id of ['region-country', 'region-code', 'region-name', 'city-country', 'city-names', 'city-region-select', 'assignment-email', 'assignment-role', 'assignment-region-select']) {
    assert.match(regionsView, new RegExp(`label for="${id}"`));
    assert.match(regionsView, new RegExp(`id="${id}"[^>]*min-h-11`));
  }
  assert.equal([...regionsView.matchAll(/portal-responsive-table/g)].length, 3);
  assert.match(regionsView, /id="region-cancel-edit"[^>]*min-h-11/);

  assert.match(regionsLogic, /data-label="Acciones"/);
  assert.match(regionsLogic, /data-action="rename-region"[^>]*min-h-11/);
  assert.match(regionsLogic, /data-action="revoke-assignment"[^>]*min-h-11/);
  assert.match(regionsLogic, /function beginRegionEdit\(region, trigger\)/);
  assert.match(regionsLogic, /function resetRegionEditor\(/);
  assert.match(regionsLogic, /Promise\.all\(\[loadRegions\(\), loadCities\(\), loadAssignments\(\)\]\)/);
  assert.match(regionsLogic, /window\.confirm\(`¿Asignar a/);
  assert.match(regionsLogic, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(regionsLogic, /window\.prompt/);
});

test('finanzas separa monedas, respuestas tardías y controles operativos', async () => {
  const [financesView, financesLogic] = await Promise.all([
    readSource('src/pages/portal/finances.astro'),
    readSource('src/scripts/portal-finances.js'),
  ]);

  assert.match(financesView, /id="finances-export-cop"[^>]*min-h-11/);
  assert.match(financesView, /id="finances-export-usd"[^>]*min-h-11/);
  assert.match(financesView, /id="finances-load-more"[^>]*min-h-11/);
  assert.match(financesView, /id="finances-issues-load-more"[^>]*min-h-11/);
  assert.match(financesView, /<p id="stat-total-cop"/);
  assert.match(financesView, /<p id="stat-total-usd"/);
  assert.match(financesView, /<h2 id="finances-categories-title"/);
  assert.match(financesView, /<h2 id="finances-transactions-title"/);
  assert.match(financesView, /<h2 id="finances-issues-title"/);

  assert.match(financesLogic, /const fractionDigits = normalizedCurrency === 'USD' \? 2 : 0/);
  assert.match(financesLogic, /minimumFractionDigits: fractionDigits/);
  assert.doesNotMatch(financesLogic, /current\.total \+=/);
  assert.match(financesLogic, /requestRevision !== dataRevision/);
  assert.match(financesLogic, /appendSequence === transactionAppendSequence/);
  assert.match(financesLogic, /appendSequence === issuesAppendSequence/);
  assert.match(financesLogic, /inline-flex min-h-11 items-center/);
  assert.match(financesLogic, /type="button" class="min-h-11[^>]+data-copy-text/);
  assert.match(financesLogic, /rel="noopener noreferrer"/);
  assert.match(financesLogic, /requestAnimationFrame\(\(\) => applyFiltersBtn\.focus\(\)\)/);
  assert.match(financesLogic, /requestAnimationFrame\(\(\) => clearFiltersBtn\.focus\(\)\)/);
});

test('donaciones separa proveedores, protege filtros y concilia Wompi con contexto', async () => {
  const [donationsView, donationsLogic, donationsApi] = await Promise.all([
    readSource('src/pages/portal/donations.astro'),
    readSource('src/scripts/portal-donations.js'),
    readSource('src/pages/api/portal/donations.ts'),
  ]);

  for (const id of ['donations-status', 'donations-domain', 'donations-page-size', 'donations-load-more']) {
    assert.match(donationsView, new RegExp(`id="${id}"[^>]*min-h-11`));
  }
  assert.match(donationsView, /COP aprobado visible/);
  assert.match(donationsView, /USD aprobado visible/);
  assert.match(donationsView, /id="donations-sync-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="donations-sync-title"[^>]*aria-describedby="donations-sync-description"[^>]*aria-hidden="true"/);
  assert.match(donationsView, /id="donations-sync-close"[^>]*h-11 w-11[^>]*aria-label="Cerrar conciliación de Wompi"/);
  assert.match(donationsView, /label for="donations-sync-transaction"/);
  assert.match(donationsView, /No crea un cobro ni mueve dinero/);

  assert.match(donationsLogic, /const fractionDigits = normalizedCurrency === 'USD' \? 2 : 0/);
  assert.match(donationsLogic, /expectedCurrency = provider === 'WOMPI' \? 'COP' : provider === 'STRIPE' \? 'USD'/);
  assert.match(donationsLogic, /data-sync-wompi[^>]+aria-label="Conciliar en Wompi/);
  assert.match(donationsLogic, /requestRevision !== dataRevision \|\| requestAppendSequence !== appendSequence/);
  assert.match(donationsLogic, /function getSyncModalFocusableElements\(\)/);
  assert.match(donationsLogic, /event\.key === 'Escape'/);
  assert.match(donationsLogic, /El formulario se conservó/);
  assert.match(donationsLogic, /window\.addEventListener\('beforeunload'/);
  assert.match(donationsLogic, /manualApprove/);
  assert.doesNotMatch(donationsLogic, /window\.prompt/);

  assert.match(donationsApi, /if \(domain\) \{[\s\S]*?El filtro por concepto todavía no está activo/);
  assert.match(donationsApi, /applyFinanceScopeFilter\(query, financeContext\.access\)/);
});

test('campus respeta asignaciones, alcance financiero y contactos táctiles', async () => {
  const [campusView, campusLogic, campusApi] = await Promise.all([
    readSource('src/pages/portal/campus.astro'),
    readSource('src/scripts/portal-campus.js'),
    readSource('src/pages/api/portal/campus/donors.ts'),
  ]);

  assert.match(campusView, /id="campus-scope-label"/);
  assert.match(campusView, /Donantes visibles/);
  assert.match(campusView, /Aportes aprobados visibles/);
  assert.match(campusView, /id="campus-coverage-note"[^>]*role="status" aria-live="polite"/);
  for (const id of ['donor-missionary-filter', 'donor-search']) {
    assert.match(campusView, new RegExp(`label for="${id}"`));
    assert.match(campusView, new RegExp(`id="${id}"[^>]*min-h-11`));
  }
  assert.equal([...campusView.matchAll(/data-donor-filter=/g)].length, 3);
  assert.equal([...campusView.matchAll(/donor-filter min-h-11/g)].length, 3);
  assert.match(campusView, /id="donors-load-more"[^>]*min-h-11/);

  assert.match(campusLogic, /const fractionDigits = normalizedCurrency === 'USD' \? 2 : 0/);
  assert.match(campusLogic, /expectedCurrency = provider === 'WOMPI' \? 'COP' : provider === 'STRIPE' \? 'USD'/);
  assert.match(campusLogic, /inline-flex min-h-11 items-center/);
  assert.match(campusLogic, /rel="noopener noreferrer"/);
  assert.match(campusLogic, /requestRevision !== loadRevision/);
  assert.match(campusLogic, /data-donor-index="\$\{donorIndex\}" tabindex="-1"/);
  assert.match(campusLogic, /previousVisibleCount/);

  assert.match(campusApi, /getFinanceAccessContext\(request\)/);
  assert.match(campusApi, /loadCampusDonationsBase\(financeContext!\.access\)/);
  assert.match(campusApi, /applyFinanceScopeFilter\(supabaseAdmin/);
  assert.match(campusApi, /serializeFinanceScopeAccess\(financeContext\.access\)/);
  assert.match(campusApi, /uniqueMissionaries\.add\(`slug:\$\{slug\}`\)/);
  assert.match(campusApi, /totalDonationRows/);
  assert.match(campusApi, /La separación financiera todavía no está activa para Campus/);
});

test('peticiones separa intercesión de moderación y protege cada decisión pastoral', async () => {
  const [prayersView, prayersLogic, prayersGuard, prayersListApi, prayersReviewApi] = await Promise.all([
    readSource('src/pages/portal/peticiones.astro'),
    readSource('src/scripts/portal-prayers.js'),
    readSource('src/lib/portalPrayerGuard.ts'),
    readSource('src/pages/api/prayer/admin/list.ts'),
    readSource('src/pages/api/prayer/admin/review.ts'),
  ]);

  for (const id of ['prayers-status', 'prayers-visibility', 'prayers-refresh', 'prayers-load-more']) {
    assert.match(prayersView, new RegExp(`id="${id}"[^>]*min-h-11`));
  }
  assert.match(prayersView, /label for="prayers-status"/);
  assert.match(prayersView, /label for="prayers-visibility"/);
  assert.match(prayersView, /id="prayers-feedback"[^>]*role="status" aria-live="polite"/);
  assert.match(prayersView, /id="prayer-review-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="prayer-review-title"[^>]*aria-describedby="prayer-review-description"[^>]*aria-hidden="true"/);
  assert.match(prayersView, /id="prayer-review-close"[^>]*h-11 w-11[^>]*aria-label="Cerrar revisión de petición"/);
  assert.match(prayersView, /label for="prayer-review-note"/);

  assert.match(prayersLogic, /session\.permissions\?\.can_access_prayers/);
  assert.match(prayersLogic, /requestRevision !== dataRevision \|\| requestAppendSequence !== appendSequence/);
  assert.match(prayersLogic, /function getReviewModalFocusableElements\(\)/);
  assert.match(prayersLogic, /event\.key === 'Escape'/);
  assert.match(prayersLogic, /La nota se conservó/);
  assert.match(prayersLogic, /window\.addEventListener\('beforeunload'/);
  assert.match(prayersLogic, /data-prayer-action="approve"[^>]+min-h-11/);
  assert.doesNotMatch(prayersLogic, /window\.(?:prompt|alert)/);

  assert.match(prayersGuard, /const PRAYER_REVIEW_ROLES = new Set\(\['superadmin', 'admin'\]\)/);
  assert.match(prayersListApi, /select\(fields, \{ count: 'exact' \}\)/);
  assert.doesNotMatch(prayersListApi, /reviewed_by,reviewed_at/);
  assert.match(prayersListApi, /cache-control': 'private, no-store'/);
  assert.match(prayersListApi, /hasNextPage: visibleTo < totalRows/);
  assert.match(prayersReviewApi, /\.in\('moderation_status', \['pending', 'flagged'\]\)/);
  assert.match(prayersReviewApi, /La petición cambió mientras la revisabas/);
  assert.match(prayersReviewApi, /cache-control': 'private, no-store'/);
});
