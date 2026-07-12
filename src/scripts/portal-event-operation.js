import checkCircleIconUrl from 'lucide-static/icons/circle-check-big.svg?url';
import externalLinkIconUrl from 'lucide-static/icons/external-link.svg?url';
import fileIconUrl from 'lucide-static/icons/file.svg?url';
import userCheckIconUrl from 'lucide-static/icons/user-check.svg?url';
import xCircleIconUrl from 'lucide-static/icons/circle-x.svg?url';
import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const root = document.querySelector('[data-event-operation-root]');
const gate = document.getElementById('event-operation-gate');
const content = document.getElementById('event-operation-content');
const list = document.getElementById('event-operation-list');
const loading = document.getElementById('event-operation-loading');
const empty = document.getElementById('event-operation-empty');
const search = document.getElementById('event-operation-search');
const statusFilter = document.getElementById('event-operation-status');
const refreshButton = document.getElementById('event-operation-refresh');
const pagination = document.getElementById('event-operation-pagination');
const pageLabel = document.getElementById('event-operation-page');
const reviewModal = document.getElementById('event-review-modal');
const reviewTitle = document.getElementById('event-review-title');
const reviewSummary = document.getElementById('event-review-summary');
const reviewNote = document.getElementById('event-review-note');
const reviewError = document.getElementById('event-review-error');
const reviewConfirm = document.getElementById('event-review-confirm');
const reviewClose = document.getElementById('event-review-close');
const reviewCancel = document.getElementById('event-review-cancel');
const documentsForm = document.getElementById('event-documents-form');
const documentsFile = document.getElementById('event-documents-file');
const documentsSubmit = document.getElementById('event-documents-submit');
const documentsRefresh = document.getElementById('event-documents-refresh');
const documentsMessage = document.getElementById('event-documents-message');
const documentsHelp = document.getElementById('event-documents-help');
const documentsLoading = document.getElementById('event-documents-loading');
const documentsList = document.getElementById('event-documents-list');
const documentsEmpty = document.getElementById('event-documents-empty');

const eventId = String(root?.dataset.eventId || '');
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_EVENT_TIMEZONE = 'America/Bogota';
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const STATUS_LABELS = {
  UNDER_REVIEW: 'Por verificar',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Rechazada',
  EXPIRED: 'Vencida',
  PENDING_PAYMENT: 'Pendiente de pago',
  REFUNDED: 'Reembolsada',
};
const STATUS_TONES = {
  UNDER_REVIEW: 'bg-amber-50 text-amber-800',
  CONFIRMED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-red-50 text-red-700',
  EXPIRED: 'bg-slate-100 text-slate-600',
  PENDING_PAYMENT: 'bg-blue-50 text-blue-700',
  REFUNDED: 'bg-violet-50 text-violet-700',
};

let authHeaders = {};
let registrations = [];
let permissions = { can_approve: false, can_check_in: false };
let currentPage = 1;
let totalPages = 1;
let pendingReview = null;

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

function icon(url) {
  return `<img src="${escapeAttr(url)}" alt="" aria-hidden="true" class="h-4 w-4" />`;
}

function formatAmount(amount, currency = 'COP') {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toLocaleString('es-CO')}`;
  }
}

function formatDate(value, timeZone = DEFAULT_EVENT_TIMEZONE) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.sharepoint.com') ? url.href : '';
  } catch {
    return '';
  }
}

function setDocumentsMessage(message = '', tone = 'info') {
  if (!documentsMessage) return;
  documentsMessage.textContent = message;
  documentsMessage.className = message
    ? `rounded-md border px-3 py-2 text-sm ${tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'}`
    : 'hidden rounded-md border px-3 py-2 text-sm';
}

function renderEventDocuments(documents) {
  if (!documentsList || !documentsEmpty || !documentsLoading) return;
  documentsLoading.classList.add('hidden');
  documentsList.classList.toggle('hidden', documents.length === 0);
  documentsEmpty.classList.toggle('hidden', documents.length > 0);
  documentsList.innerHTML = documents.map((documentItem) => {
    const url = safeHttpsUrl(documentItem.sharepoint_web_url);
    const failed = documentItem.status === 'FAILED';
    const action = url && !failed
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#293C74] hover:bg-slate-50">${icon(externalLinkIconUrl)} Abrir</a>`
      : '';
    return `<div class="flex min-h-16 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">${icon(fileIconUrl)}</span>
        <div class="min-w-0">
          <p class="break-words text-sm font-bold text-slate-800">${escapeHtml(documentItem.original_name || 'Archivo')}</p>
          <p class="mt-1 text-xs ${failed ? 'font-bold text-red-700' : 'text-slate-500'}">${failed ? 'La carga no se completó' : `${escapeHtml(formatFileSize(documentItem.size_bytes))} · ${escapeHtml(formatDate(documentItem.created_at))}`}</p>
        </div>
      </div>
      ${action}
    </div>`;
  }).join('');
}

async function loadEventDocuments({ quiet = false } = {}) {
  if (!documentsLoading || !documentsList || !documentsEmpty) return;
  if (!quiet) {
    documentsLoading.classList.remove('hidden');
    documentsList.classList.add('hidden');
    documentsEmpty.classList.add('hidden');
  }
  const params = new URLSearchParams({ event_id: eventId });
  const { response, data } = await fetchJson(`/api/portal/event-documents?${params}`, {
    headers: authHeaders,
    credentials: 'include',
  });
  if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los archivos del evento.');

  if (data.setup_required) {
    documentsLoading.classList.add('hidden');
    documentsList.classList.add('hidden');
    documentsEmpty.classList.remove('hidden');
    documentsForm?.classList.add('hidden');
    documentsForm?.classList.remove('grid');
    documentsHelp?.classList.add('hidden');
    setDocumentsMessage('Falta activar el registro seguro de documentos en la base de datos.', 'info');
    return;
  }

  documentsForm?.classList.toggle('hidden', !data.write_enabled);
  documentsForm?.classList.toggle('grid', Boolean(data.write_enabled));
  documentsHelp?.classList.toggle('hidden', !data.write_enabled);
  setDocumentsMessage(data.write_enabled ? '' : 'La biblioteca está conectada en lectura. Las cargas se habilitarán cuando termine el permiso mínimo de Microsoft.', 'info');
  renderEventDocuments(Array.isArray(data.documents) ? data.documents : []);
}

async function uploadEventDocument(event) {
  event.preventDefault();
  const file = documentsFile?.files?.[0];
  if (!file) {
    setDocumentsMessage('Selecciona un archivo.', 'error');
    return;
  }
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
    setDocumentsMessage('El archivo debe pesar máximo 4 MB.', 'error');
    return;
  }
  documentsSubmit.disabled = true;
  const originalMarkup = documentsSubmit.innerHTML;
  documentsSubmit.textContent = 'Subiendo...';
  setDocumentsMessage('');
  try {
    const formData = new FormData();
    formData.set('event_id', eventId);
    formData.set('file', file, file.name);
    const { response, data } = await fetchJson('/api/portal/event-documents', {
      method: 'POST',
      headers: authHeaders,
      credentials: 'include',
      body: formData,
      timeoutMs: 45_000,
    });
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
    documentsForm.reset();
    await loadEventDocuments({ quiet: true });
    setDocumentsMessage('Archivo guardado en la biblioteca del evento.', 'success');
  } catch (error) {
    setDocumentsMessage(error?.message || 'No se pudo subir el archivo.', 'error');
  } finally {
    documentsSubmit.disabled = false;
    documentsSubmit.innerHTML = originalMarkup;
  }
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Intenta nuevamente.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function setStat(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || 0);
}

function showContent() {
  gate?.classList.add('hidden');
  content?.classList.remove('hidden');
}

function renderRegistrations() {
  if (!list || !empty || !loading) return;
  const query = String(search?.value || '').trim().toLowerCase();
  const visible = registrations.filter((registration) => {
    if (!query) return true;
    const payment = registration.payment || {};
    return `${registration.contact_name || ''} ${registration.contact_email || ''} ${registration.contact_phone || ''} ${payment.reported_reference || ''} ${payment.reference || ''}`
      .toLowerCase()
      .includes(query);
  });

  loading.classList.add('hidden');
  list.classList.toggle('hidden', visible.length === 0);
  empty.classList.toggle('hidden', visible.length > 0);
  list.innerHTML = visible.map((registration) => {
    const status = String(registration.status || '').toUpperCase();
    const payment = registration.payment;
    const quantity = Number(registration.quantity || 0);
    const checkedIn = Number(registration.checked_in_quantity || 0);
    const remaining = Math.max(0, quantity - checkedIn);
    const paymentInfo = payment ? `
      <dl class="grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt class="text-xs font-bold uppercase text-slate-500">Método</dt><dd class="mt-1 font-semibold text-slate-800">${escapeHtml(payment.method_label || payment.method || 'Manual')}</dd></div>
        <div><dt class="text-xs font-bold uppercase text-slate-500">Reportado</dt><dd class="mt-1 break-words font-semibold text-slate-800">${escapeHtml(payment.reported_reference || 'Sin referencia')}</dd></div>
        <div><dt class="text-xs font-bold uppercase text-slate-500">Referencia Maná</dt><dd class="mt-1 break-all font-mono text-xs text-slate-700">${escapeHtml(payment.reference || '')}</dd></div>
        <div><dt class="text-xs font-bold uppercase text-slate-500">Valor</dt><dd class="mt-1 font-bold text-[#293C74]">${escapeHtml(formatAmount(payment.amount, payment.currency))}</dd></div>
      </dl>` : '';
    const reviewActions = status === 'UNDER_REVIEW' && payment?.id && permissions.can_approve ? `
      <button type="button" class="event-review-action inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700" data-action="APPROVE" data-payment-id="${escapeAttr(payment.id)}" data-registration-id="${escapeAttr(registration.id)}">${icon(checkCircleIconUrl)} Aprobar pago</button>
      <button type="button" class="event-review-action inline-flex min-h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50" data-action="DECLINE" data-payment-id="${escapeAttr(payment.id)}" data-registration-id="${escapeAttr(registration.id)}">${icon(xCircleIconUrl)} Rechazar</button>` : '';
    const checkinAction = status === 'CONFIRMED' && permissions.can_check_in && remaining > 0 ? `
      <label class="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-slate-700">Asistentes
        <input type="number" min="1" max="${remaining}" value="${remaining}" data-checkin-quantity class="w-20 rounded-md border-slate-300 py-2" />
      </label>
      <button type="button" class="event-checkin-action inline-flex min-h-10 items-center gap-2 rounded-md bg-[#293C74] px-4 py-2 text-sm font-bold text-white hover:bg-[#20315f]" data-registration-id="${escapeAttr(registration.id)}">${icon(userCheckIconUrl)} Registrar asistencia</button>` : '';
    const attendance = status === 'CONFIRMED'
      ? `<span class="text-sm font-semibold text-slate-600">Asistencia: ${checkedIn} de ${quantity}</span>`
      : '';

    return `
      <article class="portal-panel p-4 sm:p-5" data-registration-row="${escapeAttr(registration.id)}">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-lg font-bold text-[#293C74]">${escapeHtml(registration.contact_name || 'Sin nombre')}</h2>
                <span class="portal-chip ${STATUS_TONES[status] || 'bg-slate-100 text-slate-600'}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
              </div>
              <p class="mt-1 break-words text-sm text-slate-600">${escapeHtml(registration.contact_email || '')}${registration.contact_phone ? ` · ${escapeHtml(registration.contact_phone)}` : ''}</p>
              <p class="mt-1 text-xs text-slate-500">${quantity} asistente${quantity === 1 ? '' : 's'} · Reportado ${escapeHtml(formatDate(registration.created_at))}</p>
            </div>
            <strong class="text-base text-[#293C74]">${escapeHtml(formatAmount(registration.total_amount, registration.currency))}</strong>
          </div>
          ${paymentInfo}
          <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            ${attendance}
            ${reviewActions}
            ${checkinAction}
          </div>
        </div>
      </article>`;
  }).join('');
}

function updatePagination(paginationData) {
  currentPage = Number(paginationData?.page || 1);
  totalPages = Number(paginationData?.pages || 1);
  if (pageLabel) pageLabel.textContent = `Página ${currentPage} de ${totalPages}`;
  const previous = pagination?.querySelector('[data-page-action="previous"]');
  const next = pagination?.querySelector('[data-page-action="next"]');
  if (previous) previous.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
  pagination?.classList.toggle('hidden', totalPages <= 1);
  pagination?.classList.toggle('flex', totalPages > 1);
}

async function loadOperation(page = currentPage) {
  if (!list || !loading || !empty) return;
  loading.classList.remove('hidden');
  list.classList.add('hidden');
  empty.classList.add('hidden');
  const params = new URLSearchParams({ event_id: eventId, page: String(page) });
  const selectedStatus = String(statusFilter?.value || '');
  if (selectedStatus) params.set('status', selectedStatus);
  const { response, data } = await fetchJson(`/api/portal/event-payments/manual?${params}`, {
    headers: authHeaders,
    credentials: 'include',
  });
  if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar la operación del evento.');

  registrations = Array.isArray(data.registrations) ? data.registrations : [];
  permissions = { ...permissions, ...(data.permissions || {}) };
  const event = data.event || {};
  const title = document.getElementById('event-operation-title');
  const meta = document.getElementById('event-operation-meta');
  if (title) title.textContent = event.title || 'Evento';
  if (meta) meta.textContent = [formatDate(event.start_date, event.timezone || DEFAULT_EVENT_TIMEZONE), event.status].filter(Boolean).join(' · ');
  setStat('event-operation-total', data.summary?.total);
  setStat('event-operation-review', data.summary?.under_review);
  setStat('event-operation-confirmed', data.summary?.confirmed);
  setStat('event-operation-checkins', data.summary?.checked_in);
  updatePagination(data.pagination);
  renderRegistrations();
  showContent();
}

function closeReviewModal() {
  reviewModal?.classList.add('hidden');
  reviewModal?.classList.remove('flex');
  document.body.style.overflow = '';
  pendingReview = null;
  if (reviewNote) reviewNote.value = '';
  if (reviewError) {
    reviewError.textContent = '';
    reviewError.classList.add('hidden');
  }
}

function openReviewModal(action, registration) {
  if (!reviewModal || !registration?.payment) return;
  pendingReview = { action, registration };
  const approving = action === 'APPROVE';
  if (reviewTitle) reviewTitle.textContent = approving ? 'Aprobar pago' : 'Rechazar pago';
  if (reviewSummary) {
    reviewSummary.innerHTML = `
      <strong class="block text-[#293C74]">${escapeHtml(registration.contact_name)}</strong>
      <span class="mt-1 block">${escapeHtml(formatAmount(registration.payment.amount, registration.payment.currency))} · ${escapeHtml(registration.payment.method_label || 'Pago manual')}</span>
      <span class="mt-1 block break-words">Referencia reportada: ${escapeHtml(registration.payment.reported_reference || 'Sin referencia')}</span>`;
  }
  if (reviewConfirm) {
    reviewConfirm.textContent = approving ? 'Aprobar y confirmar inscripción' : 'Rechazar pago';
    reviewConfirm.className = `min-h-11 rounded-md px-5 py-2 text-sm font-bold text-white ${approving ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`;
  }
  reviewModal.classList.remove('hidden');
  reviewModal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  reviewNote?.focus();
}

async function submitReview() {
  if (!pendingReview || !reviewConfirm) return;
  const note = String(reviewNote?.value || '').trim();
  if (pendingReview.action === 'DECLINE' && note.length < 3) {
    if (reviewError) {
      reviewError.textContent = 'Escribe el motivo del rechazo.';
      reviewError.classList.remove('hidden');
    }
    return;
  }
  reviewConfirm.disabled = true;
  const original = reviewConfirm.textContent;
  reviewConfirm.textContent = 'Guardando...';
  try {
    const { response, data } = await fetchJson('/api/portal/event-payments/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      credentials: 'include',
      body: JSON.stringify({
        event_id: eventId,
        payment_id: pendingReview.registration.payment.id,
        action: pendingReview.action,
        note,
      }),
    });
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo revisar el pago.');
    closeReviewModal();
    await loadOperation(currentPage);
  } catch (error) {
    if (reviewError) {
      reviewError.textContent = error?.message || 'No se pudo revisar el pago.';
      reviewError.classList.remove('hidden');
    }
  } finally {
    reviewConfirm.disabled = false;
    reviewConfirm.textContent = original;
  }
}

async function recordCheckIn(button) {
  const registrationId = String(button.dataset.registrationId || '');
  const registration = registrations.find((item) => item.id === registrationId);
  const row = button.closest('[data-registration-row]');
  const quantity = Number(row?.querySelector('[data-checkin-quantity]')?.value || 1);
  if (!registration || !Number.isInteger(quantity) || quantity < 1) return;
  if (!window.confirm(`Registrar asistencia de ${quantity} persona${quantity === 1 ? '' : 's'} para ${registration.contact_name}?`)) return;
  button.disabled = true;
  try {
    const { response, data } = await fetchJson('/api/portal/event-payments/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      credentials: 'include',
      body: JSON.stringify({ event_id: eventId, registration_id: registrationId, action: 'CHECK_IN', quantity }),
    });
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo registrar la asistencia.');
    await loadOperation(currentPage);
  } catch (error) {
    window.alert(error?.message || 'No se pudo registrar la asistencia.');
    button.disabled = false;
  }
}

list?.addEventListener('click', (event) => {
  const reviewButton = event.target.closest('.event-review-action');
  if (reviewButton) {
    const registration = registrations.find((item) => item.id === reviewButton.dataset.registrationId);
    if (registration) openReviewModal(reviewButton.dataset.action, registration);
    return;
  }
  const checkinButton = event.target.closest('.event-checkin-action');
  if (checkinButton) void recordCheckIn(checkinButton);
});
search?.addEventListener('input', renderRegistrations);
statusFilter?.addEventListener('change', () => {
  currentPage = 1;
  void loadOperation(1).catch(showFatalError);
});
refreshButton?.addEventListener('click', () => {
  void loadOperation(currentPage).catch(showFatalError);
  void loadEventDocuments({ quiet: true }).catch((error) => setDocumentsMessage(error?.message || 'No se pudieron actualizar los archivos.', 'error'));
});
documentsRefresh?.addEventListener('click', () => void loadEventDocuments().catch((error) => {
  documentsLoading?.classList.add('hidden');
  setDocumentsMessage(error?.message || 'No se pudieron cargar los archivos.', 'error');
}));
documentsForm?.addEventListener('submit', (event) => void uploadEventDocument(event));
pagination?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page-action]');
  if (!button || button.disabled) return;
  const nextPage = button.dataset.pageAction === 'next' ? currentPage + 1 : currentPage - 1;
  void loadOperation(nextPage).catch(showFatalError);
});
reviewClose?.addEventListener('click', closeReviewModal);
reviewCancel?.addEventListener('click', closeReviewModal);
reviewConfirm?.addEventListener('click', () => void submitReview());
reviewModal?.addEventListener('click', (event) => {
  if (event.target === reviewModal) closeReviewModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && reviewModal?.classList.contains('flex')) closeReviewModal();
});

function showFatalError(error) {
  loading?.classList.add('hidden');
  if (gate) {
    gate.textContent = error?.message || 'No se pudo cargar la operación del evento.';
    gate.classList.remove('hidden');
  }
  content?.classList.add('hidden');
}

async function init() {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error('El evento no es válido.');
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    await loadOperation(1);
    await loadEventDocuments().catch((error) => {
      documentsLoading?.classList.add('hidden');
      setDocumentsMessage(error?.message || 'No se pudieron cargar los archivos del evento.', 'error');
    });
  } catch (error) {
    showFatalError(error);
  }
}

void init();
