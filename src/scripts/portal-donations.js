import {
    ensureAuthenticated,
    getPortalSession,
    redirectToLogin,
    refreshPortalAuthentication,
} from '@lib/portalAuthClient';

const gateEl = document.getElementById('donations-gate');
const secureContentEl = document.getElementById('donations-secure-content');
const loadingEl = document.getElementById('donations-loading');
const emptyEl = document.getElementById('donations-empty');
const tableEl = document.getElementById('donations-table');
const tbody = tableEl?.querySelector('tbody');
const statusEl = document.getElementById('donations-status');
const domainEl = document.getElementById('donations-domain');
const pageSizeEl = document.getElementById('donations-page-size');
const pageInfoEl = document.getElementById('donations-page-info');
const loadMoreBtn = document.getElementById('donations-load-more');
const statCountEl = document.getElementById('donations-stat-count');
const statCopEl = document.getElementById('donations-stat-cop');
const statUsdEl = document.getElementById('donations-stat-usd');
const scopeLabelEl = document.getElementById('donations-scope-label');
const pageFeedbackEl = document.getElementById('donations-feedback');
const syncModal = document.getElementById('donations-sync-modal');
const syncForm = document.getElementById('donations-sync-form');
const syncCloseBtn = document.getElementById('donations-sync-close');
const syncCancelBtn = document.getElementById('donations-sync-cancel');
const syncSubmitBtn = document.getElementById('donations-sync-submit');
const syncManualSubmitBtn = document.getElementById('donations-sync-manual-submit');
const syncReferenceEl = document.getElementById('donations-sync-reference');
const syncTransactionEl = document.getElementById('donations-sync-transaction');
const syncFeedbackEl = document.getElementById('donations-sync-feedback');
const syncManualEl = document.getElementById('donations-sync-manual');
const syncManualConfirmEl = document.getElementById('donations-sync-manual-confirm');
let currentAuthHeaders = {};
let paginationState = {
    page: 1,
    pageSize: 10,
    totalRows: 0,
    totalPages: 0,
    visibleFrom: 0,
    visibleTo: 0,
    hasNextPage: false,
};
let loadedPageTotalsByCurrency = {};
let financeSessionChecked = false;
let canManageDonations = false;
let dataRevision = 0;
let appendSequence = 0;
let pageFeedbackTimer = null;
let syncInFlight = false;
let syncState = {
    reference: '',
    trigger: null,
};

const REQUEST_TIMEOUT_MS = 15000;

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

function makeTimeoutError(label) {
    const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
    error.name = 'TimeoutError';
    return error;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        const data = await response.json().catch(() => ({
            ok: false,
            error: 'El servidor respondió sin datos válidos.',
        }));
        return { response, data };
    } catch (error) {
        if (error?.name === 'AbortError') throw makeTimeoutError(label);
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function fetchAuthorizedJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const withAuth = () => ({
        ...options,
        headers: { ...(options.headers || {}), ...currentAuthHeaders },
        credentials: 'include',
    });
    let result = await fetchJsonWithTimeout(url, withAuth(), timeoutMs, label);
    if (result.response.status !== 401) return result;

    const refreshedAuth = await refreshPortalAuthentication();
    if (!refreshedAuth.isAuthenticated) {
        redirectToLogin();
        throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    }

    const session = await getPortalSession({ auth: refreshedAuth, force: true, cacheMs: 0 });
    if (!session.ok) {
        if (session.response?.status === 401 || session.response?.status === 403) redirectToLogin();
        throw new Error(session.data?.error || 'No se pudo renovar la sesión del portal.');
    }

    currentAuthHeaders = session.headers;
    result = await fetchJsonWithTimeout(url, withAuth(), timeoutMs, label);
    return result;
}

function showLoadError(error) {
    if (!loadingEl) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'Error al cargar donaciones.';
    loadingEl.className = 'py-12 text-center';
    loadingEl.innerHTML = `
        <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-red-700">
            <p class="font-bold mb-2">Error al cargar donaciones</p>
            <p class="text-sm">${escapeHtml(message)}</p>
            <button type="button" id="btn-retry-donations" class="mt-4 min-h-11 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm border border-red-100">
                Reintentar
            </button>
        </div>
    `;
    document.getElementById('btn-retry-donations')?.addEventListener('click', () => {
        void loadDonations({ append: false });
    });
}

function formatCurrency(amount, currency) {
    const normalizedCurrency = String(currency || 'COP').toUpperCase();
    const fractionDigits = normalizedCurrency === 'USD' ? 2 : 0;
    return new Intl.NumberFormat(normalizedCurrency === 'USD' ? 'en-US' : 'es-CO', {
        style: 'currency',
        currency: normalizedCurrency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(Number(amount || 0));
}

function formatDate(value) {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function statusBadge(status) {
    const normalized = String(status || '').toUpperCase();
    const label = normalized === 'PAID' || normalized === 'APPROVED'
        ? 'APROBADA'
        : normalized === 'FAILED'
            ? 'FALLIDA'
            : normalized === 'PENDING'
                ? 'PENDIENTE'
                : normalized || 'SIN ESTADO';
    const color = normalized === 'FAILED'
        ? 'bg-red-100 text-red-700'
        : normalized === 'PENDING'
            ? 'bg-amber-100 text-amber-700'
            : normalized === 'PAID' || normalized === 'APPROVED'
                ? 'bg-green-100 text-green-700'
                : 'bg-slate-100 text-slate-700';
    return `<span class="portal-chip ${color}">${label}</span>`;
}

function setPageFeedback(message = '', tone = 'success') {
    if (!pageFeedbackEl) return;
    if (pageFeedbackTimer) window.clearTimeout(pageFeedbackTimer);
    pageFeedbackEl.textContent = message;
    pageFeedbackEl.className = message
        ? `rounded-xl border px-4 py-4 text-sm font-semibold ${tone === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`
        : 'hidden rounded-xl border px-4 py-4 text-sm font-semibold';
    if (message) {
        pageFeedbackTimer = window.setTimeout(() => setPageFeedback(''), 8000);
    }
}

function resetLoadedTotals() {
    loadedPageTotalsByCurrency = {};
}

function scopeLabel(scope = {}) {
    if (scope.is_global) return 'Alcance global';
    const countries = Array.isArray(scope.country_keys) ? scope.country_keys : [];
    const regions = Array.isArray(scope.region_ids) ? scope.region_ids : [];
    const churches = Array.isArray(scope.church_ids) ? scope.church_ids : [];
    if (countries.length) {
        const names = countries.map((value) => String(value).replace(/-/g, ' ')).join(', ');
        return `Alcance nacional · ${names}`;
    }
    if (regions.length) return `Alcance regional · ${regions.length} ${regions.length === 1 ? 'región' : 'regiones'}`;
    if (churches.length) return `Alcance local · ${churches.length} ${churches.length === 1 ? 'iglesia' : 'iglesias'}`;
    return 'Sin alcance financiero';
}

function accumulateLoadedTotals(totals = {}) {
    Object.entries(totals || {}).forEach(([currency, amount]) => {
        const key = String(currency || 'COP').toUpperCase();
        loadedPageTotalsByCurrency[key] = (loadedPageTotalsByCurrency[key] || 0) + Number(amount || 0);
    });
}

function setLoadMoreState(isLoading = false) {
    if (!loadMoreBtn) return;
    loadMoreBtn.classList.toggle('hidden', !paginationState.hasNextPage);
    loadMoreBtn.disabled = isLoading;
    loadMoreBtn.textContent = isLoading ? 'Cargando...' : 'Cargar más';
}

function updatePageInfo() {
    if (!pageInfoEl) return;
    if (!paginationState.totalRows) {
        pageInfoEl.textContent = 'Sin registros para este filtro';
        return;
    }
    pageInfoEl.textContent = `Mostrando ${paginationState.visibleFrom}-${paginationState.visibleTo} de ${paginationState.totalRows}`;
}

async function ensureFinanceAccess() {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
        redirectToLogin();
        return false;
    }

    currentAuthHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

    if (financeSessionChecked) {
        return true;
    }

    const { ok, data } = await getPortalSession({ auth });
    if (!ok || !data?.ok) {
        throw new Error(data?.error || 'No se pudo validar la sesión.');
    }

    if (!data.permissions?.can_access_finances) {
        window.location.replace('/portal');
        return false;
    }

    canManageDonations = Boolean(data.permissions?.can_access_finances) && data.mode !== 'password';

    financeSessionChecked = true;
    showSecureContent();
    return true;
}

async function loadDonations({ append = false, restoreFocus = null } = {}) {
    const pageSize = Number(pageSizeEl?.value || paginationState.pageSize || 10);
    const page = append ? paginationState.page + 1 : 1;
    const requestRevision = append ? dataRevision : ++dataRevision;
    const requestAppendSequence = append ? ++appendSequence : ++appendSequence;

    if (!append) {
        resetLoadedTotals();
        paginationState = {
            page: 1,
            pageSize,
            totalRows: 0,
            totalPages: 0,
            visibleFrom: 0,
            visibleTo: 0,
            hasNextPage: false,
        };
        if (loadingEl) {
            loadingEl.classList.remove('hidden');
            loadingEl.className = 'py-12 text-center text-slate-400 animate-pulse';
            loadingEl.textContent = 'Cargando donaciones...';
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        if (tableEl) tableEl.classList.add('hidden');
        if (tbody) tbody.innerHTML = '';
        setLoadMoreState(false);
        updatePageInfo();
    } else {
        setLoadMoreState(true);
    }

    try {
        if (!await ensureFinanceAccess()) return;

        const params = new URLSearchParams();
        params.set('status', statusEl?.value || 'all');
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (domainEl?.value) params.set('domain', domainEl.value);

        const { response, data } = await fetchAuthorizedJsonWithTimeout(
            `/api/portal/donations?${params.toString()}`,
            {},
            REQUEST_TIMEOUT_MS,
            'La carga de donaciones',
        );

        if (response.status === 403) {
            window.location.href = '/portal';
            return;
        }

        if (!response.ok || !data.ok) {
            throw new Error(data.error || 'No se pudieron cargar las donaciones');
        }

        if (requestRevision !== dataRevision || requestAppendSequence !== appendSequence) return;

        if (scopeLabelEl) scopeLabelEl.textContent = scopeLabel(data.financeScope);
        renderDonations(data.donations || [], data.stats || {}, data.pagination || {}, { append });
    } catch (error) {
        if (requestRevision !== dataRevision || requestAppendSequence !== appendSequence) return;
        console.error('[portal-donations] error', error);
        if (append) {
            setLoadMoreState(false);
            if (loadMoreBtn) loadMoreBtn.textContent = 'Reintentar carga';
            setPageFeedback(error?.message || 'No se pudo cargar la siguiente página.', 'error');
        } else {
            if (financeSessionChecked) {
                showSecureContent();
                showLoadError(error);
            } else {
                showGate(error?.message || 'No se pudieron validar permisos.');
            }
        }
    } finally {
        if (requestRevision === dataRevision && requestAppendSequence === appendSequence && restoreFocus?.isConnected) {
            window.requestAnimationFrame(() => restoreFocus.focus());
        }
    }
}

function donationRowsHtml(donations) {
    return donations.map((donation) => {
        const contact = [donation.donor_email, donation.donor_phone].filter(Boolean).join(' · ');
        const recurring = donation.is_recurring ? '<span class="portal-chip ml-2 bg-teal-50 text-teal-800">Recurrente</span>' : '';
        const provider = String(donation.provider || '').toUpperCase();
        const currency = String(donation.currency || 'COP').toUpperCase();
        const expectedCurrency = provider === 'WOMPI' ? 'COP' : provider === 'STRIPE' ? 'USD' : null;
        const currencyMismatch = expectedCurrency && currency !== expectedCurrency
            ? '<span class="portal-chip mt-2 bg-red-100 text-red-700">Revisar moneda</span>'
            : '';
        const reference = donation.reference
            ? `<p class="mt-2 text-xs text-slate-400">Ref: ${escapeHtml(donation.reference)}</p>`
            : '';
        const canSyncWompi = canManageDonations
            && String(donation.provider || '').toLowerCase() === 'wompi'
            && String(donation.status || '').toUpperCase() === 'PENDING'
            && donation.reference;
        const syncAction = canSyncWompi
            ? `<button type="button" class="mt-2 min-h-11 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100" data-sync-wompi="${escapeHtml(donation.reference)}" aria-label="Conciliar en Wompi la referencia ${escapeHtml(donation.reference)}">Sincronizar Wompi</button>`
            : '';

        return `
            <tr>
                <td data-label="Fecha" class="py-4 pl-2 align-top">${formatDate(donation.created_at)}</td>
                <td data-label="Concepto" class="py-4 align-top">
                    <p class="font-semibold text-[#293C74]">${escapeHtml(donation.concept_label || 'Otros')}${recurring}</p>
                    <p class="text-xs text-slate-400 uppercase">${escapeHtml(provider || 'SIN PROVEEDOR')} · ${escapeHtml(currency)}</p>
                    ${currencyMismatch}
                </td>
                <td data-label="Destino" class="py-4 align-top">
                    <p class="font-medium text-slate-700">${escapeHtml(donation.destination || '-')}</p>
                    ${reference}
                </td>
                <td data-label="Donante" class="py-4 align-top">${escapeHtml(donation.donor_name || 'Anónimo')}</td>
                <td data-label="Contacto" class="py-4 align-top text-slate-500">${escapeHtml(contact || '-')}</td>
                <td data-label="Estado" class="py-4 align-top">${statusBadge(donation.status)}${syncAction}</td>
                <td data-label="Monto" class="py-4 align-top text-right font-bold pr-2">${formatCurrency(donation.amount, donation.currency)}</td>
            </tr>
        `;
    }).join('');
}

function renderDonations(donations, stats, pagination, { append = false } = {}) {
    if (loadingEl) loadingEl.classList.add('hidden');
    paginationState = {
        page: Number(pagination.page || (append ? paginationState.page + 1 : 1)),
        pageSize: Number(pagination.pageSize || pageSizeEl?.value || 10),
        totalRows: Number(pagination.totalRows || stats.totalRows || donations.length || 0),
        totalPages: Number(pagination.totalPages || 0),
        visibleFrom: append
            ? Number(paginationState.visibleFrom || pagination.visibleFrom || 0)
            : Number(pagination.visibleFrom || 0),
        visibleTo: Number(pagination.visibleTo || 0),
        hasNextPage: Boolean(pagination.hasNextPage),
    };
    accumulateLoadedTotals(stats.pageTotalsByCurrency || stats.totalsByCurrency || {});

    if (statCountEl) statCountEl.textContent = paginationState.totalRows;
    if (statCopEl) statCopEl.textContent = formatCurrency(loadedPageTotalsByCurrency.COP || 0, 'COP');
    if (statUsdEl) statUsdEl.textContent = formatCurrency(loadedPageTotalsByCurrency.USD || 0, 'USD');
    updatePageInfo();
    setLoadMoreState(false);

    if (!append && !donations.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (tbody) {
        const rows = donationRowsHtml(donations);
        if (append) {
            tbody.insertAdjacentHTML('beforeend', rows);
        } else {
            tbody.innerHTML = rows;
        }
        bindSyncButtons();
    }

    if (tableEl) tableEl.classList.remove('hidden');
}

function getSyncModalFocusableElements() {
    if (!syncModal) return [];
    return Array.from(syncModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'))
        .filter((element) => element.offsetParent !== null && !element.classList.contains('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

function setSyncFeedback(message = '', tone = 'neutral') {
    if (!syncFeedbackEl) return;
    syncFeedbackEl.textContent = message;
    syncFeedbackEl.className = `min-h-6 text-sm font-semibold ${tone === 'error'
        ? 'text-red-700'
        : tone === 'success'
            ? 'text-emerald-700'
            : 'text-slate-600'}`;
}

function resetManualApproval() {
    syncManualEl?.classList.add('hidden');
    syncManualSubmitBtn?.classList.add('hidden');
    if (syncManualConfirmEl) syncManualConfirmEl.checked = false;
    if (syncManualSubmitBtn) syncManualSubmitBtn.disabled = true;
}

function setSyncBusy(isBusy) {
    syncInFlight = isBusy;
    if (syncSubmitBtn) {
        syncSubmitBtn.disabled = isBusy;
        syncSubmitBtn.textContent = isBusy ? 'Consultando...' : 'Consultar estado';
    }
    if (syncManualSubmitBtn) syncManualSubmitBtn.disabled = isBusy || !syncManualConfirmEl?.checked;
    if (syncTransactionEl) syncTransactionEl.disabled = isBusy;
    if (syncCloseBtn) syncCloseBtn.disabled = isBusy;
    if (syncCancelBtn) syncCancelBtn.disabled = isBusy;
}

function openSyncModal(reference, trigger) {
    if (!syncModal || !reference) return;
    syncState = { reference, trigger };
    if (syncReferenceEl) syncReferenceEl.textContent = reference;
    if (syncTransactionEl) syncTransactionEl.value = '';
    resetManualApproval();
    setSyncFeedback('Primero intentaremos conciliar con el evento ya recibido. Solo escribe la “Transacción #” si el sistema la solicita.');
    syncModal.classList.remove('hidden');
    syncModal.classList.add('flex');
    syncModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    window.requestAnimationFrame(() => syncTransactionEl?.focus());
}

function syncModalHasInput() {
    return Boolean(syncTransactionEl?.value.trim());
}

function closeSyncModal({ restoreFocus = true, force = false } = {}) {
    if (!syncModal || (syncInFlight && !force)) return;
    syncModal.classList.add('hidden');
    syncModal.classList.remove('flex');
    syncModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overflow-hidden');
    const trigger = syncState.trigger;
    syncState = { reference: '', trigger: null };
    resetManualApproval();
    setSyncFeedback('');
    if (restoreFocus && trigger?.isConnected) window.requestAnimationFrame(() => trigger.focus());
}

function requestCloseSyncModal() {
    if (syncInFlight) return;
    if (syncModalHasInput() && !window.confirm('Hay un ID de transacción escrito. ¿Quieres descartarlo y cerrar?')) return;
    closeSyncModal();
}

function handleSyncModalKeydown(event) {
    if (!syncModal || syncModal.getAttribute('aria-hidden') === 'true') return;
    if (event.key === 'Escape') {
        event.preventDefault();
        if (syncModalHasInput()) {
            setSyncFeedback('El formulario se conservó. Usa Cancelar o el botón de cierre si quieres descartarlo.', 'error');
            syncCloseBtn?.focus();
            return;
        }
        closeSyncModal();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getSyncModalFocusableElements();
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

function revealManualApproval(message) {
    syncManualEl?.classList.remove('hidden');
    syncManualSubmitBtn?.classList.remove('hidden');
    setSyncFeedback(message, 'error');
    if (!syncTransactionEl?.value.trim()) syncTransactionEl?.focus();
    else syncManualConfirmEl?.focus();
}

async function reconcileWompi({ manualApprove = false } = {}) {
    if (syncInFlight || !syncState.reference) return;
    const transactionId = syncTransactionEl?.value.trim() || '';
    if (transactionId && transactionId === syncState.reference) {
        setSyncFeedback('Ese valor es la referencia del Portal. Copia desde Wompi el número que aparece como “Transacción #”, por ejemplo 1178211-1783194180-26798.', 'error');
        syncTransactionEl?.focus();
        syncTransactionEl?.select();
        return;
    }
    if (manualApprove && !transactionId) {
        setSyncFeedback('Escribe el ID de transacción antes de aprobar manualmente.', 'error');
        syncTransactionEl?.focus();
        return;
    }
    if (manualApprove && !syncManualConfirmEl?.checked) {
        setSyncFeedback('Confirma que verificaste el pago directamente en Wompi.', 'error');
        syncManualConfirmEl?.focus();
        return;
    }

    setSyncBusy(true);
    setSyncFeedback(manualApprove ? 'Registrando la verificación manual...' : 'Consultando el estado oficial en Wompi...');
    try {
        const { response, data: payload } = await fetchAuthorizedJsonWithTimeout('/api/portal/donations/sync-wompi', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                reference: syncState.reference,
                transactionId: transactionId || undefined,
                manualApprove,
            }),
        }, REQUEST_TIMEOUT_MS, 'La conciliación con Wompi');

        if (!response.ok || !payload?.ok) {
            if (payload?.code === 'TRANSACTION_ID_REQUIRED') {
                setSyncFeedback(payload.error || 'Escribe el ID de transacción de Wompi.', 'error');
                syncTransactionEl?.focus();
                return;
            }
            if (payload?.code === 'REFERENCE_IS_NOT_TRANSACTION_ID') {
                setSyncFeedback(payload.error || 'La referencia del Portal no es el ID de transacción de Wompi.', 'error');
                syncTransactionEl?.focus();
                syncTransactionEl?.select();
                return;
            }
            if (payload?.code === 'WOMPI_LOOKUP_FAILED' && payload?.manualAvailable) {
                revealManualApproval(payload.error || 'Wompi no respondió. Verifica el pago antes de una aprobación manual.');
                return;
            }
            throw new Error(payload?.error || 'No se pudo conciliar la donación.');
        }

        const reference = syncState.reference;
        closeSyncModal({ restoreFocus: false, force: true });
        setPageFeedback(`La referencia ${reference} quedó conciliada sin generar un cobro.`);
        await loadDonations({ append: false, restoreFocus: statusEl });
    } catch (error) {
        console.error('[portal-donations] sync error', error);
        setSyncFeedback(error?.message || 'No se pudo conciliar la donación.', 'error');
    } finally {
        setSyncBusy(false);
    }
}

function bindSyncButtons() {
    document.querySelectorAll('[data-sync-wompi]').forEach((button) => {
        if (button.dataset.syncBound === '1') return;
        button.dataset.syncBound = '1';
        button.addEventListener('click', () => {
            const reference = button.getAttribute('data-sync-wompi');
            if (reference) openSyncModal(reference, button);
        });
    });
}

function handleFilterChange(control) {
    setPageFeedback('');
    void loadDonations({ append: false, restoreFocus: control });
}

statusEl?.addEventListener('change', () => handleFilterChange(statusEl));
domainEl?.addEventListener('change', () => handleFilterChange(domainEl));
pageSizeEl?.addEventListener('change', () => handleFilterChange(pageSizeEl));
loadMoreBtn?.addEventListener('click', () => loadDonations({ append: true, restoreFocus: loadMoreBtn }));
syncForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void reconcileWompi();
});
syncManualSubmitBtn?.addEventListener('click', () => void reconcileWompi({ manualApprove: true }));
syncManualConfirmEl?.addEventListener('change', () => {
    if (syncManualSubmitBtn) syncManualSubmitBtn.disabled = syncInFlight || !syncManualConfirmEl.checked;
});
syncCloseBtn?.addEventListener('click', requestCloseSyncModal);
syncCancelBtn?.addEventListener('click', requestCloseSyncModal);
syncModal?.addEventListener('keydown', handleSyncModalKeydown);
syncModal?.addEventListener('click', (event) => {
    if (event.target === syncModal) {
        setSyncFeedback('La conciliación sigue abierta para evitar un cierre accidental. Usa Cancelar para salir.');
    }
});

window.addEventListener('beforeunload', (event) => {
    if (syncModal?.getAttribute('aria-hidden') === 'false' && syncModalHasInput()) {
        event.preventDefault();
        event.returnValue = '';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    showGate();
    loadDonations({ append: false });
});
