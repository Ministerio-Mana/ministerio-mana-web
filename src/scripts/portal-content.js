import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const SECTION_KINDS = ['hero', 'rich_text', 'gallery', 'cta', 'video', 'cards', 'custom'];
const SECTION_STATUSES = ['draft', 'published', 'archived'];
const SECTION_KIND_LABELS = {
  hero: 'Portada',
  rich_text: 'Texto',
  gallery: 'Galería',
  cta: 'Llamado a la acción',
  video: 'Video',
  cards: 'Tarjetas',
  custom: 'Avanzado',
};
const STATUS_LABELS = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};
const REQUEST_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 45000;

const state = {
  headers: {},
  pages: [],
  selectedPageId: null,
  page: null,
  sections: [],
  revisions: [],
  logs: [],
  media: [],
  mediaSelection: [],
  mediaProvider: 'supabase',
  mediaMaxBytes: 4 * 1024 * 1024,
  cmsSchemaReady: true,
  permissionValidated: false,
  busyCount: 0,
  alertTimeout: null,
  pageLoadRevision: 0,
  mediaLoadRevision: 0,
  pageDirty: false,
  sectionDraftIds: new Set(),
  modalReturnFocus: new Map(),
  modalDiscardArmed: new Map(),
  confirmAction: null,
  confirmReturnFocus: null,
};

const el = {
  gate: document.getElementById('cms-gate'),
  secureContent: document.getElementById('cms-secure-content'),
  alert: document.getElementById('cms-alert'),
  busy: document.getElementById('cms-busy'),
  setup: document.getElementById('cms-setup'),
  workbench: document.getElementById('cms-workbench'),
  filter: document.getElementById('cms-filter'),
  pages: document.getElementById('cms-pages'),
  pagesEmpty: document.getElementById('cms-pages-empty'),
  newPage: document.getElementById('cms-new-page'),
  pageSave: document.getElementById('cms-page-save'),
  pagePublish: document.getElementById('cms-page-publish'),
  pageUnpublish: document.getElementById('cms-page-unpublish'),
  pagePreview: document.getElementById('cms-page-preview'),
  pageKey: document.getElementById('cms-page-key'),
  pagePath: document.getElementById('cms-page-path'),
  pageTitle: document.getElementById('cms-page-title'),
  pageLocale: document.getElementById('cms-page-locale'),
  pageDescription: document.getElementById('cms-page-description'),
  pageSeoTitle: document.getElementById('cms-page-seo-title'),
  pageSeoDescription: document.getElementById('cms-page-seo-description'),
  pageSeoImage: document.getElementById('cms-page-seo-image'),
  pageMeta: document.getElementById('cms-page-meta'),
  newSection: document.getElementById('cms-section-new'),
  sections: document.getElementById('cms-sections'),
  sectionsEmpty: document.getElementById('cms-sections-empty'),
  history: document.getElementById('cms-history'),
  historyEmpty: document.getElementById('cms-history-empty'),

  mediaRefresh: document.getElementById('cms-media-refresh'),
  mediaUploadForm: document.getElementById('cms-media-upload-form'),
  mediaDropzone: document.getElementById('cms-media-dropzone'),
  mediaFile: document.getElementById('cms-media-file'),
  mediaFileName: document.getElementById('cms-media-file-name'),
  mediaDirectory: document.getElementById('cms-media-directory'),
  mediaDirectoryTrigger: document.getElementById('cms-media-directory-trigger'),
  mediaFolder: document.getElementById('cms-media-folder'),
  mediaUploadProgress: document.getElementById('cms-media-upload-progress'),
  mediaUploadProgressLabel: document.getElementById('cms-media-upload-progress-label'),
  mediaUploadProgressCount: document.getElementById('cms-media-upload-progress-count'),
  mediaUploadProgressBar: document.getElementById('cms-media-upload-progress-bar'),
  mediaStatus: document.getElementById('cms-media-status'),
  mediaList: document.getElementById('cms-media-list'),
  mediaEmpty: document.getElementById('cms-media-empty'),

  pageModal: document.getElementById('cms-page-modal'),
  pageModalForm: document.getElementById('cms-page-modal-form'),
  pageModalClose: document.getElementById('cms-page-modal-close'),
  pageModalCancel: document.getElementById('cms-page-modal-cancel'),
  pageModalFeedback: document.getElementById('cms-page-modal-feedback'),
  modalPageKey: document.getElementById('cms-modal-page-key'),
  modalPageTitle: document.getElementById('cms-modal-page-title'),
  modalPagePath: document.getElementById('cms-modal-page-path'),

  sectionModal: document.getElementById('cms-section-modal'),
  sectionModalForm: document.getElementById('cms-section-modal-form'),
  sectionModalClose: document.getElementById('cms-section-modal-close'),
  sectionModalCancel: document.getElementById('cms-section-modal-cancel'),
  sectionModalFeedback: document.getElementById('cms-section-modal-feedback'),
  modalSectionKey: document.getElementById('cms-modal-section-key'),
  modalSectionKind: document.getElementById('cms-modal-section-kind'),
  modalSectionTitle: document.getElementById('cms-modal-section-title'),

  confirmModal: document.getElementById('cms-confirm-modal'),
  confirmClose: document.getElementById('cms-confirm-close'),
  confirmTitle: document.getElementById('cms-confirm-title'),
  confirmDescription: document.getElementById('cms-confirm-description'),
  confirmSummary: document.getElementById('cms-confirm-summary'),
  confirmFeedback: document.getElementById('cms-confirm-feedback'),
  confirmCancel: document.getElementById('cms-confirm-cancel'),
  confirmSubmit: document.getElementById('cms-confirm-submit'),
};

const PAGE_DRAFT_FIELDS = [
  'pageKey',
  'pagePath',
  'pageTitle',
  'pageLocale',
  'pageDescription',
  'pageSeoTitle',
  'pageSeoDescription',
  'pageSeoImage',
];

function readSessionJson(key, fallback = null) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // La edición actual permanece en el DOM aunque el navegador bloquee sessionStorage.
  }
}

function removeSessionValue(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Sin acción: no se debe bloquear una operación por almacenamiento local indisponible.
  }
}

function pageDraftKey(pageId = state.selectedPageId) {
  return pageId ? `mana.cms.page-draft.${pageId}` : '';
}

function sectionDraftKey(pageId = state.selectedPageId) {
  return pageId ? `mana.cms.section-drafts.${pageId}` : '';
}

function pageModalDraftKey() {
  return 'mana.cms.new-page-draft';
}

function sectionModalDraftKey(pageId = state.selectedPageId) {
  return pageId ? `mana.cms.new-section-draft.${pageId}` : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function parseError(error, fallback) {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function makeTimeoutError(label) {
  const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
  error.name = 'TimeoutError';
  return error;
}

function safeFolder(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function setBusy(flag, message = 'Procesando...') {
  state.busyCount = Math.max(0, state.busyCount + (flag ? 1 : -1));
  const isBusy = state.busyCount > 0;

  if (el.busy) {
    el.busy.classList.toggle('hidden', !isBusy);
    el.busy.textContent = message;
  }

  document.querySelectorAll('[data-cms-action]').forEach((btn) => {
    const disabled = isBusy || state.cmsSchemaReady === false;
    btn.disabled = disabled;
    btn.classList.toggle('opacity-60', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
  });
  if (!isBusy) setPageActionAvailability();
}

function applySchemaState() {
  const ready = state.cmsSchemaReady !== false;
  const disabled = !ready || state.busyCount > 0;
  el.setup?.classList.toggle('hidden', ready);
  el.workbench?.classList.toggle('hidden', !ready);
  document.querySelectorAll('[data-cms-action]').forEach((btn) => {
    btn.disabled = disabled;
    btn.classList.toggle('opacity-60', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
  });
  setPageActionAvailability();
}

function showSecureContent() {
  el.gate?.classList.add('hidden');
  el.secureContent?.classList.remove('hidden');
}

function showGate(message = 'Validando permisos...') {
  if (el.gate) {
    el.gate.textContent = message;
    el.gate.classList.remove('hidden');
  }
  el.secureContent?.classList.add('hidden');
}

function showAlert(message, tone = 'info', ttlMs = 4500, action = null) {
  if (!el.alert) return;

  if (state.alertTimeout) {
    window.clearTimeout(state.alertTimeout);
    state.alertTimeout = null;
  }

  el.alert.classList.remove(
    'hidden',
    'border-red-200', 'bg-red-50', 'text-red-700',
    'border-teal-200', 'bg-teal-50', 'text-teal-700',
    'border-slate-200', 'bg-white', 'text-slate-700',
  );

  if (tone === 'error') {
    el.alert.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
  } else if (tone === 'success') {
    el.alert.classList.add('border-teal-200', 'bg-teal-50', 'text-teal-700');
  } else {
    el.alert.classList.add('border-slate-200', 'bg-white', 'text-slate-700');
  }

  el.alert.replaceChildren();
  const content = document.createElement('div');
  content.className = action ? 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between' : '';
  const text = document.createElement('span');
  text.textContent = message;
  content.appendChild(text);

  if (action?.label && typeof action.onAction === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'min-h-11 shrink-0 rounded-md border border-current bg-white px-4 py-2 text-sm font-black';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await action.onAction();
      } catch (error) {
        showAlert(parseError(error, 'No se pudo deshacer la acción.'), 'error', 7000);
      }
    });
    content.appendChild(button);
  }
  el.alert.appendChild(content);

  if (ttlMs > 0) {
    state.alertTimeout = window.setTimeout(() => {
      clearAlert();
    }, ttlMs);
  }
}

function clearAlert() {
  if (!el.alert) return;
  el.alert.classList.add('hidden');
  el.alert.replaceChildren();
}

function setPageActionAvailability() {
  const hasPage = Boolean(state.selectedPageId) && state.cmsSchemaReady !== false && state.busyCount === 0;
  const status = state.page?.status || 'draft';
  const controls = [
    [el.pageSave, hasPage],
    [el.pagePublish, hasPage && status !== 'published'],
    [el.pageUnpublish, hasPage && status === 'published'],
    [el.pagePreview, hasPage],
    [el.newSection, hasPage],
  ];
  controls.forEach(([node, enabled]) => {
    if (!node) return;
    node.disabled = !enabled;
    node.classList.toggle('opacity-60', !enabled);
    node.classList.toggle('cursor-not-allowed', !enabled);
  });
}

function editorModalParts(node) {
  if (node === el.pageModal) {
    return {
      form: el.pageModalForm,
      feedback: el.pageModalFeedback,
      cancel: el.pageModalCancel,
      close: el.pageModalClose,
      preferredFocus: el.modalPageKey,
      draftKey: pageModalDraftKey(),
      reset: resetPageModal,
    };
  }
  if (node === el.sectionModal) {
    return {
      form: el.sectionModalForm,
      feedback: el.sectionModalFeedback,
      cancel: el.sectionModalCancel,
      close: el.sectionModalClose,
      preferredFocus: el.modalSectionKey,
      draftKey: sectionModalDraftKey(),
      reset: resetSectionModal,
    };
  }
  return null;
}

function setModalFeedback(node, message = '') {
  const parts = editorModalParts(node);
  if (!parts?.feedback) return;
  parts.feedback.textContent = message;
  parts.feedback.className = message
    ? 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-800'
    : 'hidden rounded-xl border px-4 py-4 text-sm font-semibold';
}

function modalDraftValues(node) {
  const parts = editorModalParts(node);
  if (!parts?.form) return {};
  return Object.fromEntries(Array.from(parts.form.querySelectorAll('input, select, textarea')).map((field) => [field.id, String(field.value || '')]));
}

function persistModalDraft(node) {
  const parts = editorModalParts(node);
  if (!parts?.draftKey) return;
  writeSessionJson(parts.draftKey, { savedAt: Date.now(), values: modalDraftValues(node) });
  state.modalDiscardArmed.set(node, false);
  if (parts.cancel) parts.cancel.textContent = 'Cancelar';
  setModalFeedback(node, '');
}

function restoreModalDraft(node) {
  const parts = editorModalParts(node);
  if (!parts?.draftKey || !parts.form) return;
  const draft = readSessionJson(parts.draftKey);
  if (!draft?.values) return;
  parts.form.querySelectorAll('input, select, textarea').forEach((field) => {
    if (draft.values[field.id] !== undefined) field.value = String(draft.values[field.id]);
  });
}

function modalHasDraft(node) {
  if (node === el.pageModal) {
    return Boolean(el.modalPageKey?.value.trim() || el.modalPageTitle?.value.trim() || (el.modalPagePath?.value.trim() && el.modalPagePath.value.trim() !== '/'));
  }
  if (node === el.sectionModal) {
    return Boolean(el.modalSectionKey?.value.trim() || el.modalSectionTitle?.value.trim() || (el.modalSectionKind?.value && el.modalSectionKind.value !== 'rich_text'));
  }
  return false;
}

function getDialogFocusableElements(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.closest('.hidden'));
}

function openEditorModal(node, trigger) {
  const parts = editorModalParts(node);
  if (!node || !parts) return;
  restoreModalDraft(node);
  state.modalReturnFocus.set(node, trigger instanceof HTMLElement ? trigger : document.activeElement);
  state.modalDiscardArmed.set(node, false);
  if (parts.cancel) parts.cancel.textContent = 'Cancelar';
  setModalFeedback(node, '');
  node.classList.remove('hidden');
  node.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');
  window.requestAnimationFrame(() => parts.preferredFocus?.focus());
}

function closeEditorModal(node, { clearDraft = false } = {}) {
  const parts = editorModalParts(node);
  if (!node || !parts || node.classList.contains('hidden')) return;
  node.classList.add('hidden');
  node.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');
  setModalFeedback(node, '');
  state.modalDiscardArmed.set(node, false);
  if (parts.cancel) parts.cancel.textContent = 'Cancelar';
  if (clearDraft) {
    parts.reset?.();
    if (parts.draftKey) removeSessionValue(parts.draftKey);
  }
  const returnFocus = state.modalReturnFocus.get(node);
  if (returnFocus?.isConnected) returnFocus.focus();
}

function requestCloseEditorModal(node, { allowDiscard = false } = {}) {
  const parts = editorModalParts(node);
  if (!parts) return;
  if (!modalHasDraft(node)) {
    closeEditorModal(node, { clearDraft: true });
    return;
  }
  if (allowDiscard && state.modalDiscardArmed.get(node)) {
    closeEditorModal(node, { clearDraft: true });
    return;
  }
  state.modalDiscardArmed.set(node, true);
  if (parts.cancel) parts.cancel.textContent = 'Borrar borrador y cerrar';
  setModalFeedback(node, 'El borrador se conservó. Para descartarlo, usa “Borrar borrador y cerrar”.');
  parts.preferredFocus?.focus();
}

function setConfirmFeedback(message = '', tone = 'error') {
  if (!el.confirmFeedback) return;
  el.confirmFeedback.textContent = message;
  el.confirmFeedback.className = message
    ? `mt-4 rounded-xl border px-4 py-4 text-sm font-semibold ${tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-800'}`
    : 'mt-4 hidden rounded-xl border px-4 py-4 text-sm font-semibold';
}

function openConfirmDialog({ title, description, summary, confirmLabel, tone = 'primary', onConfirm, trigger }) {
  if (!el.confirmModal || !el.confirmSubmit) return;
  state.confirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  state.confirmReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
  if (el.confirmTitle) el.confirmTitle.textContent = title;
  if (el.confirmDescription) el.confirmDescription.textContent = description;
  if (el.confirmSummary) el.confirmSummary.textContent = summary;
  el.confirmSubmit.textContent = confirmLabel;
  el.confirmSubmit.className = `min-h-11 rounded-md px-4 py-2 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60 ${tone === 'danger'
    ? 'bg-red-700 hover:bg-red-800'
    : 'bg-[#293C74] hover:bg-[#1f2f63]'}`;
  setConfirmFeedback('');
  el.confirmModal.classList.remove('hidden');
  el.confirmModal.classList.add('flex');
  el.confirmModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');
  window.requestAnimationFrame(() => el.confirmSubmit?.focus());
}

function closeConfirmDialog() {
  if (!el.confirmModal || el.confirmModal.classList.contains('hidden')) return;
  el.confirmModal.classList.add('hidden');
  el.confirmModal.classList.remove('flex');
  el.confirmModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');
  setConfirmFeedback('');
  state.confirmAction = null;
  const returnFocus = state.confirmReturnFocus;
  state.confirmReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
  else el.mediaRefresh?.focus();
}

async function runConfirmAction() {
  if (!state.confirmAction || !el.confirmSubmit) return;
  el.confirmSubmit.disabled = true;
  const originalLabel = el.confirmSubmit.textContent;
  el.confirmSubmit.textContent = 'Procesando...';
  try {
    await state.confirmAction();
    closeConfirmDialog();
  } catch (error) {
    setConfirmFeedback(parseError(error, 'No se pudo completar la acción.'));
  } finally {
    el.confirmSubmit.disabled = false;
    el.confirmSubmit.textContent = originalLabel;
  }
}

function handleDialogKeydown(event) {
  const openDialog = !el.confirmModal?.classList.contains('hidden')
    ? el.confirmModal
    : !el.pageModal?.classList.contains('hidden')
      ? el.pageModal
      : !el.sectionModal?.classList.contains('hidden')
        ? el.sectionModal
        : null;
  if (!openDialog) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    if (openDialog === el.confirmModal) closeConfirmDialog();
    else requestCloseEditorModal(openDialog);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = getDialogFocusableElements(openDialog);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function fetchJson(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const timeoutMs = Number(options.timeoutMs || (isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS));
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    ...state.headers,
    ...(options.headers || {}),
  };
  if (!isForm && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    const res = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `Error ${res.status}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw makeTimeoutError(isForm ? 'La subida del archivo' : 'La solicitud');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function pageFormSnapshot() {
  return Object.fromEntries(PAGE_DRAFT_FIELDS.map((field) => [field, String(el[field]?.value || '')]));
}

function updatePageMeta() {
  if (!el.pageMeta || !state.page) return;
  const updatedLabel = state.page.updated_at
    ? new Date(state.page.updated_at).toLocaleString('es-CO')
    : 'sin fecha';
  const draftLabel = state.pageDirty ? ' · Borrador local sin guardar en servidor' : '';
  el.pageMeta.textContent = `Estado: ${STATUS_LABELS[state.page.status] || state.page.status || 'Borrador'} · Versión ${state.page.version || 1} · Actualizado ${updatedLabel}${draftLabel}`;
}

function setPageDirty(dirty) {
  state.pageDirty = Boolean(dirty);
  updatePageMeta();
}

function persistPageDraft() {
  const key = pageDraftKey();
  if (!key || !state.page) return;
  writeSessionJson(key, {
    savedAt: Date.now(),
    serverUpdatedAt: state.page.updated_at || null,
    values: pageFormSnapshot(),
  });
  setPageDirty(true);
}

function clearPageDraft(pageId = state.selectedPageId) {
  const key = pageDraftKey(pageId);
  if (key) removeSessionValue(key);
  if (pageId === state.selectedPageId) setPageDirty(false);
}

function restorePageDraft() {
  const key = pageDraftKey();
  if (!key || !state.page) return false;
  const draft = readSessionJson(key);
  if (!draft?.values || Number(draft.savedAt || 0) <= new Date(state.page.updated_at || 0).getTime()) {
    if (draft) removeSessionValue(key);
    return false;
  }
  PAGE_DRAFT_FIELDS.forEach((field) => {
    if (el[field] && draft.values[field] !== undefined) el[field].value = String(draft.values[field]);
  });
  setPageDirty(true);
  return true;
}

function sectionDraftValues(card) {
  const values = {};
  card.querySelectorAll('[data-field], [data-payload-field]').forEach((field) => {
    const key = field.hasAttribute('data-field')
      ? `field:${field.getAttribute('data-field')}`
      : `payload:${field.getAttribute('data-payload-field')}`;
    values[key] = String(field.value ?? '');
  });
  return values;
}

function persistSectionDraft(card) {
  const sectionId = card?.getAttribute('data-section-id');
  const key = sectionDraftKey();
  if (!sectionId || !key) return;
  const section = state.sections.find((item) => item.id === sectionId);
  const stored = readSessionJson(key, { drafts: {} }) || { drafts: {} };
  stored.drafts ||= {};
  stored.drafts[sectionId] = {
    savedAt: Date.now(),
    serverUpdatedAt: section?.updated_at || null,
    values: sectionDraftValues(card),
  };
  writeSessionJson(key, stored);
  state.sectionDraftIds.add(sectionId);
  card.querySelector('[data-section-draft-status]')?.classList.remove('hidden');
}

function clearSectionDraft(sectionId, pageId = state.selectedPageId) {
  const key = sectionDraftKey(pageId);
  if (!key || !sectionId) return;
  const stored = readSessionJson(key, { drafts: {} }) || { drafts: {} };
  if (stored.drafts) delete stored.drafts[sectionId];
  if (Object.keys(stored.drafts || {}).length) writeSessionJson(key, stored);
  else removeSessionValue(key);
  if (pageId === state.selectedPageId) state.sectionDraftIds.delete(sectionId);
}

function restoreSectionDrafts() {
  state.sectionDraftIds.clear();
  const key = sectionDraftKey();
  const stored = key ? readSessionJson(key, { drafts: {} }) : { drafts: {} };
  stored.drafts ||= {};
  let restored = 0;

  el.sections?.querySelectorAll('[data-section-id]').forEach((card) => {
    const sectionId = card.getAttribute('data-section-id');
    const section = state.sections.find((item) => item.id === sectionId);
    const draft = stored?.drafts?.[sectionId];
    if (!sectionId || !draft?.values || Number(draft.savedAt || 0) <= new Date(section?.updated_at || 0).getTime()) {
      if (sectionId && draft) delete stored.drafts[sectionId];
      return;
    }
    card.querySelectorAll('[data-field], [data-payload-field]').forEach((field) => {
      const fieldKey = field.hasAttribute('data-field')
        ? `field:${field.getAttribute('data-field')}`
        : `payload:${field.getAttribute('data-payload-field')}`;
      if (draft.values[fieldKey] !== undefined) field.value = String(draft.values[fieldKey]);
    });
    state.sectionDraftIds.add(sectionId);
    card.querySelector('[data-section-draft-status]')?.classList.remove('hidden');
    restored += 1;
  });

  if (key) {
    if (Object.keys(stored?.drafts || {}).length) writeSessionJson(key, stored);
    else removeSessionValue(key);
  }
  return restored;
}

function hasUnsavedEditorDrafts() {
  return state.pageDirty || state.sectionDraftIds.size > 0;
}

function applyPageToForm(page) {
  if (!page) return;
  const seo = (page.seo && typeof page.seo === 'object') ? page.seo : {};
  el.pageKey.value = page.page_key || '';
  el.pagePath.value = page.route_path || '/';
  el.pageTitle.value = page.title || '';
  el.pageLocale.value = page.locale || 'es';
  el.pageDescription.value = page.description || '';
  el.pageSeoTitle.value = seo.title || '';
  el.pageSeoDescription.value = seo.description || '';
  el.pageSeoImage.value = seo.image || '';
  setPageDirty(false);

  if (el.mediaFolder && !el.mediaFolder.value) {
    el.mediaFolder.value = page.page_key || '';
  }
}

function filteredPages() {
  const q = String(el.filter?.value || '').trim().toLowerCase();
  if (!q) return state.pages;
  return state.pages.filter((page) => {
    const haystack = `${page.page_key || ''} ${page.title || ''} ${page.route_path || ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

function renderPages() {
  if (!el.pages || !el.pagesEmpty) return;
  const pages = filteredPages();
  el.pages.innerHTML = pages
    .map((page) => {
      const active = page.id === state.selectedPageId;
      const statusTone = page.status === 'published'
        ? 'text-teal-700 bg-teal-50 border-teal-100'
        : page.status === 'archived'
          ? 'text-slate-600 bg-slate-100 border-slate-200'
          : 'text-amber-700 bg-amber-50 border-amber-100';

      return `
        <button type="button" data-page-id="${escapeAttr(page.id)}" class="cms-page-item min-h-11 w-full rounded-xl border px-4 py-4 text-left transition ${active ? 'border-[#293C74]/40 bg-[#293C74]/5 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-bold text-[#293C74]">${escapeHtml(page.title || page.page_key)}</p>
            <span class="portal-chip border ${statusTone}">${escapeHtml(STATUS_LABELS[page.status] || page.status || 'Borrador')}</span>
          </div>
          <p class="mt-2 text-xs text-slate-500">${escapeHtml(page.route_path || '/')}</p>
        </button>
      `;
    })
    .join('');

  el.pagesEmpty.classList.toggle('hidden', pages.length > 0);

  el.pages.querySelectorAll('.cms-page-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-page-id');
      if (!pageId || pageId === state.selectedPageId) return;
      if (hasUnsavedEditorDrafts()) {
        showAlert('Tus cambios quedaron como borrador local en esta pestaña y se recuperarán al volver.', 'info', 7000);
      }
      loadPage(pageId).catch((error) => {
        showAlert(parseError(error, 'No se pudo cargar la página.'), 'error', 5500);
      });
    });
  });
}

function renderKindOptions(value) {
  return SECTION_KINDS
    .map((kind) => `<option value="${escapeAttr(kind)}"${kind === value ? ' selected' : ''}>${escapeHtml(SECTION_KIND_LABELS[kind] || kind)}</option>`)
    .join('');
}

function renderStatusOptions(value) {
  return SECTION_STATUSES
    .map((status) => `<option value="${escapeAttr(status)}"${status === value ? ' selected' : ''}>${escapeHtml(STATUS_LABELS[status] || status)}</option>`)
    .join('');
}

async function swapSectionsOrder(sectionId, direction) {
  const currentIndex = state.sections.findIndex((item) => item.id === sectionId);
  if (currentIndex < 0) return;

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= state.sections.length) return;

  const current = state.sections[currentIndex];
  const target = state.sections[targetIndex];

  setBusy(true, 'Reordenando secciones...');
  try {
    const firstUpdate = await fetchJson('/api/portal/content/sections', {
      method: 'PUT',
      body: JSON.stringify({
        section_id: current.id,
        position: target.position,
        expected_updated_at: current.updated_at || null,
      }),
    });
    try {
      await fetchJson('/api/portal/content/sections', {
        method: 'PUT',
        body: JSON.stringify({
          section_id: target.id,
          position: current.position,
          expected_updated_at: target.updated_at || null,
        }),
      });
    } catch (error) {
      await fetchJson('/api/portal/content/sections', {
        method: 'PUT',
        body: JSON.stringify({
          section_id: current.id,
          position: current.position,
          expected_updated_at: firstUpdate.section?.updated_at || null,
        }),
      }).catch(() => {
        throw new Error('El orden quedó incompleto y requiere recargar antes de volver a intentarlo.');
      });
      throw error;
    }

    await loadPage(state.selectedPageId, true);
    showAlert('Orden actualizado.', 'success');
  } finally {
    setBusy(false);
  }
}

function renderPayloadField(label, key, value, options = {}) {
  const inputClass = 'mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm';
  if (options.multiline) {
    return `<label class="text-xs font-bold text-slate-600 ${options.wide ? 'md:col-span-2' : ''}">${escapeHtml(label)}
      <textarea data-payload-field="${escapeAttr(key)}" rows="${options.rows || 3}" class="${inputClass}">${escapeHtml(value || '')}</textarea>
    </label>`;
  }
  return `<label class="text-xs font-bold text-slate-600 ${options.wide ? 'md:col-span-2' : ''}">${escapeHtml(label)}
    <input data-payload-field="${escapeAttr(key)}" type="${options.type || 'text'}" class="${inputClass}" value="${escapeAttr(value || '')}" />
  </label>`;
}

function renderPayloadEditor(section) {
  const payload = section.payload || {};
  let fields = '';

  if (section.kind === 'hero') {
    fields = [
      renderPayloadField('Texto superior', 'eyebrow', payload.eyebrow),
      renderPayloadField('Título principal', 'title', payload.title),
      renderPayloadField('Descripción', 'subtitle', payload.subtitle, { multiline: true, wide: true }),
      renderPayloadField('Imagen', 'image', payload.image, { type: 'url', wide: true }),
      renderPayloadField('Texto del botón', 'ctaLabel', payload.ctaLabel),
      renderPayloadField('Enlace del botón', 'ctaHref', payload.ctaHref, { type: 'url' }),
    ].join('');
  } else if (section.kind === 'rich_text') {
    fields = [
      renderPayloadField('Título', 'title', payload.title, { wide: true }),
      renderPayloadField('Texto', 'text', payload.text, { multiline: true, rows: 6, wide: true }),
    ].join('');
  } else if (section.kind === 'video') {
    fields = [
      renderPayloadField('Título', 'title', payload.title, { wide: true }),
      renderPayloadField('Enlace de YouTube o Vimeo', 'url', payload.url || payload.videoUrl, { type: 'url', wide: true }),
    ].join('');
  } else if (section.kind === 'cta') {
    fields = [
      renderPayloadField('Título', 'title', payload.title, { wide: true }),
      renderPayloadField('Texto', 'text', payload.text, { multiline: true, wide: true }),
      renderPayloadField('Botón principal', 'primaryLabel', payload.primaryLabel),
      renderPayloadField('Enlace principal', 'primaryHref', payload.primaryHref, { type: 'url' }),
      renderPayloadField('Botón secundario', 'secondaryLabel', payload.secondaryLabel),
      renderPayloadField('Enlace secundario', 'secondaryHref', payload.secondaryHref, { type: 'url' }),
    ].join('');
  }

  const payloadText = JSON.stringify(payload, null, 2);
  const visualFields = fields ? `<div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">${fields}</div>` : '';
  return `${visualFields}
    <details class="mt-4 rounded-lg border border-slate-200 bg-white">
      <summary class="min-h-11 cursor-pointer px-4 py-2 text-xs font-bold text-slate-600">Opciones avanzadas</summary>
      <div class="border-t border-slate-200 p-4">
        <textarea data-field="payload" rows="7" class="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 font-mono text-xs">${escapeHtml(payloadText)}</textarea>
      </div>
    </details>`;
}

async function updateSectionStatus(sectionId, status) {
  const current = state.sections.find((item) => item.id === sectionId);
  if (!current) throw new Error('La sección ya no está disponible.');
  await fetchJson('/api/portal/content/sections', {
    method: 'PUT',
    body: JSON.stringify({
      section_id: sectionId,
      status,
      expected_updated_at: current.updated_at || null,
    }),
  });
  clearSectionDraft(sectionId);
  await loadPage(state.selectedPageId, true);
}

function renderSections() {
  if (!el.sections || !el.sectionsEmpty) return;

  if (!state.selectedPageId) {
    el.sections.innerHTML = '';
    el.sectionsEmpty.classList.remove('hidden');
    return 0;
  }

  el.sections.innerHTML = state.sections
    .map((section, index) => {
      return `
      <article class="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 md:p-6" data-section-id="${escapeAttr(section.id)}">
        <div class="mb-4 flex items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Bloque ${index + 1}</p>
            <span data-section-draft-status class="hidden rounded-full bg-amber-100 px-2 py-2 text-xs font-bold text-amber-800">Borrador local</span>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="cms-section-up h-11 w-11 rounded-lg border border-slate-300 text-slate-600" data-cms-action aria-label="Subir bloque ${index + 1}" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="cms-section-down h-11 w-11 rounded-lg border border-slate-300 text-slate-600" data-cms-action aria-label="Bajar bloque ${index + 1}" ${index === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label class="text-xs font-bold text-slate-600">Nombre interno
            <input data-field="section_key" class="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" value="${escapeAttr(section.section_key || '')}" />
          </label>
          <label class="text-xs font-bold text-slate-600">Tipo
            <select data-field="kind" class="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">${renderKindOptions(section.kind || 'rich_text')}</select>
          </label>
          <label class="text-xs font-bold text-slate-600">Posición
            <input data-field="position" type="number" class="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" value="${escapeAttr(Number(section.position || 0))}" />
          </label>
          <label class="text-xs font-bold text-slate-600">Estado
            <select data-field="status" class="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">${renderStatusOptions(section.status || 'draft')}</select>
          </label>
        </div>
        <label class="mt-4 block text-xs font-bold text-slate-600">Título
          <input data-field="title" class="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" value="${escapeAttr(section.title || '')}" />
        </label>
        ${renderPayloadEditor(section)}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" class="cms-section-save min-h-11 rounded-lg bg-brand-teal px-4 py-2 text-xs font-bold text-white" data-cms-action>Guardar sección</button>
          <button type="button" class="cms-section-archive min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700" data-cms-action>${section.status === 'archived' ? 'Restaurar' : 'Archivar'}</button>
        </div>
      </article>
      `;
    })
    .join('');

  el.sectionsEmpty.classList.toggle('hidden', state.sections.length > 0);

  el.sections.querySelectorAll('[data-section-id]').forEach((card) => {
    const sectionId = card.getAttribute('data-section-id');
    const saveBtn = card.querySelector('.cms-section-save');
    const archiveBtn = card.querySelector('.cms-section-archive');
    const upBtn = card.querySelector('.cms-section-up');
    const downBtn = card.querySelector('.cms-section-down');

    upBtn?.addEventListener('click', () => {
      if (!sectionId) return;
      swapSectionsOrder(sectionId, 'up').catch((error) => {
        showAlert(parseError(error, 'No se pudo reordenar.'), 'error', 6000);
      });
    });

    downBtn?.addEventListener('click', () => {
      if (!sectionId) return;
      swapSectionsOrder(sectionId, 'down').catch((error) => {
        showAlert(parseError(error, 'No se pudo reordenar.'), 'error', 6000);
      });
    });

    saveBtn?.addEventListener('click', async () => {
      if (!sectionId) return;
      const payloadRaw = card.querySelector('[data-field="payload"]')?.value || '{}';
      let payload;
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        showAlert('El contenido avanzado tiene un formato inválido.', 'error', 6000);
        return;
      }

      card.querySelectorAll('[data-payload-field]').forEach((field) => {
        const key = field.getAttribute('data-payload-field');
        if (!key) return;
        const value = String(field.value || '').trim();
        if (value) payload[key] = value;
        else delete payload[key];
      });

      const body = {
        section_id: sectionId,
        section_key: card.querySelector('[data-field="section_key"]')?.value,
        kind: card.querySelector('[data-field="kind"]')?.value,
        position: Number(card.querySelector('[data-field="position"]')?.value || 0),
        status: card.querySelector('[data-field="status"]')?.value,
        title: card.querySelector('[data-field="title"]')?.value,
        payload,
        expected_updated_at: state.sections.find((item) => item.id === sectionId)?.updated_at || null,
      };

      setBusy(true, 'Guardando sección...');
      try {
        await fetchJson('/api/portal/content/sections', {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        clearSectionDraft(sectionId);
        await loadPage(state.selectedPageId, true);
        showAlert('Sección actualizada.', 'success');
      } catch (error) {
        showAlert(parseError(error, 'No se pudo actualizar sección.'), 'error', 6000);
      } finally {
        setBusy(false);
      }
    });

    archiveBtn?.addEventListener('click', async () => {
      if (!sectionId) return;
      const section = state.sections.find((item) => item.id === sectionId);
      if (!section) return;
      const restoring = section.status === 'archived';
      const nextStatus = restoring ? 'draft' : 'archived';
      const previousStatus = section.status || 'draft';
      setBusy(true, restoring ? 'Restaurando sección...' : 'Archivando sección...');
      try {
        await updateSectionStatus(sectionId, nextStatus);
        if (restoring) {
          showAlert('Sección restaurada como borrador.', 'success');
        } else {
          showAlert('Sección archivada. No se eliminó y puede restaurarse.', 'success', 12000, {
            label: 'Deshacer',
            onAction: async () => {
              setBusy(true, 'Restaurando sección...');
              try {
                await updateSectionStatus(sectionId, previousStatus);
                showAlert('Archivo deshecho; la sección volvió a su estado anterior.', 'success');
              } finally {
                setBusy(false);
              }
            },
          });
        }
      } catch (error) {
        showAlert(parseError(error, 'No se pudo cambiar el estado de la sección.'), 'error', 6000);
      } finally {
        setBusy(false);
      }
    });
  });

  const restoredDrafts = restoreSectionDrafts();
  setPageActionAvailability();
  return restoredDrafts;
}

function renderHistory() {
  if (!el.history || !el.historyEmpty) return;

  const items = [
    ...state.revisions.map((item) => ({
      created_at: item.created_at,
      label: `REV ${item.entity_type}.${item.action}`,
      detail: item.entity_id,
    })),
    ...state.logs.map((item) => ({
      created_at: item.created_at,
      label: `LOG ${item.action}`,
      detail: item.actor_email || item.actor_user_id || '-',
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20);

  el.history.innerHTML = items
    .map((item) => `
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
        <p class="text-xs font-bold text-slate-700">${escapeHtml(item.label)}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(item.detail)} · ${escapeHtml(new Date(item.created_at).toLocaleString('es-CO'))}</p>
      </div>
    `)
    .join('');

  el.historyEmpty.classList.toggle('hidden', items.length > 0);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSelectedMediaFile() {
  const files = state.mediaSelection;
  if (!el.mediaFileName || !el.mediaDropzone) return;
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  el.mediaFileName.textContent = files.length === 1
    ? `${files[0].name} · ${formatBytes(files[0].size)}`
    : files.length > 1
      ? `${files.length} imágenes · ${formatBytes(totalBytes)}`
      : '';
  el.mediaFileName.classList.toggle('hidden', files.length === 0);
  el.mediaDropzone.classList.toggle('border-[#293C74]', files.length > 0);
  el.mediaDropzone.classList.toggle('bg-[#293C74]/5', files.length > 0);
}

function setDroppedMediaFiles(files) {
  if (!files?.length) return;
  state.mediaSelection = Array.from(files).filter(isSelectableMediaFile).slice(0, 1500);
  renderSelectedMediaFile();
}

function isSelectableMediaFile(file) {
  const name = String(file?.name || '');
  const relativePath = String(file?.webkitRelativePath || '').replace(/\\/g, '/');
  return ['image/jpeg', 'image/png', 'image/webp'].includes(String(file?.type || ''))
    && !name.startsWith('.')
    && !relativePath.split('/').some((part) => part.startsWith('.'));
}

function folderForSelectedMedia(file, baseFolder) {
  const relativePath = String(file.webkitRelativePath || '').replace(/\\/g, '/');
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 3) return baseFolder;
  const albumFolder = safeFolder(parts[parts.length - 2]);
  return albumFolder ? `${baseFolder}/${albumFolder}` : baseFolder;
}

function updateMediaUploadProgress(completed, total, failed = 0) {
  if (!el.mediaUploadProgress) return;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  el.mediaUploadProgress.classList.toggle('hidden', total <= 1 && completed === 0);
  if (el.mediaUploadProgressLabel) {
    el.mediaUploadProgressLabel.textContent = failed
      ? `${completed} de ${total} procesadas · ${failed} con error`
      : `${completed} de ${total} procesadas`;
  }
  if (el.mediaUploadProgressCount) el.mediaUploadProgressCount.textContent = `${percent}%`;
  if (el.mediaUploadProgressBar) el.mediaUploadProgressBar.style.width = `${percent}%`;
}

function renderMedia() {
  if (!el.mediaList || !el.mediaEmpty) return;

  el.mediaList.innerHTML = state.media
    .map((file) => {
      const isImage = String(file.mime_type || '').startsWith('image/');
      const previewUrl = file.thumbnail_url || file.public_url;
      const providerLabel = file.provider === 'imagekit' ? 'ImageKit' : 'Supabase';
      const dimensions = file.width && file.height ? ` · ${file.width} × ${file.height}px` : '';
      return `
      <article class="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
        ${isImage ? `<img src="${escapeAttr(previewUrl)}" alt="${escapeAttr(file.name)}" loading="lazy" decoding="async" class="h-28 w-full object-cover rounded-lg border border-slate-200 bg-white" />` : ''}
        <p class="text-xs font-bold text-[#293C74] break-all">${escapeHtml(file.name || '')}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(providerLabel)} · ${escapeHtml(formatBytes(file.size))}${escapeHtml(dimensions)} · ${escapeHtml(file.mime_type || 'archivo')}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="cms-media-copy min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700" data-url="${escapeAttr(file.public_url)}" data-cms-action>Copiar URL</button>
          <button type="button" class="cms-media-delete min-h-11 rounded-lg border border-red-300 px-4 py-2 text-xs font-bold text-red-700" data-media-id="${escapeAttr(file.media_id || '')}" data-media-name="${escapeAttr(file.name || 'Archivo sin nombre')}" data-media-provider="${escapeAttr(providerLabel)}" data-path="${escapeAttr(file.path)}" data-cms-action>Eliminar</button>
        </div>
      </article>
      `;
    })
    .join('');

  el.mediaEmpty.classList.toggle('hidden', state.media.length > 0);

  el.mediaList.querySelectorAll('.cms-media-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-url') || '';
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const temp = document.createElement('input');
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      showAlert('URL copiada al portapapeles.', 'success');
    });
  });

  el.mediaList.querySelectorAll('.cms-media-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mediaId = btn.getAttribute('data-media-id') || '';
      const path = btn.getAttribute('data-path') || '';
      const name = btn.getAttribute('data-media-name') || 'Archivo sin nombre';
      const provider = btn.getAttribute('data-media-provider') || 'Biblioteca';
      if (!mediaId && !path) return;
      openConfirmDialog({
        title: 'Eliminar archivo de la biblioteca',
        description: 'Esta acción elimina el archivo del proveedor multimedia. Verifica primero que ninguna página publicada use esta URL.',
        summary: `${name} · ${provider}`,
        confirmLabel: 'Eliminar archivo',
        tone: 'danger',
        trigger: btn,
        onConfirm: async () => {
          setBusy(true, 'Eliminando archivo...');
          try {
            await fetchJson('/api/portal/content/media', {
              method: 'DELETE',
              body: JSON.stringify({ media_id: mediaId, path }),
            });
            await loadMedia(true);
            showAlert('Archivo eliminado.', 'success');
          } finally {
            setBusy(false);
          }
        },
      });
    });
  });
}

async function loadMedia(silent = false) {
  if (!el.mediaStatus) return;
  const requestRevision = ++state.mediaLoadRevision;

  const prefix = safeFolder(el.mediaFolder?.value || state.page?.page_key || '');
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}&limit=80` : '?limit=80';
  const data = await fetchJson(`/api/portal/content/media${query}`);
  if (requestRevision !== state.mediaLoadRevision) return;
  state.media = data.files || [];
  state.mediaProvider = data.provider === 'imagekit' ? 'imagekit' : 'supabase';
  state.mediaMaxBytes = Number(data.max_bytes || (state.mediaProvider === 'imagekit' ? 5 * 1024 * 1024 : 4 * 1024 * 1024));

  const providerLabel = state.mediaProvider === 'imagekit' ? 'ImageKit' : 'Supabase';
  el.mediaStatus.textContent = `${providerLabel} · Carpeta: ${prefix || 'general'} · ${state.media.length} archivo${state.media.length === 1 ? '' : 's'}`;
  renderMedia();

  if (!silent) {
    showAlert('Biblioteca multimedia actualizada.', 'success');
  }
}

async function loadPages(selectFirst = false) {
  const data = await fetchJson('/api/portal/content/pages');
  state.cmsSchemaReady = data.schemaReady !== false;
  applySchemaState();
  state.pages = Array.isArray(data.pages) ? data.pages : [];

  if (state.selectedPageId && !state.pages.some((p) => p.id === state.selectedPageId)) {
    state.selectedPageId = null;
  }

  if (!state.selectedPageId && selectFirst && state.pages.length) {
    state.selectedPageId = state.pages[0].id;
  }

  renderPages();

  if (state.selectedPageId) {
    await loadPage(state.selectedPageId, true);
  } else {
    state.page = null;
    state.sections = [];
    state.revisions = [];
    state.logs = [];
    renderSections();
    renderHistory();
    setPageActionAvailability();
    state.media = [];
    renderMedia();
  }
}

async function loadPage(pageId, silent = false) {
  if (!pageId) return;
  const requestRevision = ++state.pageLoadRevision;
  state.selectedPageId = pageId;

  const [data, history] = await Promise.all([
    fetchJson(`/api/portal/content/pages?page_id=${encodeURIComponent(pageId)}`),
    fetchJson(`/api/portal/content/history?page_id=${encodeURIComponent(pageId)}&limit=40`),
  ]);
  if (requestRevision !== state.pageLoadRevision || pageId !== state.selectedPageId) return;

  state.page = data.page || null;
  state.sections = data.sections || [];
  state.revisions = history.revisions || [];
  state.logs = history.logs || [];

  applyPageToForm(state.page);
  const restoredPageDraft = restorePageDraft();
  renderPages();
  const restoredSectionDrafts = renderSections();
  renderHistory();
  setPageActionAvailability();
  await loadMedia(true);
  if (requestRevision !== state.pageLoadRevision || pageId !== state.selectedPageId) return;

  if (restoredPageDraft || restoredSectionDrafts) {
    showAlert('Se recuperó un borrador local de esta pestaña. Revísalo y guárdalo cuando esté listo.', 'info', 0);
  } else if (!silent) {
    showAlert(`Página cargada: ${state.page?.title || state.page?.page_key || pageId}`);
  }
}

function resetPageModal() {
  if (!el.modalPageKey || !el.modalPageTitle || !el.modalPagePath) return;
  el.modalPageKey.value = '';
  el.modalPageTitle.value = '';
  el.modalPagePath.value = '/';
}

function resetSectionModal() {
  if (!el.modalSectionKey || !el.modalSectionKind || !el.modalSectionTitle) return;
  el.modalSectionKey.value = '';
  el.modalSectionKind.value = 'rich_text';
  el.modalSectionTitle.value = '';
}

async function savePage() {
  if (!state.selectedPageId) {
    showAlert('Selecciona una página primero.', 'error', 5000);
    return;
  }

  const seo = {
    title: String(el.pageSeoTitle?.value || '').trim(),
    description: String(el.pageSeoDescription?.value || '').trim(),
    image: String(el.pageSeoImage?.value || '').trim(),
  };

  setBusy(true, 'Guardando página...');
  try {
    await fetchJson('/api/portal/content/pages', {
      method: 'PUT',
      body: JSON.stringify({
        page_id: state.selectedPageId,
        page_key: el.pageKey.value,
        route_path: el.pagePath.value,
        title: el.pageTitle.value,
        locale: el.pageLocale.value,
        description: el.pageDescription.value,
        seo,
        expected_updated_at: state.page?.updated_at || null,
      }),
    });

    clearPageDraft();
    await loadPages();
    showAlert('Página actualizada.', 'success');
  } finally {
    setBusy(false);
  }
}

async function setPublishStatus(action) {
  if (!state.selectedPageId) {
    showAlert('Selecciona una página primero.', 'error', 5000);
    return;
  }

  setBusy(true, action === 'publish' ? 'Publicando página...' : 'Cambiando a borrador...');
  try {
    await fetchJson('/api/portal/content/publish', {
      method: 'POST',
      body: JSON.stringify({
        page_id: state.selectedPageId,
        action,
        expected_updated_at: state.page?.updated_at || null,
      }),
    });

    await loadPages();
    showAlert(action === 'publish' ? 'Página publicada.' : 'Página enviada a borrador.', 'success');
  } finally {
    setBusy(false);
  }
}

function requestPublishAction(action, trigger) {
  if (!state.selectedPageId || !state.page) {
    showAlert('Selecciona una página primero.', 'error', 5000);
    return;
  }
  if (hasUnsavedEditorDrafts()) {
    showAlert('Guarda primero los borradores locales de la página y sus secciones.', 'error', 7000);
    return;
  }
  const publishing = action === 'publish';
  openConfirmDialog({
    title: publishing ? 'Publicar página' : 'Enviar página a borrador',
    description: publishing
      ? 'La página y todas sus secciones no archivadas quedarán visibles para el público.'
      : 'La página dejará de estar disponible públicamente; su contenido seguirá guardado en el CMS.',
    summary: `${state.page.title || state.page.page_key} · ${state.page.route_path || '/'}`,
    confirmLabel: publishing ? 'Publicar ahora' : 'Enviar a borrador',
    trigger,
    onConfirm: () => setPublishStatus(action),
  });
}

async function openPreview() {
  if (!state.selectedPageId) {
    showAlert('Selecciona una página primero.', 'error', 5000);
    return;
  }
  if (hasUnsavedEditorDrafts()) {
    showAlert('Guarda primero los borradores locales para que la vista previa refleje tus cambios.', 'error', 7000);
    return;
  }

  setBusy(true, 'Generando link de preview...');
  try {
    const data = await fetchJson('/api/portal/content/preview-link', {
      method: 'POST',
      body: JSON.stringify({ page_id: state.selectedPageId }),
    });

    const path = String(data.preview_path || '/');
    window.open(path, '_blank', 'noopener,noreferrer');
    showAlert('Preview abierto en una nueva pestaña.', 'success');
  } finally {
    setBusy(false);
  }
}

async function createPageFromModal() {
  const pageKey = String(el.modalPageKey?.value || '').trim();
  const title = String(el.modalPageTitle?.value || '').trim();
  const routePath = String(el.modalPagePath?.value || '').trim() || '/';

  if (!pageKey || !title) {
    setModalFeedback(el.pageModal, 'Completa el nombre interno y el título antes de crear la página.');
    el.modalPageKey?.focus();
    return;
  }

  setBusy(true, 'Creando página...');
  try {
    const data = await fetchJson('/api/portal/content/pages', {
      method: 'POST',
      body: JSON.stringify({
        page_key: pageKey,
        title,
        route_path: routePath,
        locale: 'es',
      }),
    });

    state.selectedPageId = data.page.id;
    await loadPages();
    closeEditorModal(el.pageModal, { clearDraft: true });
    showAlert('Página creada en borrador.', 'success');
  } finally {
    setBusy(false);
  }
}

async function createSectionFromModal() {
  if (!state.selectedPageId) {
    showAlert('Selecciona una página primero.', 'error', 5000);
    return;
  }

  const key = String(el.modalSectionKey?.value || '').trim();
  const kind = String(el.modalSectionKind?.value || 'rich_text').trim();
  const title = String(el.modalSectionTitle?.value || key).trim();

  if (!key) {
    setModalFeedback(el.sectionModal, 'Escribe el nombre interno de la sección antes de crearla.');
    el.modalSectionKey?.focus();
    return;
  }

  setBusy(true, 'Creando sección...');
  try {
    await fetchJson('/api/portal/content/sections', {
      method: 'POST',
      body: JSON.stringify({
        page_id: state.selectedPageId,
        section_key: key,
        kind,
        title: title || key,
        position: state.sections.length,
        payload: { text: '', image: '', cta: null },
      }),
    });

    await loadPage(state.selectedPageId, true);
    closeEditorModal(el.sectionModal, { clearDraft: true });
    showAlert('Sección creada.', 'success');
  } finally {
    setBusy(false);
  }
}

async function uploadImageKitMedia(file, folder) {
  const authorization = await fetchJson('/api/portal/content/media-upload-token', {
    method: 'POST',
    body: JSON.stringify({
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      folder,
      page_key: String(state.page?.page_key || ''),
    }),
  });

  const imageKitForm = new FormData();
  imageKitForm.append('file', file);
  Object.entries(authorization.upload_payload || {}).forEach(([key, value]) => {
    imageKitForm.append(key, String(value));
  });
  imageKitForm.append('token', authorization.token);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let uploaded;
  try {
    const response = await fetch(authorization.upload_url, {
      method: 'POST',
      body: imageKitForm,
      signal: controller.signal,
    });
    uploaded = await response.json().catch(() => ({}));
    if (!response.ok || !uploaded?.fileId) {
      throw new Error(uploaded?.message || uploaded?.error?.message || 'ImageKit rechazó la imagen.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw makeTimeoutError(`La subida de ${file.name}`);
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  await fetchJson('/api/portal/content/media-register', {
    method: 'POST',
    body: JSON.stringify({
      file_id: uploaded.fileId,
      registration_token: authorization.registration_token,
      original_name: file.name,
    }),
  });
}

async function uploadSupabaseMedia(file, folder) {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', folder);
  form.append('page_key', String(state.page?.page_key || ''));
  await fetchJson('/api/portal/content/media', { method: 'POST', body: form });
}

async function uploadMedia(event) {
  event.preventDefault();
  const selectedFiles = state.mediaSelection;
  if (!selectedFiles.length) {
    showAlert('Selecciona una o más imágenes antes de subir.', 'error', 5000);
    return;
  }
  if (selectedFiles.length > 1500) {
    showAlert('Sube máximo 1.500 imágenes por lote.', 'error', 6000);
    return;
  }

  const files = selectedFiles.filter(isSelectableMediaFile);
  const ignoredCount = selectedFiles.length - files.length;
  if (!files.length) {
    showAlert('La selección no contiene imágenes JPG, PNG o WebP.', 'error', 6000);
    return;
  }
  const invalid = files.filter((file) => (
    file.size <= 0 || file.size > state.mediaMaxBytes
  ));
  if (invalid.length) {
    showAlert(`${invalid.length} archivo(s) no cumplen tipo o peso máximo de ${formatBytes(state.mediaMaxBytes)}.`, 'error', 7000);
    return;
  }

  const baseFolder = safeFolder(el.mediaFolder?.value || state.page?.page_key || 'general');
  const failures = [];
  let cursor = 0;
  let completed = 0;
  const workerCount = Math.min(state.mediaProvider === 'imagekit' ? 3 : 2, files.length);

  setBusy(true, `Subiendo ${files.length} imagen${files.length === 1 ? '' : 'es'}...`);
  updateMediaUploadProgress(0, files.length);
  try {
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= files.length) return;
        const file = files[index];
        const folder = folderForSelectedMedia(file, baseFolder);
        try {
          if (state.mediaProvider === 'imagekit') await uploadImageKitMedia(file, folder);
          else await uploadSupabaseMedia(file, folder);
        } catch (error) {
          console.error('[cms-media] bulk upload item failed', file.name, error);
          failures.push({ file, message: parseError(error, 'No se pudo subir.') });
        }
        completed += 1;
        updateMediaUploadProgress(completed, files.length, failures.length);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await loadMedia(true);

    if (failures.length) {
      setDroppedMediaFiles(failures.map((failure) => failure.file));
      const examples = failures.slice(0, 3).map((failure) => failure.file.name).join(', ');
      showAlert(`${files.length - failures.length} subidas; ${failures.length} pendientes para reintentar: ${examples}`, 'error', 12000);
    } else {
      if (el.mediaFile) el.mediaFile.value = '';
      if (el.mediaDirectory) el.mediaDirectory.value = '';
      state.mediaSelection = [];
      renderSelectedMediaFile();
      const ignored = ignoredCount ? ` · ${ignoredCount} archivo no compatible ignorado` : '';
      showAlert(`${files.length} imagen${files.length === 1 ? '' : 'es'} subidas y verificadas correctamente${ignored}.`, 'success', 7000);
    }
  } finally {
    setBusy(false);
  }
}

function bindModalEvents() {
  el.newPage?.addEventListener('click', (event) => {
    openEditorModal(el.pageModal, event.currentTarget);
  });

  el.pageModalClose?.addEventListener('click', () => requestCloseEditorModal(el.pageModal));
  el.pageModalCancel?.addEventListener('click', () => requestCloseEditorModal(el.pageModal, { allowDiscard: true }));
  el.pageModal?.addEventListener('click', (event) => {
    if (event.target !== el.pageModal) return;
    setModalFeedback(el.pageModal, 'El borrador sigue abierto. Usa Cancelar si quieres cerrarlo o descartarlo.');
    el.modalPageKey?.focus();
  });
  el.pageModalForm?.addEventListener('input', () => persistModalDraft(el.pageModal));
  el.pageModalForm?.addEventListener('change', () => persistModalDraft(el.pageModal));
  el.pageModalForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    createPageFromModal().catch((error) => {
      setModalFeedback(el.pageModal, parseError(error, 'No se pudo crear la página.'));
    });
  });

  el.newSection?.addEventListener('click', (event) => {
    if (!state.selectedPageId) {
      showAlert('Selecciona una página primero.', 'error', 5000);
      return;
    }
    openEditorModal(el.sectionModal, event.currentTarget);
  });

  el.sectionModalClose?.addEventListener('click', () => requestCloseEditorModal(el.sectionModal));
  el.sectionModalCancel?.addEventListener('click', () => requestCloseEditorModal(el.sectionModal, { allowDiscard: true }));
  el.sectionModal?.addEventListener('click', (event) => {
    if (event.target !== el.sectionModal) return;
    setModalFeedback(el.sectionModal, 'El borrador sigue abierto. Usa Cancelar si quieres cerrarlo o descartarlo.');
    el.modalSectionKey?.focus();
  });
  el.sectionModalForm?.addEventListener('input', () => persistModalDraft(el.sectionModal));
  el.sectionModalForm?.addEventListener('change', () => persistModalDraft(el.sectionModal));
  el.sectionModalForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    createSectionFromModal().catch((error) => {
      setModalFeedback(el.sectionModal, parseError(error, 'No se pudo crear la sección.'));
    });
  });

  el.confirmClose?.addEventListener('click', closeConfirmDialog);
  el.confirmCancel?.addEventListener('click', closeConfirmDialog);
  el.confirmSubmit?.addEventListener('click', () => {
    runConfirmAction();
  });
  el.confirmModal?.addEventListener('click', (event) => {
    if (event.target !== el.confirmModal) return;
    setConfirmFeedback('La acción no se ejecutó. Usa Cancelar para cerrar esta confirmación.', 'info');
    el.confirmSubmit?.focus();
  });
}

async function boot() {
  try {
    setBusy(true, 'Validando sesión CMS...');
    showGate('Validando sesión CMS...');

    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }

    if (auth.token) {
      state.headers.authorization = `Bearer ${auth.token}`;
    }

    const { ok: sessionOk, data: session } = await getPortalSession({ auth });
    if (!sessionOk || !session?.ok) {
      throw new Error(session?.error || 'No se pudo validar la sesión.');
    }
    const role = session?.profile?.effective_role || session?.profile?.role || 'user';
    if (!['admin', 'superadmin'].includes(role)) {
      window.location.replace('/portal');
      return;
    }

    state.permissionValidated = true;
    showSecureContent();
    await loadPages(true);
    clearAlert();
  } catch (error) {
    if (state.permissionValidated) {
      showSecureContent();
      showAlert(parseError(error, 'No se pudo inicializar el panel CMS.'), 'error', 0);
    } else {
      showGate(parseError(error, 'No se pudieron validar permisos CMS.'));
    }
  } finally {
    setBusy(false);
    applySchemaState();
  }
}

el.filter?.addEventListener('input', renderPages);
PAGE_DRAFT_FIELDS.forEach((field) => {
  el[field]?.addEventListener('input', persistPageDraft);
  el[field]?.addEventListener('change', persistPageDraft);
});
el.sections?.addEventListener('input', (event) => {
  const card = event.target instanceof Element ? event.target.closest('[data-section-id]') : null;
  if (card) persistSectionDraft(card);
});
el.sections?.addEventListener('change', (event) => {
  const card = event.target instanceof Element ? event.target.closest('[data-section-id]') : null;
  if (card) persistSectionDraft(card);
});
el.pageSave?.addEventListener('click', () => {
  savePage().catch((error) => {
    showAlert(parseError(error, 'No se pudo guardar la página.'), 'error', 6000);
  });
});
el.pagePublish?.addEventListener('click', (event) => {
  requestPublishAction('publish', event.currentTarget);
});
el.pageUnpublish?.addEventListener('click', (event) => {
  requestPublishAction('unpublish', event.currentTarget);
});
el.pagePreview?.addEventListener('click', () => {
  openPreview().catch((error) => {
    showAlert(parseError(error, 'No se pudo abrir preview.'), 'error', 6000);
  });
});

el.mediaRefresh?.addEventListener('click', () => {
  loadMedia().catch((error) => {
    showAlert(parseError(error, 'No se pudo cargar la biblioteca.'), 'error', 6000);
  });
});
el.mediaUploadForm?.addEventListener('submit', (event) => {
  uploadMedia(event).catch((error) => {
    showAlert(parseError(error, 'No se pudo subir el archivo.'), 'error', 6000);
  });
});

el.mediaFile?.addEventListener('change', () => {
  state.mediaSelection = Array.from(el.mediaFile?.files || []);
  renderSelectedMediaFile();
});

el.mediaDirectoryTrigger?.addEventListener('click', () => el.mediaDirectory?.click());
el.mediaDropzone?.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  el.mediaFile?.click();
});
el.mediaDirectory?.addEventListener('change', () => {
  state.mediaSelection = Array.from(el.mediaDirectory?.files || [])
    .filter(isSelectableMediaFile);
  renderSelectedMediaFile();
});

['dragenter', 'dragover'].forEach((eventName) => {
  el.mediaDropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.mediaDropzone.classList.add('border-[#293C74]', 'bg-[#293C74]/10');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  el.mediaDropzone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    el.mediaDropzone.classList.remove('bg-[#293C74]/10');
    if (eventName === 'drop') {
      const files = event.dataTransfer?.files;
      if (files?.length) setDroppedMediaFiles(files);
    } else if (!state.mediaSelection.length) {
      el.mediaDropzone.classList.remove('border-[#293C74]');
    }
  });
});

document.addEventListener('keydown', handleDialogKeydown);
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedEditorDrafts() && !modalHasDraft(el.pageModal) && !modalHasDraft(el.sectionModal)) return;
  event.preventDefault();
  event.returnValue = '';
});

setPageActionAvailability();
bindModalEvents();
boot();
