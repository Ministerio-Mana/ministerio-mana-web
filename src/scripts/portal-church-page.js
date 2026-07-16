import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const API_URL = '/api/portal/church-pages';
const MEDIA_URL = '/api/portal/church-media';
const MAX_GALLERY = 8;
const MAX_SCENES = 6;
const REQUEST_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 60000;

let authHeaders = {};

const state = {
  churches: [],
  pages: [],
  church: null,
  page: null,
  dirty: false,
  busy: false,
  media: [],
  mediaTarget: '',
  modalTrigger: null,
};

const el = {
  gate: document.getElementById('church-page-gate'),
  app: document.getElementById('church-page-app'),
  setup: document.getElementById('church-page-setup'),
  form: document.getElementById('church-page-form'),
  church: document.getElementById('church-page-church'),
  alert: document.getElementById('church-page-alert'),
  publicLink: document.getElementById('church-page-public-link'),
  name: document.getElementById('church-page-name'),
  tagline: document.getElementById('church-page-tagline'),
  description: document.getElementById('church-page-description'),
  slug: document.getElementById('church-page-slug'),
  schedule: document.getElementById('church-page-schedule'),
  heroAlt: document.getElementById('church-page-hero-alt'),
  pastorAlt: document.getElementById('church-page-pastor-alt'),
  pastorName: document.getElementById('church-page-pastor-name'),
  pastorTitle: document.getElementById('church-page-pastor-title'),
  whatsapp: document.getElementById('church-page-whatsapp'),
  email: document.getElementById('church-page-email'),
  whatsappMessage: document.getElementById('church-page-whatsapp-message'),
  heroPreview: document.getElementById('church-page-hero-preview'),
  pastorPreview: document.getElementById('church-page-pastor-preview'),
  templates: document.getElementById('church-page-templates'),
  themes: document.getElementById('church-page-themes'),
  storySection: document.getElementById('church-page-story-section'),
  scenes: document.getElementById('church-page-scenes'),
  addScene: document.getElementById('church-page-add-scene'),
  gallery: document.getElementById('church-page-gallery'),
  preview: document.getElementById('church-page-preview'),
  previewLabel: document.getElementById('church-page-preview-label'),
  status: document.getElementById('church-page-status'),
  save: document.getElementById('church-page-save'),
  publish: document.getElementById('church-page-publish'),
  publishLabel: document.getElementById('church-page-publish-label'),
  saveStatus: document.getElementById('church-page-save-status'),
  mediaModal: document.getElementById('church-media-modal'),
  mediaClose: document.getElementById('church-media-close'),
  mediaList: document.getElementById('church-media-list'),
  mediaEmpty: document.getElementById('church-media-empty'),
  mediaSearch: document.getElementById('church-media-search'),
  mediaUpload: document.getElementById('church-media-upload'),
  mediaFile: document.getElementById('church-media-file'),
  mediaDropzone: document.getElementById('church-media-dropzone'),
  mediaUploadStatus: document.getElementById('church-media-upload-status'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 18);
}

function createScene(index, churchName = '') {
  return {
    id: `escena-${Date.now()}-${index}`,
    eyebrow: index === 0 ? 'Bienvenidos' : 'Nuestra comunidad',
    title: index === 0 ? churchName || 'Nuestra iglesia' : 'Caminamos juntos',
    text: '',
    image: '',
    imageAlt: '',
    focalPoint: 'center',
    layout: index === 0 ? 'backdrop' : 'split-right',
    primaryLabel: '',
    primaryHref: '',
  };
}

function defaultPage(church) {
  const place = [church?.city, church?.country].filter(Boolean).join(', ');
  const name = String(church?.name || 'Iglesia Maná');
  return {
    id: null,
    church_id: church?.id,
    version: 0,
    status: 'DRAFT',
    template: 'ESSENTIAL',
    slug: slugify(church?.code || name),
    display_name: name,
    tagline: place ? `Una familia de fe en ${place}` : 'Una familia para crecer en la fe',
    description: 'Conoce nuestra comunidad, horarios, próximos eventos y formas de contactarnos.',
    hero_image_url: '',
    hero_image_alt: '',
    pastor_name: String(church?.contact_name || ''),
    pastor_title: '',
    pastor_image_url: '',
    pastor_image_alt: '',
    service_schedule: '',
    contact_whatsapp: normalizePhone(church?.contact_phone),
    contact_whatsapp_message: '',
    contact_email: String(church?.contact_email || ''),
    story_config: {
      preset: 'editorial',
      theme: 'navy',
      scenes: [createScene(0, name), createScene(1, name)],
    },
    gallery: [],
    published_at: null,
    updated_at: null,
  };
}

function normalizePage(page, church) {
  const fallback = defaultPage(church);
  const value = page && typeof page === 'object' ? page : {};
  const story = value.story_config && typeof value.story_config === 'object' ? value.story_config : fallback.story_config;
  const scenes = Array.isArray(story.scenes) ? story.scenes.slice(0, MAX_SCENES) : fallback.story_config.scenes;
  return {
    ...fallback,
    ...value,
    template: ['ESSENTIAL', 'STORY', 'MOSAIC'].includes(String(value.template || '').toUpperCase()) ? String(value.template).toUpperCase() : 'ESSENTIAL',
    status: ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(String(value.status || '').toUpperCase()) ? String(value.status).toUpperCase() : 'DRAFT',
    story_config: {
      preset: story.preset || 'editorial',
      theme: ['navy', 'light', 'warm'].includes(String(story.theme || '').toLowerCase())
        ? String(story.theme).toLowerCase()
        : 'navy',
      scenes,
    },
    gallery: Array.isArray(value.gallery) ? value.gallery.slice(0, MAX_GALLERY) : [],
  };
}

function draftKey() {
  return state.church?.id ? `mana:church-page:${state.church.id}` : '';
}

function saveLocalDraft() {
  const key = draftKey();
  if (!key || !state.page) return;
  try { sessionStorage.setItem(key, JSON.stringify({ page: state.page, ts: Date.now() })); } catch {}
}

function readLocalDraft(church) {
  try {
    const raw = sessionStorage.getItem(`mana:church-page:${church.id}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.page ? normalizePage(parsed.page, church) : null;
  } catch {
    return null;
  }
}

function clearLocalDraft() {
  try { if (draftKey()) sessionStorage.removeItem(draftKey()); } catch {}
}

function showAlert(message, mode = 'info') {
  if (!el.alert) return;
  el.alert.textContent = message;
  el.alert.className = 'rounded-xl border px-4 py-4 text-sm font-semibold';
  el.alert.classList.add(mode === 'error' ? 'border-red-200' : mode === 'success' ? 'border-emerald-200' : 'border-blue-200');
  el.alert.classList.add(mode === 'error' ? 'bg-red-50' : mode === 'success' ? 'bg-emerald-50' : 'bg-blue-50');
  el.alert.classList.add(mode === 'error' ? 'text-red-800' : mode === 'success' ? 'text-emerald-800' : 'text-blue-800');
  el.alert.classList.remove('hidden');
}

function setBusy(busy, message = '') {
  state.busy = busy;
  [el.save, el.publish].forEach((button) => { if (button) button.disabled = busy; });
  if (el.saveStatus && message) el.saveStatus.textContent = message;
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value));
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'include', ...options, headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) redirectToLogin();
      const error = new Error(payload.error || 'No se pudo completar la operación.');
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Revisa tu conexión e intenta de nuevo.');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function markDirty() {
  if (!state.page) return;
  state.dirty = true;
  saveLocalDraft();
  if (el.saveStatus) el.saveStatus.textContent = 'Cambios conservados en este dispositivo; falta guardar.';
  renderStatus();
  renderPreview();
}

function setImagePreview(node, url, emptyText) {
  if (!node) return;
  const safe = safeUrl(url);
  node.style.backgroundImage = safe ? `url("${safe.replace(/"/g, '%22')}")` : '';
  node.textContent = safe ? '' : emptyText;
  node.classList.toggle('text-xs', !safe);
  node.classList.toggle('text-slate-400', !safe);
}

function renderStatus() {
  if (!state.page) return;
  const published = state.page.status === 'PUBLISHED';
  const savedAfterPublish = published && state.page.updated_at && state.page.published_at
    && new Date(state.page.updated_at).getTime() > new Date(state.page.published_at).getTime();
  const pending = state.dirty || savedAfterPublish;
  if (el.status) {
    el.status.textContent = published ? (pending ? 'Publicado · cambios pendientes' : 'Publicado') : 'Borrador';
    el.status.className = `rounded-full px-4 py-2 text-xs font-black ${published && !pending ? 'bg-emerald-100 text-emerald-800' : pending ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`;
  }
  if (el.publishLabel) el.publishLabel.textContent = published ? 'Publicar cambios' : 'Publicar';
  if (el.publicLink) {
    el.publicLink.href = `/iglesias/${state.page.slug}`;
    el.publicLink.classList.toggle('hidden', !published);
    el.publicLink.classList.toggle('inline-flex', published);
  }
}

function renderScenes() {
  if (!el.scenes || !state.page) return;
  const scenes = state.page.story_config.scenes;
  el.scenes.innerHTML = scenes.map((scene, index) => `
    <article class="church-scene-card" data-scene-index="${index}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong class="text-sm text-[#293C74]">Escena ${index + 1}</strong>
        <div class="flex gap-2">
          <button type="button" data-scene-action="up" class="min-h-12 min-w-12 rounded-lg border border-slate-200 text-xs font-black" aria-label="Subir escena ${index + 1}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-scene-action="down" class="min-h-12 min-w-12 rounded-lg border border-slate-200 text-xs font-black" aria-label="Bajar escena ${index + 1}" ${index === scenes.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-scene-action="remove" class="min-h-12 rounded-lg px-4 text-xs font-black text-red-700" ${scenes.length <= 2 ? 'disabled' : ''}>Quitar</button>
        </div>
      </div>
      <div class="church-scene-image" data-image-target="scene:${index}" data-image-drop-target="scene:${index}" role="button" tabindex="0" aria-label="Elegir o arrastrar imagen para la escena ${index + 1}" style="${safeUrl(scene.image) ? `background-image:url('${escapeHtml(safeUrl(scene.image))}')` : ''}"></div>
      <button type="button" data-scene-action="image" class="church-secondary-button mt-4">Elegir imagen</button>
      <div class="church-scene-grid mt-4">
        <label class="church-field">Título<input data-scene-field="title" maxlength="90" value="${escapeHtml(scene.title)}" /></label>
        <label class="church-field">Frase pequeña<input data-scene-field="eyebrow" maxlength="60" value="${escapeHtml(scene.eyebrow)}" /></label>
        <label class="church-field">Presentación<select data-scene-field="layout">
          <option value="backdrop" ${scene.layout === 'backdrop' ? 'selected' : ''}>Imagen de fondo</option>
          <option value="split-left" ${scene.layout === 'split-left' ? 'selected' : ''}>Imagen a la izquierda</option>
          <option value="split-right" ${scene.layout === 'split-right' ? 'selected' : ''}>Imagen a la derecha</option>
          <option value="poster" ${scene.layout === 'poster' ? 'selected' : ''}>Arte protagonista</option>
        </select></label>
        <label class="church-field">Punto importante<select data-scene-field="focalPoint">
          ${['center','top','bottom','left','right'].map((value) => `<option value="${value}" ${scene.focalPoint === value ? 'selected' : ''}>${{center:'Centro',top:'Arriba',bottom:'Abajo',left:'Izquierda',right:'Derecha'}[value]}</option>`).join('')}
        </select></label>
        <label class="church-field sm:col-span-2">Texto<textarea data-scene-field="text" rows="3" maxlength="520">${escapeHtml(scene.text)}</textarea></label>
        <label class="church-field sm:col-span-2">Descripción de imagen<input data-scene-field="imageAlt" maxlength="160" value="${escapeHtml(scene.imageAlt)}" /></label>
      </div>
    </article>
  `).join('');
  if (el.addScene) el.addScene.disabled = scenes.length >= MAX_SCENES;
}

function renderGallery() {
  if (!el.gallery || !state.page) return;
  el.gallery.innerHTML = state.page.gallery.map((image, index) => `
    <article class="church-gallery-card" data-gallery-index="${index}">
      <img src="${escapeHtml(safeUrl(image.url))}" alt="" />
      <label class="church-field mt-2">Descripción<input data-gallery-alt maxlength="160" value="${escapeHtml(image.alt || '')}" /></label>
      <button type="button" data-gallery-remove>Quitar foto</button>
    </article>
  `).join('');
}

function previewScene(scene, index, mosaic = false) {
  const image = safeUrl(scene?.image);
  return `<article class="${mosaic ? 'preview-mosaic-card' : 'preview-story-card'}" style="${image ? `background-image:url('${escapeHtml(image)}')` : ''}">
    <div><small>${escapeHtml(scene?.eyebrow || `Escena ${index + 1}`)}</small><strong>${escapeHtml(scene?.title || 'Agrega un título')}</strong></div>
  </article>`;
}

function renderPreview() {
  if (!el.preview || !state.page) return;
  const page = state.page;
  const hero = safeUrl(page.hero_image_url);
  const theme = ['navy', 'light', 'warm'].includes(page.story_config?.theme) ? page.story_config.theme : 'navy';
  const labels = { ESSENTIAL: 'Esencial', STORY: 'Historia', MOSAIC: 'Mosaico' };
  if (el.previewLabel) el.previewLabel.textContent = labels[page.template] || 'Esencial';
  if (page.template === 'STORY') {
    el.preview.innerHTML = `<div class="preview-story preview-shell--${theme}">${page.story_config.scenes.map((scene, index) => previewScene(scene, index)).join('')}</div>`;
    return;
  }
  if (page.template === 'MOSAIC') {
    el.preview.innerHTML = `<div class="preview-mosaic preview-shell--${theme}"><header><small>${escapeHtml(page.tagline || 'Bienvenidos')}</small><strong>${escapeHtml(page.display_name || 'Iglesia Maná')}</strong></header><div>${page.story_config.scenes.map((scene, index) => previewScene(scene, index, true)).join('')}</div></div>`;
    return;
  }
  el.preview.innerHTML = `<div class="preview-essential preview-shell--${theme}">
    <header style="${hero ? `background-image:linear-gradient(0deg,rgba(7,17,28,.78),rgba(7,17,28,.15)),url('${escapeHtml(hero)}')` : ''}">
      <small>${escapeHtml([state.church?.city, state.church?.country].filter(Boolean).join(', '))}</small>
      <strong>${escapeHtml(page.display_name || 'Iglesia Maná')}</strong><span>${escapeHtml(page.tagline || '')}</span>
    </header>
    <section><strong>Una iglesia para caminar juntos</strong><p>${escapeHtml(page.description || 'Agrega una descripción de la comunidad.')}</p></section>
  </div>`;
}

function populateForm() {
  const page = state.page;
  if (!page) return;
  el.name.value = page.display_name || '';
  el.tagline.value = page.tagline || '';
  el.description.value = page.description || '';
  el.slug.value = page.slug || '';
  el.schedule.value = page.service_schedule || '';
  el.heroAlt.value = page.hero_image_alt || '';
  el.pastorAlt.value = page.pastor_image_alt || '';
  el.pastorName.value = page.pastor_name || '';
  el.pastorTitle.value = page.pastor_title || '';
  el.whatsapp.value = page.contact_whatsapp || '';
  el.email.value = page.contact_email || '';
  el.whatsappMessage.value = page.contact_whatsapp_message || '';
  el.templates?.querySelectorAll('input[name="template"]').forEach((input) => { input.checked = input.value === page.template; });
  el.themes?.querySelectorAll('input[name="story_theme"]').forEach((input) => { input.checked = input.value === page.story_config.theme; });
  setImagePreview(el.heroPreview, page.hero_image_url, 'Sin portada');
  setImagePreview(el.pastorPreview, page.pastor_image_url, 'Sin imagen');
  renderScenes();
  renderGallery();
  renderPreview();
  renderStatus();
  el.storySection?.toggleAttribute('open', page.template !== 'ESSENTIAL');
}

function selectChurch(churchId) {
  if (state.page) saveLocalDraft();
  state.church = state.churches.find((church) => church.id === churchId) || state.churches[0] || null;
  if (!state.church) return;
  const serverPage = state.pages.find((page) => page.church_id === state.church.id);
  const localDraft = readLocalDraft(state.church);
  state.page = localDraft || normalizePage(serverPage || null, state.church);
  state.dirty = Boolean(localDraft);
  if (el.church) el.church.value = state.church.id;
  populateForm();
}

function bindSimpleField(node, key, transform = (value) => value) {
  node?.addEventListener('input', () => {
    if (!state.page) return;
    state.page[key] = transform(node.value);
    markDirty();
  });
}

function applyMedia(url) {
  const safe = safeUrl(url);
  if (!safe || !state.page) return;
  if (state.mediaTarget === 'hero') state.page.hero_image_url = safe;
  else if (state.mediaTarget === 'pastor') state.page.pastor_image_url = safe;
  else if (state.mediaTarget === 'gallery') {
    if (state.page.gallery.length >= MAX_GALLERY) return showAlert(`La galería admite máximo ${MAX_GALLERY} imágenes.`, 'error');
    state.page.gallery.push({ url: safe, alt: '' });
  } else if (state.mediaTarget.startsWith('scene:')) {
    const index = Number(state.mediaTarget.split(':')[1]);
    if (state.page.story_config.scenes[index]) state.page.story_config.scenes[index].image = safe;
  }
  markDirty();
  populateForm();
  closeMedia();
}

function renderMedia() {
  const query = String(el.mediaSearch?.value || '').trim().toLowerCase();
  const files = state.media.filter((file) => String(file.name || '').toLowerCase().includes(query));
  if (el.mediaList) el.mediaList.innerHTML = files.map((file) => `
    <button type="button" class="church-media-card" data-media-url="${escapeHtml(safeUrl(file.public_url))}">
      <img src="${escapeHtml(safeUrl(file.thumbnail_url || file.public_url))}" alt="" loading="lazy" />
      <span>${escapeHtml(file.name)}</span>
    </button>
  `).join('');
  el.mediaEmpty?.classList.toggle('hidden', files.length > 0);
}

async function loadMedia() {
  if (!state.church) return;
  if (el.mediaList) el.mediaList.innerHTML = '<p class="text-sm text-slate-500">Cargando imágenes...</p>';
  try {
    const payload = await fetchJson(`${MEDIA_URL}?church_id=${encodeURIComponent(state.church.id)}`);
    state.media = payload.files || [];
    renderMedia();
  } catch (error) {
    if (el.mediaList) el.mediaList.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(error.message)}</p>`;
  }
}

function openMedia(target, trigger) {
  state.mediaTarget = target;
  state.modalTrigger = trigger || document.activeElement;
  el.mediaModal?.classList.remove('hidden');
  el.mediaModal?.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  loadMedia();
  window.setTimeout(() => el.mediaSearch?.focus(), 0);
}

function closeMedia() {
  el.mediaModal?.classList.add('hidden');
  el.mediaModal?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.modalTrigger?.focus?.();
  state.modalTrigger = null;
}

function getMediaFileError(file) {
  if (!file || file.size <= 0 || file.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
    return 'Usa JPG, PNG o WebP de máximo 5 MB.';
  }
  return '';
}

async function uploadMediaFile(file, target = state.mediaTarget) {
  if (!file || !state.church || state.busy) return;
  const validationError = getMediaFileError(file);
  if (validationError) {
    if (el.mediaUploadStatus) el.mediaUploadStatus.textContent = validationError;
    showAlert(validationError, 'error');
    return;
  }
  state.mediaTarget = target;
  setBusy(true, 'Subiendo y optimizando la imagen...');
  if (el.mediaUploadStatus) el.mediaUploadStatus.textContent = 'Subiendo y verificando imagen...';
  showAlert('Subiendo la imagen. No cierres esta página.', 'info');
  try {
    const authorization = await fetchJson('/api/portal/church-media-upload-token', {
      method: 'POST',
      body: JSON.stringify({ church_id: state.church.id, file_name: file.name, file_type: file.type, file_size: file.size }),
    });
    const form = new FormData();
    form.append('file', file);
    Object.entries(authorization.upload_payload || {}).forEach(([key, value]) => form.append(key, String(value)));
    form.append('token', authorization.token);
    const uploadController = new AbortController();
    const uploadTimeoutId = window.setTimeout(() => uploadController.abort(), UPLOAD_TIMEOUT_MS);
    let uploadResponse;
    try {
      uploadResponse = await fetch(authorization.upload_url, { method: 'POST', body: form, signal: uploadController.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La carga tardó demasiado. Revisa tu conexión e intenta de nuevo.');
      throw error;
    } finally {
      window.clearTimeout(uploadTimeoutId);
    }
    const uploaded = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploaded.fileId) throw new Error(uploaded?.message || 'ImageKit rechazó la imagen.');
    const registered = await fetchJson('/api/portal/church-media-register', {
      method: 'POST',
      body: JSON.stringify({ church_id: state.church.id, file_id: uploaded.fileId, registration_token: authorization.registration_token, original_name: file.name }),
    });
    if (el.mediaUploadStatus) el.mediaUploadStatus.textContent = 'Imagen lista.';
    if (el.mediaFile) el.mediaFile.value = '';
    applyMedia(registered.file?.public_url || uploaded.url);
    showAlert('Imagen lista. El diseño la adapta sin deformarla.', 'success');
  } catch (error) {
    const message = error.message || 'No se pudo subir la imagen.';
    if (el.mediaUploadStatus) el.mediaUploadStatus.textContent = message;
    showAlert(message, 'error');
  } finally {
    setBusy(false);
  }
}

async function uploadMedia(event) {
  event.preventDefault();
  const file = el.mediaFile?.files?.[0];
  if (!file) return;
  await uploadMediaFile(file);
}

async function savePage() {
  if (!state.page || !state.church || state.busy) return false;
  setBusy(true, 'Guardando borrador...');
  try {
    const payload = await fetchJson(API_URL, {
      method: 'PUT',
      body: JSON.stringify({ church_id: state.church.id, expected_version: Number(state.page.version || 0), page: state.page }),
    });
    state.page = normalizePage(payload.page, state.church);
    const index = state.pages.findIndex((page) => page.church_id === state.church.id);
    if (index >= 0) state.pages[index] = payload.page; else state.pages.push(payload.page);
    state.dirty = false;
    clearLocalDraft();
    populateForm();
    showAlert('Borrador guardado. La página pública no cambia hasta que la publiques.', 'success');
    if (el.saveStatus) el.saveStatus.textContent = 'Borrador guardado correctamente.';
    return true;
  } catch (error) {
    showAlert(error.message, 'error');
    if (el.saveStatus) el.saveStatus.textContent = 'No se perdió lo escrito; puedes reintentar.';
    return false;
  } finally {
    setBusy(false);
  }
}

async function publishPage() {
  if (!state.page || !state.church || state.busy) return;
  if (state.dirty && !(await savePage())) return;
  setBusy(true, 'Validando y publicando...');
  try {
    const payload = await fetchJson(API_URL, {
      method: 'POST',
      body: JSON.stringify({ church_id: state.church.id, expected_version: Number(state.page.version || 0), action: 'publish' }),
    });
    state.page = normalizePage(payload.page, state.church);
    const index = state.pages.findIndex((page) => page.church_id === state.church.id);
    if (index >= 0) state.pages[index] = payload.page;
    state.dirty = false;
    populateForm();
    showAlert('Página publicada. Ya puedes abrirla y compartirla.', 'success');
    if (el.saveStatus) el.saveStatus.textContent = 'Publicación actualizada.';
  } catch (error) {
    const details = error.payload?.validation_errors;
    showAlert(Array.isArray(details) ? details.join(' ') : error.message, 'error');
    if (el.saveStatus) el.saveStatus.textContent = 'Corrige lo indicado; el borrador sigue guardado.';
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  bindSimpleField(el.name, 'display_name');
  bindSimpleField(el.tagline, 'tagline');
  bindSimpleField(el.description, 'description');
  bindSimpleField(el.slug, 'slug', slugify);
  bindSimpleField(el.schedule, 'service_schedule');
  bindSimpleField(el.heroAlt, 'hero_image_alt');
  bindSimpleField(el.pastorAlt, 'pastor_image_alt');
  bindSimpleField(el.pastorName, 'pastor_name');
  bindSimpleField(el.pastorTitle, 'pastor_title');
  bindSimpleField(el.whatsapp, 'contact_whatsapp', normalizePhone);
  bindSimpleField(el.email, 'contact_email', (value) => value.trim().toLowerCase());
  bindSimpleField(el.whatsappMessage, 'contact_whatsapp_message');

  el.church?.addEventListener('change', () => selectChurch(el.church.value));
  el.templates?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="template"]');
    if (!input || !state.page) return;
    state.page.template = input.value;
    if (state.page.template !== 'ESSENTIAL') el.storySection?.setAttribute('open', '');
    markDirty();
  });
  document.addEventListener('click', (event) => {
    const imageButton = event.target instanceof Element ? event.target.closest('[data-image-target]') : null;
    if (imageButton) openMedia(imageButton.dataset.imageTarget, imageButton);
  });
  document.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const imageTarget = event.target instanceof Element ? event.target.closest('[data-image-drop-target]') : null;
    if (!imageTarget) return;
    event.preventDefault();
    openMedia(imageTarget.dataset.imageDropTarget, imageTarget);
  });
  document.addEventListener('dragover', (event) => {
    const imageTarget = event.target instanceof Element ? event.target.closest('[data-image-drop-target]') : null;
    if (!imageTarget) return;
    event.preventDefault();
    imageTarget.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', (event) => {
    const imageTarget = event.target instanceof Element ? event.target.closest('[data-image-drop-target]') : null;
    imageTarget?.classList.remove('is-dragging');
  });
  document.addEventListener('drop', (event) => {
    const imageTarget = event.target instanceof Element ? event.target.closest('[data-image-drop-target]') : null;
    if (!imageTarget) return;
    event.preventDefault();
    imageTarget.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) void uploadMediaFile(file, imageTarget.dataset.imageDropTarget);
  });
  el.scenes?.addEventListener('input', (event) => {
    const field = event.target.closest('[data-scene-field]');
    const card = event.target.closest('[data-scene-index]');
    const scene = state.page?.story_config.scenes[Number(card?.dataset.sceneIndex)];
    if (!field || !scene) return;
    scene[field.dataset.sceneField] = field.value;
    markDirty();
  });
  el.scenes?.addEventListener('change', (event) => {
    const field = event.target.closest('[data-scene-field]');
    const card = event.target.closest('[data-scene-index]');
    const scene = state.page?.story_config.scenes[Number(card?.dataset.sceneIndex)];
    if (!field || !scene) return;
    scene[field.dataset.sceneField] = field.value;
    markDirty();
  });
  el.scenes?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-scene-action]');
    const card = event.target.closest('[data-scene-index]');
    if (!button || !card || !state.page) return;
    const index = Number(card.dataset.sceneIndex);
    const scenes = state.page.story_config.scenes;
    if (button.dataset.sceneAction === 'image') return openMedia(`scene:${index}`, button);
    if (button.dataset.sceneAction === 'remove' && scenes.length > 2) scenes.splice(index, 1);
    if (button.dataset.sceneAction === 'up' && index > 0) [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]];
    if (button.dataset.sceneAction === 'down' && index < scenes.length - 1) [scenes[index + 1], scenes[index]] = [scenes[index], scenes[index + 1]];
    markDirty();
    renderScenes();
  });
  el.themes?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="story_theme"]');
    if (!input || !state.page || !['navy', 'light', 'warm'].includes(input.value)) return;
    state.page.story_config.theme = input.value;
    markDirty();
  });
  el.addScene?.addEventListener('click', () => {
    if (!state.page || state.page.story_config.scenes.length >= MAX_SCENES) return;
    state.page.story_config.scenes.push(createScene(state.page.story_config.scenes.length, state.page.display_name));
    markDirty();
    renderScenes();
  });
  el.gallery?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-gallery-alt]');
    const card = event.target.closest('[data-gallery-index]');
    const image = state.page?.gallery[Number(card?.dataset.galleryIndex)];
    if (!input || !image) return;
    image.alt = input.value;
    markDirty();
  });
  el.gallery?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-gallery-remove]');
    const card = event.target.closest('[data-gallery-index]');
    if (!button || !card || !state.page) return;
    state.page.gallery.splice(Number(card.dataset.galleryIndex), 1);
    markDirty();
    renderGallery();
  });
  el.form?.addEventListener('submit', (event) => { event.preventDefault(); savePage(); });
  el.publish?.addEventListener('click', publishPage);
  el.mediaClose?.addEventListener('click', closeMedia);
  el.mediaModal?.addEventListener('click', (event) => { if (event.target === el.mediaModal) closeMedia(); });
  el.mediaList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-media-url]');
    if (button) applyMedia(button.dataset.mediaUrl);
  });
  el.mediaSearch?.addEventListener('input', renderMedia);
  el.mediaUpload?.addEventListener('submit', uploadMedia);
  el.mediaFile?.addEventListener('change', () => { if (el.mediaUploadStatus) el.mediaUploadStatus.textContent = el.mediaFile.files?.[0]?.name || ''; });
  el.mediaDropzone?.addEventListener('dragover', (event) => { event.preventDefault(); el.mediaDropzone.classList.add('border-[#293C74]'); });
  el.mediaDropzone?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    el.mediaFile?.click();
  });
  el.mediaDropzone?.addEventListener('dragleave', () => el.mediaDropzone.classList.remove('border-[#293C74]'));
  el.mediaDropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    el.mediaDropzone.classList.remove('border-[#293C74]');
    const file = event.dataTransfer?.files?.[0];
    if (!file || !el.mediaFile) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    el.mediaFile.files = transfer.files;
    el.mediaUploadStatus.textContent = file.name;
  });
  document.addEventListener('keydown', (event) => {
    const modalOpen = el.mediaModal?.getAttribute('aria-hidden') === 'false';
    if (event.key === 'Escape' && modalOpen) {
      closeMedia();
      return;
    }
    if (event.key !== 'Tab' || !modalOpen || !el.mediaModal) return;
    const focusable = Array.from(el.mediaModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
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
  });
  window.addEventListener('beforeunload', saveLocalDraft);
}

async function init() {
  bindEvents();
  try {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    const payload = await fetchJson(API_URL);
    el.gate?.classList.add('hidden');
    el.app?.classList.remove('hidden');
    state.churches = payload.churches || [];
    state.pages = payload.pages || [];
    if (!payload.schema_ready) {
      el.setup?.classList.remove('hidden');
      return;
    }
    if (!state.churches.length) {
      showAlert('Tu cuenta todavía no tiene una iglesia asignada.', 'error');
      return;
    }
    if (el.church) {
      el.church.innerHTML = state.churches.map((church) => `<option value="${escapeHtml(church.id)}">${escapeHtml([church.name, church.city, church.country].filter(Boolean).join(' · '))}</option>`).join('');
      el.church.disabled = state.churches.length === 1;
    }
    el.form?.classList.remove('hidden');
    selectChurch(state.churches[0].id);
  } catch (error) {
    if (el.gate) {
      el.gate.textContent = error.message || 'No se pudo abrir el editor.';
      el.gate.classList.add('border-red-200', 'bg-red-50', 'text-red-800');
    }
  }
}

init();
