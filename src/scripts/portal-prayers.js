import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const gateEl = document.getElementById('prayers-gate');
const secureContentEl = document.getElementById('prayers-secure-content');
const loadingEl = document.getElementById('prayers-loading');
const emptyEl = document.getElementById('prayers-empty');
const listEl = document.getElementById('prayers-list');
const statusEl = document.getElementById('prayers-status');
const visibilityEl = document.getElementById('prayers-visibility');
const refreshEl = document.getElementById('prayers-refresh');
const loadMoreEl = document.getElementById('prayers-load-more');
const statTotalEl = document.getElementById('prayers-stat-total');
const statPrivateEl = document.getElementById('prayers-stat-private');
const statReviewEl = document.getElementById('prayers-stat-review');
const roleNoteEl = document.getElementById('prayers-role-note');
const coverageEl = document.getElementById('prayers-coverage');
const pageFeedbackEl = document.getElementById('prayers-feedback');

const reviewModalEl = document.getElementById('prayer-review-modal');
const reviewCloseEl = document.getElementById('prayer-review-close');
const reviewTitleEl = document.getElementById('prayer-review-title');
const reviewDescriptionEl = document.getElementById('prayer-review-description');
const reviewSummaryEl = document.getElementById('prayer-review-summary');
const reviewFormEl = document.getElementById('prayer-review-form');
const reviewIdEl = document.getElementById('prayer-review-id');
const reviewDecisionEl = document.getElementById('prayer-review-decision');
const reviewNoteWrapEl = document.getElementById('prayer-review-note-wrap');
const reviewNoteEl = document.getElementById('prayer-review-note');
const reviewFeedbackEl = document.getElementById('prayer-review-feedback');
const reviewCancelEl = document.getElementById('prayer-review-cancel');
const reviewSubmitEl = document.getElementById('prayer-review-submit');

const REQUEST_TIMEOUT_MS = 15000;
const PAGE_SIZE = 50;

let authHeaders = {};
let canReview = false;
let currentRows = [];
let prayerPermissionValidated = false;
let dataRevision = 0;
let appendSequence = 0;
let pageFeedbackTimer = null;
let reviewReturnFocus = null;
let reviewDiscardArmed = false;
let paginationState = {
  page: 0,
  pageSize: PAGE_SIZE,
  totalRows: 0,
  hasNextPage: false,
};

function showSecureContent() {
  gateEl?.classList.add('hidden');
  secureContentEl?.classList.remove('hidden');
}

function showGate(message = 'Validando permisos...') {
  if (gateEl) {
    gateEl.textContent = message;
    gateEl.classList.remove('hidden');
  }
  secureContentEl?.classList.add('hidden');
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

function makeTimeoutError(label) {
  const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
  error.name = 'TimeoutError';
  return error;
}

function setPageFeedback(message = '', tone = 'success') {
  if (!pageFeedbackEl) return;
  if (pageFeedbackTimer) window.clearTimeout(pageFeedbackTimer);
  pageFeedbackEl.textContent = message;
  pageFeedbackEl.className = message
    ? `mb-4 rounded-xl border px-4 py-4 text-sm font-semibold ${tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`
    : 'hidden rounded-xl border px-4 py-4 text-sm font-semibold';
  if (message) {
    pageFeedbackTimer = window.setTimeout(() => setPageFeedback(''), 8000);
  }
}

function setReviewFeedback(message = '', tone = 'warning') {
  if (!reviewFeedbackEl) return;
  reviewFeedbackEl.textContent = message;
  reviewFeedbackEl.className = message
    ? `rounded-xl border px-4 py-4 text-sm font-semibold ${tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-800'}`
    : 'hidden rounded-xl border px-4 py-4 text-sm font-semibold';
}

function showLoadError(error) {
  if (!loadingEl) return;
  const message = error?.name === 'TimeoutError'
    ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
    : error?.message || 'No se pudieron cargar peticiones.';
  loadingEl.className = 'py-12 text-center';
  loadingEl.innerHTML = `
    <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-red-700">
      <p class="mb-2 font-bold">Error al cargar peticiones</p>
      <p class="text-sm">${escapeHtml(message)}</p>
      <button type="button" id="btn-retry-prayers" class="mt-4 min-h-11 rounded-full border border-red-100 bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm">
        Reintentar
      </button>
    </div>
  `;
  document.getElementById('btn-retry-prayers')?.addEventListener('click', (event) => {
    void loadPrayers({ restoreFocus: event.currentTarget });
  });
}

function formatDate(value) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function locationLabel(row) {
  return [row.city, row.country].filter(Boolean).join(', ') || 'Ubicación no informada';
}

function visibilityLabel(visibility) {
  return visibility === 'public' ? 'Pública' : 'Privada';
}

function statusLabel(status) {
  const labels = {
    private: 'Privada para intercesión',
    pending: 'Pendiente de revisión',
    flagged: 'Marcada para revisión',
    approved: 'Publicada',
    rejected: 'Rechazada',
  };
  return labels[status] || status || 'Sin estado';
}

function statusClass(status, visibility) {
  if (visibility === 'private' || status === 'private') return 'bg-teal-50 text-teal-700 border-teal-100';
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-100';
  if (status === 'flagged') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
}

const AI_REASON_LABELS = {
  personal_data: 'datos personales',
  minor: 'información sobre un menor',
  specific_medical_detail: 'detalle médico sensible',
  self_harm: 'riesgo de autolesión',
  violence: 'violencia',
  abuse: 'posible abuso',
  sexual_content: 'contenido sexual',
  hate: 'odio',
  harassment: 'acoso',
  threat: 'amenaza',
  accusation: 'acusación contra terceros',
  financial_solicitation: 'solicitud financiera',
  spam: 'spam',
  prompt_injection: 'intento de manipular el análisis',
  unclear: 'contenido ambiguo',
  other: 'requiere criterio humano',
};

function aiRecommendationMarkup(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'ai_consent') || row.visibility !== 'public') return '';
  if (row.ai_consent !== true) {
    return '<div class="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-600"><strong class="block text-[#293C74]">Revisión humana</strong><span>La persona no autorizó análisis automatizado.</span></div>';
  }

  const status = String(row.ai_status || 'not_run');
  const recommendation = String(row.ai_recommendation || '');
  const reasons = Array.isArray(row.ai_reason_codes)
    ? row.ai_reason_codes.map((reason) => AI_REASON_LABELS[reason]).filter(Boolean)
    : [];
  const reasonText = reasons.length ? ` Motivos: ${escapeHtml(reasons.join(', '))}.` : '';
  const urgent = row.ai_urgent_pastoral_review === true
    ? '<strong class="mt-2 block text-red-800">Prioridad pastoral sugerida.</strong>'
    : '';

  if (status === 'safe' && recommendation === 'approve') {
    return '<div class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800"><strong class="block">IA recomienda publicar</strong><span>Modo sombra: todavía requiere decisión humana.</span></div>';
  }
  if (status === 'review' || recommendation === 'review') {
    return `<div class="rounded-md border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900"><strong class="block">IA recomienda revisar</strong><span>Modo sombra: no tomó ninguna decisión.${reasonText}</span>${urgent}</div>`;
  }
  if (status === 'error') {
    return '<div class="rounded-md border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800"><strong class="block">Análisis automático no disponible</strong><span>La petición quedó protegida para revisión humana.</span></div>';
  }
  return '<div class="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-600"><strong class="block text-[#293C74]">Análisis autorizado</strong><span>Aún no se ha ejecutado; revisar manualmente.</span></div>';
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'No se pudo completar la operación');
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw makeTimeoutError('La solicitud');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function updateStats(stats = {}) {
  if (statTotalEl) statTotalEl.textContent = String(Number(stats.total || 0));
  if (statPrivateEl) statPrivateEl.textContent = String(Number(stats.private || 0));
  if (statReviewEl) statReviewEl.textContent = String(Number(stats.review || 0));
}

function setLoadMoreState(isLoading = false) {
  if (!loadMoreEl) return;
  loadMoreEl.classList.toggle('hidden', !paginationState.hasNextPage);
  loadMoreEl.disabled = isLoading;
  loadMoreEl.textContent = isLoading ? 'Cargando...' : 'Cargar más';
}

function updateCoverage() {
  if (!coverageEl) return;
  if (!paginationState.totalRows) {
    coverageEl.textContent = 'Sin peticiones para los filtros seleccionados.';
    return;
  }
  coverageEl.textContent = `Mostrando ${currentRows.length} de ${paginationState.totalRows} peticiones para estos filtros.`;
}

function actionButtons(row) {
  if (!canReview) {
    return '<p class="text-xs font-semibold text-slate-500">Lectura para intercesión.</p>';
  }

  const status = String(row.moderation_status || '');
  const visibility = String(row.visibility || '');
  if (visibility !== 'public' || !['pending', 'flagged'].includes(status)) {
    return '<p class="text-xs font-semibold text-slate-500">Sin acciones pendientes.</p>';
  }

  const id = escapeAttr(row.id);
  const name = escapeAttr(row.first_name || 'esta persona');
  return `
    <div class="flex flex-wrap gap-2">
      <button type="button" data-prayer-action="approve" data-prayer-id="${id}" class="min-h-11 rounded-md bg-brand-teal px-4 py-2 text-xs font-black uppercase text-white transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/30" aria-label="Publicar petición de ${name}">Publicar</button>
      <button type="button" data-prayer-action="keep_private" data-prayer-id="${id}" class="min-h-11 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-[#293C74] transition-all hover:-translate-y-0.5 hover:border-brand-teal/40 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/30" aria-label="Conservar privada la petición de ${name}">Pasar a privada</button>
      <button type="button" data-prayer-action="reject" data-prayer-id="${id}" class="min-h-11 rounded-md border border-red-100 bg-red-50 px-4 py-2 text-xs font-black uppercase text-red-700 transition-all hover:-translate-y-0.5 hover:bg-red-100 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label="Rechazar petición de ${name}">Rechazar</button>
    </div>
  `;
}

function rowMarkup(row, index) {
  const status = String(row.moderation_status || '');
  const visibility = String(row.visibility || 'private');
  return `
    <article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-teal/30" data-prayer-id="${escapeAttr(row.id)}" data-prayer-index="${index}" tabindex="-1">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0 space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="portal-chip border uppercase ${statusClass(status, visibility)}">${escapeHtml(statusLabel(status))}</span>
            <span class="portal-chip border border-slate-200 bg-slate-50 uppercase text-slate-600">${escapeHtml(visibilityLabel(visibility))}</span>
          </div>
          <div>
            <h3 class="font-display text-xl font-black text-[#293C74]">${escapeHtml(row.first_name || 'Alguien')}</h3>
            <p class="text-xs font-semibold uppercase tracking-widest text-slate-500">${escapeHtml(locationLabel(row))} · ${escapeHtml(formatDate(row.created_at))}</p>
          </div>
          <p class="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-700">${escapeHtml(row.request_text || '')}</p>
          ${aiRecommendationMarkup(row)}
          ${row.admin_note ? `<p class="border-l-2 border-slate-200 bg-slate-50 px-4 py-4 text-xs font-semibold text-slate-600">Nota interna: ${escapeHtml(row.admin_note)}</p>` : ''}
        </div>
        <div class="shrink-0 lg:min-w-64">${actionButtons(row)}</div>
      </div>
    </article>
  `;
}

function renderRows(rows, { append = false } = {}) {
  const nextRows = Array.isArray(rows) ? rows : [];
  currentRows = append ? [...currentRows, ...nextRows] : nextRows;
  if (loadingEl) loadingEl.classList.add('hidden');

  if (!currentRows.length) {
    if (listEl) {
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
    }
    emptyEl?.classList.remove('hidden');
    updateCoverage();
    return;
  }

  emptyEl?.classList.add('hidden');
  if (!listEl) return;
  listEl.innerHTML = currentRows.map((row, index) => rowMarkup(row, index)).join('');
  listEl.classList.remove('hidden');
  updateCoverage();
}

async function loadPrayers({ append = false, restoreFocus = null } = {}) {
  const page = append ? paginationState.page + 1 : 1;
  const requestRevision = append ? dataRevision : ++dataRevision;
  const requestAppendSequence = ++appendSequence;

  if (!append) {
    currentRows = [];
    paginationState = { page: 0, pageSize: PAGE_SIZE, totalRows: 0, hasNextPage: false };
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      loadingEl.className = 'py-12 text-center text-slate-400';
      loadingEl.textContent = 'Cargando peticiones...';
    }
    emptyEl?.classList.add('hidden');
    listEl?.classList.add('hidden');
    if (listEl) listEl.innerHTML = '';
    if (coverageEl) coverageEl.textContent = '';
    setLoadMoreState(false);
  } else {
    setLoadMoreState(true);
  }

  try {
    const params = new URLSearchParams();
    params.set('status', statusEl?.value || 'all');
    params.set('visibility', visibilityEl?.value || 'all');
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));

    const payload = await fetchJson(`/api/prayer/admin/list?${params.toString()}`);
    if (requestRevision !== dataRevision || requestAppendSequence !== appendSequence) return false;

    canReview = Boolean(payload.permissions?.canReview);
    if (roleNoteEl) {
      roleNoteEl.textContent = canReview
        ? 'Administración: puedes revisar peticiones públicas; las privadas quedan solo para oración.'
        : 'Intercesión: puedes leer peticiones, sin cambiar su privacidad ni publicación.';
    }
    paginationState = {
      page: Number(payload.pagination?.page || page),
      pageSize: Number(payload.pagination?.pageSize || PAGE_SIZE),
      totalRows: Number(payload.pagination?.totalRows || 0),
      hasNextPage: Boolean(payload.pagination?.hasNextPage),
    };
    updateStats(payload.stats || {});
    renderRows(payload.rows, { append });
    setLoadMoreState(false);
    return true;
  } catch (error) {
    if (requestRevision !== dataRevision || requestAppendSequence !== appendSequence) return false;
    console.error('[portal-prayers] load error', error);
    if (append) {
      setLoadMoreState(false);
      if (loadMoreEl) loadMoreEl.textContent = 'Reintentar carga';
      setPageFeedback(error?.message || 'No se pudo cargar la siguiente página.', 'error');
    } else {
      showLoadError(error);
    }
    return false;
  } finally {
    if (requestRevision === dataRevision && requestAppendSequence === appendSequence && restoreFocus?.isConnected) {
      window.requestAnimationFrame(() => restoreFocus.focus());
    }
  }
}

function getReviewModalFocusableElements() {
  if (!reviewModalEl) return [];
  return Array.from(reviewModalEl.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.closest('.hidden'));
}

function reviewConfig(decision) {
  const configs = {
    approve: {
      title: 'Publicar petición',
      description: 'La petición quedará visible en el muro público. Confirma que no contenga teléfonos, correos, direcciones ni información sensible.',
      submit: 'Publicar petición',
      submitClass: 'bg-brand-teal text-white transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/30',
    },
    keep_private: {
      title: 'Conservar como privada',
      description: 'La petición seguirá disponible únicamente para el equipo autorizado de intercesión y no aparecerá en el muro público.',
      submit: 'Conservar privada',
      submitClass: 'bg-[#293C74] text-white transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#293C74]/30',
    },
    reject: {
      title: 'Rechazar publicación',
      description: 'La petición no aparecerá en el muro público. Puedes dejar un motivo interno que no se enviará a la persona.',
      submit: 'Rechazar petición',
      submitClass: 'bg-red-700 text-white transition-all hover:-translate-y-0.5 hover:bg-red-800 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300',
    },
  };
  return configs[decision] || null;
}

function openReviewModal(row, decision, trigger) {
  if (!reviewModalEl || !reviewFormEl || !reviewIdEl || !reviewDecisionEl || !reviewSubmitEl) return;
  const config = reviewConfig(decision);
  if (!config) return;

  reviewReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  reviewDiscardArmed = false;
  reviewFormEl.reset();
  reviewIdEl.value = String(row.id || '');
  reviewDecisionEl.value = decision;
  if (reviewTitleEl) reviewTitleEl.textContent = config.title;
  if (reviewDescriptionEl) reviewDescriptionEl.textContent = config.description;
  if (reviewSummaryEl) {
    const requestText = String(row.request_text || 'Sin texto').trim();
    const excerpt = requestText.length > 320 ? `${requestText.slice(0, 320)}…` : requestText;
    reviewSummaryEl.innerHTML = `<p class="font-black text-[#293C74]">${escapeHtml(row.first_name || 'Alguien')}</p><p class="mt-2 whitespace-pre-wrap leading-6">${escapeHtml(excerpt)}</p>`;
  }
  reviewNoteWrapEl?.classList.toggle('hidden', decision !== 'reject');
  reviewCancelEl.textContent = 'Cancelar';
  reviewSubmitEl.textContent = config.submit;
  reviewSubmitEl.className = `min-h-11 rounded-md px-4 py-2 text-sm font-black disabled:cursor-wait disabled:opacity-60 ${config.submitClass}`;
  setReviewFeedback('');

  reviewModalEl.classList.remove('hidden');
  reviewModalEl.classList.add('flex');
  reviewModalEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overflow-hidden');
  window.requestAnimationFrame(() => {
    if (decision === 'reject') reviewNoteEl?.focus();
    else reviewSubmitEl.focus();
  });
}

function closeReviewModal({ returnFocus = true } = {}) {
  if (!reviewModalEl || reviewModalEl.classList.contains('hidden')) return;
  reviewModalEl.classList.add('hidden');
  reviewModalEl.classList.remove('flex');
  reviewModalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overflow-hidden');
  setReviewFeedback('');
  reviewDiscardArmed = false;
  if (reviewCancelEl) reviewCancelEl.textContent = 'Cancelar';
  reviewFormEl?.reset();
  if (reviewIdEl) reviewIdEl.value = '';
  if (reviewDecisionEl) reviewDecisionEl.value = '';
  if (returnFocus && reviewReturnFocus?.isConnected) reviewReturnFocus.focus();
}

function hasReviewDraft() {
  return reviewDecisionEl?.value === 'reject' && Boolean(reviewNoteEl?.value.trim());
}

function requestCloseReviewModal({ allowDiscard = false } = {}) {
  if (!hasReviewDraft()) {
    closeReviewModal();
    return;
  }
  if (allowDiscard && reviewDiscardArmed) {
    if (reviewNoteEl) reviewNoteEl.value = '';
    closeReviewModal();
    return;
  }
  reviewDiscardArmed = true;
  if (reviewCancelEl) reviewCancelEl.textContent = 'Borrar nota y cerrar';
  setReviewFeedback('La nota se conservó. Para descartarla, usa “Borrar nota y cerrar”.');
  reviewNoteEl?.focus();
}

function handleReviewModalKeydown(event) {
  if (!reviewModalEl || reviewModalEl.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    requestCloseReviewModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = getReviewModalFocusableElements();
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

async function submitReview() {
  const id = String(reviewIdEl?.value || '');
  const decision = String(reviewDecisionEl?.value || '');
  const row = currentRows.find((item) => item.id === id);
  if (!row || !reviewConfig(decision) || !reviewSubmitEl) return;

  reviewSubmitEl.disabled = true;
  const originalText = reviewSubmitEl.textContent;
  reviewSubmitEl.textContent = 'Guardando...';
  setReviewFeedback('');
  try {
    await fetchJson('/api/prayer/admin/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        decision,
        adminNote: decision === 'reject' ? reviewNoteEl?.value.trim() || '' : '',
      }),
    });
    closeReviewModal({ returnFocus: false });
    setPageFeedback('La decisión quedó guardada de forma segura.');
    await loadPrayers();
    window.requestAnimationFrame(() => {
      const updatedRow = listEl?.querySelector(`[data-prayer-id="${CSS.escape(id)}"]`);
      if (updatedRow instanceof HTMLElement) updatedRow.focus();
      else refreshEl?.focus();
    });
  } catch (error) {
    setReviewFeedback(error?.message || 'No se pudo guardar la decisión.', 'error');
  } finally {
    reviewSubmitEl.disabled = false;
    reviewSubmitEl.textContent = originalText;
  }
}

async function init() {
  try {
    showGate();
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

    const { ok: sessionOk, data: session } = await getPortalSession({ auth });
    if (!sessionOk || !session?.ok) {
      throw new Error(session?.error || 'No se pudo validar la sesión.');
    }
    if (!session.permissions?.can_access_prayers) {
      window.location.replace('/portal');
      return;
    }

    prayerPermissionValidated = true;
    showSecureContent();
    await loadPrayers();
  } catch (error) {
    console.error('[portal-prayers] init error', error);
    if (prayerPermissionValidated) {
      showSecureContent();
      showLoadError(error);
    } else {
      showGate(error?.message || 'No se pudieron validar permisos.');
    }
  }
}

statusEl?.addEventListener('change', (event) => {
  void loadPrayers({ restoreFocus: event.currentTarget });
});
visibilityEl?.addEventListener('change', (event) => {
  void loadPrayers({ restoreFocus: event.currentTarget });
});
refreshEl?.addEventListener('click', (event) => {
  void loadPrayers({ restoreFocus: event.currentTarget });
});
loadMoreEl?.addEventListener('click', async () => {
  const previousCount = currentRows.length;
  const loaded = await loadPrayers({ append: true });
  if (!loaded) return;
  window.requestAnimationFrame(() => {
    const nextRow = listEl?.querySelector(`[data-prayer-index="${previousCount}"]`);
    if (nextRow instanceof HTMLElement) nextRow.focus();
  });
});
listEl?.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-prayer-action]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const id = button.getAttribute('data-prayer-id') || '';
  const decision = button.getAttribute('data-prayer-action') || '';
  const row = currentRows.find((item) => item.id === id);
  if (row) openReviewModal(row, decision, button);
});
reviewFormEl?.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitReview();
});
reviewCloseEl?.addEventListener('click', () => requestCloseReviewModal());
reviewCancelEl?.addEventListener('click', () => requestCloseReviewModal({ allowDiscard: true }));
reviewModalEl?.querySelector('[data-prayer-review-backdrop]')?.addEventListener('click', () => {
  setReviewFeedback('La revisión sigue abierta para proteger tu decisión. Usa “Cancelar” o el botón de cerrar.');
  if (hasReviewDraft()) reviewNoteEl?.focus();
  else reviewCloseEl?.focus();
});
reviewNoteEl?.addEventListener('input', () => {
  reviewDiscardArmed = false;
  if (reviewCancelEl) reviewCancelEl.textContent = 'Cancelar';
  setReviewFeedback('');
});
document.addEventListener('keydown', handleReviewModalKeydown);
window.addEventListener('beforeunload', (event) => {
  if (!hasReviewDraft()) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('DOMContentLoaded', init);
