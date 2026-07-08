import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const SECTION_KINDS = ['hero', 'rich_text', 'gallery', 'cta', 'video', 'cards', 'custom'];
const SECTION_STATUSES = ['draft', 'published', 'archived'];
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
  busyCount: 0,
  alertTimeout: null,
};

const el = {
  alert: document.getElementById('cms-alert'),
  busy: document.getElementById('cms-busy'),
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
  mediaFile: document.getElementById('cms-media-file'),
  mediaFolder: document.getElementById('cms-media-folder'),
  mediaStatus: document.getElementById('cms-media-status'),
  mediaList: document.getElementById('cms-media-list'),
  mediaEmpty: document.getElementById('cms-media-empty'),

  pageModal: document.getElementById('cms-page-modal'),
  pageModalForm: document.getElementById('cms-page-modal-form'),
  pageModalClose: document.getElementById('cms-page-modal-close'),
  pageModalCancel: document.getElementById('cms-page-modal-cancel'),
  modalPageKey: document.getElementById('cms-modal-page-key'),
  modalPageTitle: document.getElementById('cms-modal-page-title'),
  modalPagePath: document.getElementById('cms-modal-page-path'),

  sectionModal: document.getElementById('cms-section-modal'),
  sectionModalForm: document.getElementById('cms-section-modal-form'),
  sectionModalClose: document.getElementById('cms-section-modal-close'),
  sectionModalCancel: document.getElementById('cms-section-modal-cancel'),
  modalSectionKey: document.getElementById('cms-modal-section-key'),
  modalSectionKind: document.getElementById('cms-modal-section-kind'),
  modalSectionTitle: document.getElementById('cms-modal-section-title'),
};

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
    .replace(/\/+/, '/')
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
    btn.disabled = isBusy;
    btn.classList.toggle('opacity-60', isBusy);
    btn.classList.toggle('cursor-not-allowed', isBusy);
  });
}

function showAlert(message, tone = 'info', ttlMs = 4500) {
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

  el.alert.textContent = message;

  if (ttlMs > 0) {
    state.alertTimeout = window.setTimeout(() => {
      clearAlert();
    }, ttlMs);
  }
}

function clearAlert() {
  if (!el.alert) return;
  el.alert.classList.add('hidden');
  el.alert.textContent = '';
}

function setPageActionAvailability() {
  const hasPage = Boolean(state.selectedPageId);
  [el.pageSave, el.pagePublish, el.pageUnpublish, el.pagePreview, el.newSection].forEach((node) => {
    if (!node) return;
    node.disabled = !hasPage;
    node.classList.toggle('opacity-60', !hasPage);
    node.classList.toggle('cursor-not-allowed', !hasPage);
  });
}

function openModal(node) {
  if (!node) return;
  node.classList.remove('hidden');
}

function closeModal(node) {
  if (!node) return;
  node.classList.add('hidden');
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
  el.pageMeta.textContent = `Estado: ${page.status || 'draft'} | Versión: ${page.version || 1} | Actualizado: ${page.updated_at ? new Date(page.updated_at).toLocaleString('es-CO') : '-'}`;

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
        <button type="button" data-page-id="${escapeAttr(page.id)}" class="cms-page-item w-full text-left rounded-xl border px-3 py-3 transition ${active ? 'border-[#293C74]/40 bg-[#293C74]/5 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-bold text-[#293C74]">${escapeHtml(page.title || page.page_key)}</p>
            <span class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone}">${escapeHtml(page.status || 'draft')}</span>
          </div>
          <p class="text-xs text-slate-500 mt-1">${escapeHtml(page.route_path || '/')}</p>
        </button>
      `;
    })
    .join('');

  el.pagesEmpty.classList.toggle('hidden', pages.length > 0);

  el.pages.querySelectorAll('.cms-page-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-page-id');
      if (!pageId || pageId === state.selectedPageId) return;
      loadPage(pageId).catch((error) => {
        showAlert(parseError(error, 'No se pudo cargar la página.'), 'error', 5500);
      });
    });
  });
}

function renderKindOptions(value) {
  return SECTION_KINDS
    .map((kind) => `<option value="${escapeAttr(kind)}"${kind === value ? ' selected' : ''}>${escapeHtml(kind)}</option>`)
    .join('');
}

function renderStatusOptions(value) {
  return SECTION_STATUSES
    .map((status) => `<option value="${escapeAttr(status)}"${status === value ? ' selected' : ''}>${escapeHtml(status)}</option>`)
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
    await Promise.all([
      fetchJson('/api/portal/content/sections', {
        method: 'PUT',
        body: JSON.stringify({ section_id: current.id, position: target.position }),
      }),
      fetchJson('/api/portal/content/sections', {
        method: 'PUT',
        body: JSON.stringify({ section_id: target.id, position: current.position }),
      }),
    ]);

    await loadPage(state.selectedPageId, true);
    showAlert('Orden actualizado.', 'success');
  } finally {
    setBusy(false);
  }
}

function renderSections() {
  if (!el.sections || !el.sectionsEmpty) return;

  if (!state.selectedPageId) {
    el.sections.innerHTML = '';
    el.sectionsEmpty.classList.remove('hidden');
    return;
  }

  el.sections.innerHTML = state.sections
    .map((section, index) => {
      const payloadText = JSON.stringify(section.payload || {}, null, 2);
      return `
      <article class="rounded-2xl border border-slate-200 p-4 md:p-5 bg-slate-50/50" data-section-id="${escapeAttr(section.id)}">
        <div class="flex items-center justify-between gap-2 mb-3">
          <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Bloque ${index + 1}</p>
          <div class="flex items-center gap-2">
            <button type="button" class="cms-section-up h-8 w-8 rounded-lg border border-slate-300 text-slate-600" data-cms-action ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="cms-section-down h-8 w-8 rounded-lg border border-slate-300 text-slate-600" data-cms-action ${index === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label class="text-xs font-bold text-slate-600">Key
            <input data-field="section_key" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="${escapeAttr(section.section_key || '')}" />
          </label>
          <label class="text-xs font-bold text-slate-600">Tipo
            <select data-field="kind" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">${renderKindOptions(section.kind || 'rich_text')}</select>
          </label>
          <label class="text-xs font-bold text-slate-600">Posición
            <input data-field="position" type="number" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="${escapeAttr(Number(section.position || 0))}" />
          </label>
          <label class="text-xs font-bold text-slate-600">Estado
            <select data-field="status" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">${renderStatusOptions(section.status || 'draft')}</select>
          </label>
        </div>
        <label class="mt-3 block text-xs font-bold text-slate-600">Título
          <input data-field="title" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="${escapeAttr(section.title || '')}" />
        </label>
        <label class="mt-3 block text-xs font-bold text-slate-600">Payload JSON
          <textarea data-field="payload" rows="7" class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono">${escapeHtml(payloadText)}</textarea>
        </label>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" class="cms-section-save px-3 py-2 rounded-lg bg-brand-teal text-white text-xs font-bold" data-cms-action>Guardar sección</button>
          <button type="button" class="cms-section-delete px-3 py-2 rounded-lg border border-red-300 text-red-600 text-xs font-bold" data-cms-action>Eliminar</button>
        </div>
      </article>
      `;
    })
    .join('');

  el.sectionsEmpty.classList.toggle('hidden', state.sections.length > 0);

  el.sections.querySelectorAll('[data-section-id]').forEach((card) => {
    const sectionId = card.getAttribute('data-section-id');
    const saveBtn = card.querySelector('.cms-section-save');
    const deleteBtn = card.querySelector('.cms-section-delete');
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
        showAlert('El payload JSON tiene formato inválido.', 'error', 6000);
        return;
      }

      const body = {
        section_id: sectionId,
        section_key: card.querySelector('[data-field="section_key"]')?.value,
        kind: card.querySelector('[data-field="kind"]')?.value,
        position: Number(card.querySelector('[data-field="position"]')?.value || 0),
        status: card.querySelector('[data-field="status"]')?.value,
        title: card.querySelector('[data-field="title"]')?.value,
        payload,
      };

      setBusy(true, 'Guardando sección...');
      try {
        await fetchJson('/api/portal/content/sections', {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        await loadPage(state.selectedPageId, true);
        showAlert('Sección actualizada.', 'success');
      } catch (error) {
        showAlert(parseError(error, 'No se pudo actualizar sección.'), 'error', 6000);
      } finally {
        setBusy(false);
      }
    });

    deleteBtn?.addEventListener('click', async () => {
      if (!sectionId) return;
      const ok = window.confirm('¿Eliminar esta sección? Esta acción no se puede deshacer.');
      if (!ok) return;
      setBusy(true, 'Eliminando sección...');
      try {
        await fetchJson(`/api/portal/content/sections?section_id=${encodeURIComponent(sectionId)}`, {
          method: 'DELETE',
        });
        await loadPage(state.selectedPageId, true);
        showAlert('Sección eliminada.', 'success');
      } catch (error) {
        showAlert(parseError(error, 'No se pudo eliminar sección.'), 'error', 6000);
      } finally {
        setBusy(false);
      }
    });
  });

  setPageActionAvailability();
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
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
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

function renderMedia() {
  if (!el.mediaList || !el.mediaEmpty) return;

  el.mediaList.innerHTML = state.media
    .map((file) => {
      const isImage = String(file.mime_type || '').startsWith('image/');
      return `
      <article class="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
        ${isImage ? `<img src="${escapeAttr(file.public_url)}" alt="${escapeAttr(file.name)}" class="h-28 w-full object-cover rounded-lg border border-slate-200 bg-white" />` : ''}
        <p class="text-xs font-bold text-[#293C74] break-all">${escapeHtml(file.name || '')}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(formatBytes(file.size))} · ${escapeHtml(file.mime_type || 'archivo')}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="cms-media-copy px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold" data-url="${escapeAttr(file.public_url)}" data-cms-action>Copiar URL</button>
          <button type="button" class="cms-media-delete px-2.5 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-bold" data-path="${escapeAttr(file.path)}" data-cms-action>Eliminar</button>
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
    btn.addEventListener('click', async () => {
      const path = btn.getAttribute('data-path') || '';
      if (!path) return;
      const ok = window.confirm('¿Eliminar este archivo de la biblioteca?');
      if (!ok) return;

      setBusy(true, 'Eliminando archivo...');
      try {
        await fetchJson('/api/portal/content/media', {
          method: 'DELETE',
          body: JSON.stringify({ path }),
        });
        await loadMedia(true);
        showAlert('Archivo eliminado.', 'success');
      } catch (error) {
        showAlert(parseError(error, 'No se pudo eliminar archivo.'), 'error', 6000);
      } finally {
        setBusy(false);
      }
    });
  });
}

async function loadMedia(silent = false) {
  if (!el.mediaStatus) return;

  const prefix = safeFolder(el.mediaFolder?.value || state.page?.page_key || '');
  const query = prefix ? `?prefix=${encodeURIComponent(prefix)}&limit=80` : '?limit=80';
  const data = await fetchJson(`/api/portal/content/media${query}`);
  state.media = data.files || [];

  el.mediaStatus.textContent = `Bucket: ${data.bucket || 'cms-media'} | Prefijo: ${prefix || 'general'} | Archivos: ${state.media.length}`;
  renderMedia();

  if (!silent) {
    showAlert('Biblioteca multimedia actualizada.', 'success');
  }
}

async function loadPages(selectFirst = false) {
  const data = await fetchJson('/api/portal/content/pages');
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
  state.selectedPageId = pageId;

  const [data, history] = await Promise.all([
    fetchJson(`/api/portal/content/pages?page_id=${encodeURIComponent(pageId)}`),
    fetchJson(`/api/portal/content/history?page_id=${encodeURIComponent(pageId)}&limit=40`),
  ]);

  state.page = data.page || null;
  state.sections = data.sections || [];
  state.revisions = history.revisions || [];
  state.logs = history.logs || [];

  applyPageToForm(state.page);
  renderPages();
  renderSections();
  renderHistory();
  setPageActionAvailability();
  await loadMedia(true);

  if (!silent) showAlert(`Página cargada: ${state.page?.title || state.page?.page_key || pageId}`);
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
      }),
    });

    await loadPages();
    await loadPage(state.selectedPageId, true);
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
      body: JSON.stringify({ page_id: state.selectedPageId, action }),
    });

    await loadPages();
    await loadPage(state.selectedPageId, true);
    showAlert(action === 'publish' ? 'Página publicada.' : 'Página enviada a borrador.', 'success');
  } finally {
    setBusy(false);
  }
}

async function openPreview() {
  if (!state.selectedPageId) {
    showAlert('Selecciona una página primero.', 'error', 5000);
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
    showAlert('Debes completar clave y título.', 'error', 5000);
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

    await loadPages();
    await loadPage(data.page.id, true);
    closeModal(el.pageModal);
    resetPageModal();
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
    showAlert('Debes escribir una clave de sección.', 'error', 5000);
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
    closeModal(el.sectionModal);
    resetSectionModal();
    showAlert('Sección creada.', 'success');
  } finally {
    setBusy(false);
  }
}

async function uploadMedia(event) {
  event.preventDefault();
  const file = el.mediaFile?.files?.[0];
  if (!file) {
    showAlert('Selecciona un archivo antes de subir.', 'error', 5000);
    return;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('folder', safeFolder(el.mediaFolder?.value || 'general'));
  form.append('page_key', String(state.page?.page_key || ''));

  setBusy(true, 'Subiendo archivo...');
  try {
    const data = await fetchJson('/api/portal/content/media', {
      method: 'POST',
      body: form,
    });

    if (el.mediaFile) el.mediaFile.value = '';
    await loadMedia(true);
    showAlert(`Archivo subido: ${data.path}`, 'success');
  } finally {
    setBusy(false);
  }
}

function bindModalEvents() {
  el.newPage?.addEventListener('click', () => {
    resetPageModal();
    openModal(el.pageModal);
    el.modalPageKey?.focus();
  });

  el.pageModalClose?.addEventListener('click', () => closeModal(el.pageModal));
  el.pageModalCancel?.addEventListener('click', () => closeModal(el.pageModal));
  el.pageModal?.addEventListener('click', (event) => {
    if (event.target === el.pageModal) closeModal(el.pageModal);
  });
  el.pageModalForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    createPageFromModal().catch((error) => {
      showAlert(parseError(error, 'No se pudo crear la página.'), 'error', 6000);
    });
  });

  el.newSection?.addEventListener('click', () => {
    if (!state.selectedPageId) {
      showAlert('Selecciona una página primero.', 'error', 5000);
      return;
    }
    resetSectionModal();
    openModal(el.sectionModal);
    el.modalSectionKey?.focus();
  });

  el.sectionModalClose?.addEventListener('click', () => closeModal(el.sectionModal));
  el.sectionModalCancel?.addEventListener('click', () => closeModal(el.sectionModal));
  el.sectionModal?.addEventListener('click', (event) => {
    if (event.target === el.sectionModal) closeModal(el.sectionModal);
  });
  el.sectionModalForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    createSectionFromModal().catch((error) => {
      showAlert(parseError(error, 'No se pudo crear la sección.'), 'error', 6000);
    });
  });
}

async function boot() {
  try {
    setBusy(true, 'Validando sesión CMS...');

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
      showAlert('Tu usuario no tiene permisos para gestionar contenido.', 'error', 0);
      setPageActionAvailability();
      return;
    }

    await loadPages(true);
    clearAlert();
  } catch (error) {
    showAlert(parseError(error, 'No se pudo inicializar el panel CMS.'), 'error', 0);
  } finally {
    setBusy(false);
  }
}

el.filter?.addEventListener('input', renderPages);
el.pageSave?.addEventListener('click', () => {
  savePage().catch((error) => {
    showAlert(parseError(error, 'No se pudo guardar la página.'), 'error', 6000);
  });
});
el.pagePublish?.addEventListener('click', () => {
  setPublishStatus('publish').catch((error) => {
    showAlert(parseError(error, 'No se pudo publicar la página.'), 'error', 6000);
  });
});
el.pageUnpublish?.addEventListener('click', () => {
  setPublishStatus('unpublish').catch((error) => {
    showAlert(parseError(error, 'No se pudo despublicar la página.'), 'error', 6000);
  });
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

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeModal(el.pageModal);
  closeModal(el.sectionModal);
});

setPageActionAvailability();
bindModalEvents();
boot();
