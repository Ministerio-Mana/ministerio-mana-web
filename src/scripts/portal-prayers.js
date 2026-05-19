import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const loadingEl = document.getElementById('prayers-loading');
const emptyEl = document.getElementById('prayers-empty');
const listEl = document.getElementById('prayers-list');
const statusEl = document.getElementById('prayers-status');
const visibilityEl = document.getElementById('prayers-visibility');
const refreshEl = document.getElementById('prayers-refresh');
const statTotalEl = document.getElementById('prayers-stat-total');
const statPrivateEl = document.getElementById('prayers-stat-private');
const statReviewEl = document.getElementById('prayers-stat-review');
const roleNoteEl = document.getElementById('prayers-role-note');

let authHeaders = {};
let canReview = false;
let currentRows = [];

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

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function locationLabel(row) {
  return [row.city, row.country].filter(Boolean).join(', ') || 'Sin ubicación';
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
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
}

function updateStats(rows) {
  const privateRows = rows.filter((row) => row.visibility === 'private').length;
  const reviewRows = rows.filter((row) =>
    row.visibility === 'public' && ['pending', 'flagged'].includes(String(row.moderation_status || '')),
  ).length;

  if (statTotalEl) statTotalEl.textContent = String(rows.length);
  if (statPrivateEl) statPrivateEl.textContent = String(privateRows);
  if (statReviewEl) statReviewEl.textContent = String(reviewRows);
}

function actionButtons(row) {
  if (!canReview) {
    return '<p class="text-xs font-semibold text-slate-400">Lectura para intercesión.</p>';
  }

  const status = String(row.moderation_status || '');
  const visibility = String(row.visibility || '');
  if (visibility !== 'public' || !['pending', 'flagged'].includes(status)) {
    return '<p class="text-xs font-semibold text-slate-400">Sin acciones pendientes.</p>';
  }

  const id = escapeAttr(row.id);
  return `
    <div class="flex flex-wrap gap-2">
      <button type="button" data-prayer-action="approve" data-prayer-id="${id}" class="rounded-xl bg-brand-teal px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:brightness-105">Publicar</button>
      <button type="button" data-prayer-action="keep_private" data-prayer-id="${id}" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-[#293C74] hover:bg-slate-50">Pasar a privada</button>
      <button type="button" data-prayer-action="reject" data-prayer-id="${id}" class="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-700 hover:bg-red-100">Rechazar</button>
    </div>
  `;
}

function renderRows(rows) {
  currentRows = rows;
  updateStats(rows);
  if (loadingEl) loadingEl.classList.add('hidden');

  if (!rows.length) {
    if (listEl) {
      listEl.classList.add('hidden');
      listEl.innerHTML = '';
    }
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (!listEl) return;

  listEl.innerHTML = rows.map((row) => {
    const status = String(row.moderation_status || '');
    const visibility = String(row.visibility || 'private');
    return `
      <article class="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass(status, visibility)}">${escapeHtml(statusLabel(status))}</span>
              <span class="rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">${escapeHtml(visibilityLabel(visibility))}</span>
            </div>
            <div>
              <h3 class="font-display text-xl font-black text-[#293C74]">${escapeHtml(row.first_name || 'Alguien')}</h3>
              <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">${escapeHtml(locationLabel(row))} · ${escapeHtml(formatDate(row.created_at))}</p>
            </div>
            <p class="max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-700">${escapeHtml(row.request_text || '')}</p>
            ${row.admin_note ? `<p class="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">Nota: ${escapeHtml(row.admin_note)}</p>` : ''}
          </div>
          <div class="shrink-0 lg:min-w-64">${actionButtons(row)}</div>
        </div>
      </article>
    `;
  }).join('');

  listEl.classList.remove('hidden');
}

async function loadPrayers() {
  if (loadingEl) {
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'Cargando peticiones...';
  }
  if (emptyEl) emptyEl.classList.add('hidden');
  if (listEl) listEl.classList.add('hidden');

  const params = new URLSearchParams();
  params.set('status', statusEl?.value || 'all');
  params.set('visibility', visibilityEl?.value || 'all');

  const payload = await fetchJson(`/api/prayer/admin/list?${params.toString()}`);
  canReview = Boolean(payload.permissions?.canReview);
  if (roleNoteEl) {
    roleNoteEl.textContent = canReview
      ? 'Puedes revisar y autorizar peticiones públicas.'
      : 'Puedes leer las peticiones recibidas para interceder.';
  }
  renderRows(Array.isArray(payload.rows) ? payload.rows : []);
}

async function reviewPrayer(id, decision) {
  const row = currentRows.find((item) => item.id === id);
  if (!row) return;

  const adminNote = decision === 'reject'
    ? window.prompt('Motivo interno del rechazo (opcional):') || ''
    : '';

  await fetchJson('/api/prayer/admin/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, decision, adminNote }),
  });
  await loadPrayers();
}

async function init() {
  try {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

    const session = await fetchJson('/api/portal/session');
    const role = String(session?.profile?.effective_role || session?.profile?.role || '');
    if (!['superadmin', 'admin', 'intercessor'].includes(role)) {
      window.location.href = '/portal';
      return;
    }

    await loadPrayers();
  } catch (error) {
    if (loadingEl) loadingEl.textContent = error?.message || 'No se pudieron cargar peticiones.';
  }
}

statusEl?.addEventListener('change', loadPrayers);
visibilityEl?.addEventListener('change', loadPrayers);
refreshEl?.addEventListener('click', loadPrayers);
listEl?.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-prayer-action]') : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const id = button.getAttribute('data-prayer-id') || '';
  const decision = button.getAttribute('data-prayer-action') || '';
  if (!id || !decision) return;
  button.disabled = true;
  try {
    await reviewPrayer(id, decision);
  } catch (error) {
    window.alert(error?.message || 'No se pudo actualizar la petición.');
    button.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', init);
