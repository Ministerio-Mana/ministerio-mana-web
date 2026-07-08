import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const loadingEl = document.getElementById('donations-loading');
const emptyEl = document.getElementById('donations-empty');
const tableEl = document.getElementById('donations-table');
const tbody = tableEl?.querySelector('tbody');
const statusEl = document.getElementById('donations-status');
const domainEl = document.getElementById('donations-domain');
const statCountEl = document.getElementById('donations-stat-count');
const statCopEl = document.getElementById('donations-stat-cop');
const statUsdEl = document.getElementById('donations-stat-usd');
let currentAuthHeaders = {};

const REQUEST_TIMEOUT_MS = 15000;

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

function showLoadError(error) {
    if (!loadingEl) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'Error al cargar donaciones.';
    loadingEl.className = 'py-12 text-center';
    loadingEl.innerHTML = `
        <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-red-700">
            <p class="font-bold mb-2">Error al cargar donaciones</p>
            <p class="text-sm">${escapeHtml(message)}</p>
            <button type="button" id="btn-retry-donations" class="mt-4 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm border border-red-100">
                Reintentar
            </button>
        </div>
    `;
    document.getElementById('btn-retry-donations')?.addEventListener('click', () => {
        void loadDonations();
    });
}

function formatCurrency(amount, currency) {
    return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-CO', {
        style: 'currency',
        currency: currency || 'COP',
        maximumFractionDigits: 0,
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
            : 'bg-green-100 text-green-700';
    return `<span class="px-2 py-1 rounded-full text-[10px] font-bold ${color}">${label}</span>`;
}

async function loadDonations() {
    if (loadingEl) {
        loadingEl.classList.remove('hidden');
        loadingEl.className = 'py-12 text-center text-slate-400 animate-pulse';
        loadingEl.textContent = 'Cargando donaciones...';
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (tableEl) tableEl.classList.add('hidden');

    try {
        const auth = await ensureAuthenticated();
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }

        const params = new URLSearchParams();
        params.set('status', statusEl?.value || 'all');
        if (domainEl?.value) params.set('domain', domainEl.value);

        const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
        currentAuthHeaders = headers;
        const { response, data } = await fetchJsonWithTimeout(`/api/portal/donations?${params.toString()}`, {
            headers,
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La carga de donaciones');

        if (response.status === 403) {
            window.location.href = '/portal';
            return;
        }

        if (!response.ok || !data.ok) {
            throw new Error(data.error || 'No se pudieron cargar las donaciones');
        }

        renderDonations(data.donations || [], data.stats || {});
    } catch (error) {
        console.error('[portal-donations] error', error);
        showLoadError(error);
    }
}

function renderDonations(donations, stats) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (statCountEl) statCountEl.textContent = stats.totalRows || donations.length || 0;
    if (statCopEl) statCopEl.textContent = formatCurrency(stats.totalsByCurrency?.COP || 0, 'COP');
    if (statUsdEl) statUsdEl.textContent = formatCurrency(stats.totalsByCurrency?.USD || 0, 'USD');

    if (!donations.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (tbody) {
        tbody.innerHTML = donations.map((donation) => {
            const contact = [donation.donor_email, donation.donor_phone].filter(Boolean).join(' · ');
            const recurring = donation.is_recurring ? '<span class="ml-2 text-[10px] font-bold text-brand-teal">RECURRENTE</span>' : '';
            const reference = donation.reference
                ? `<p class="text-[11px] text-slate-400 mt-1">Ref: ${escapeHtml(donation.reference)}</p>`
                : '';
            const canSyncWompi = String(donation.provider || '').toLowerCase() === 'wompi'
                && String(donation.status || '').toUpperCase() === 'PENDING'
                && donation.reference;
            const syncAction = canSyncWompi
                ? `<button class="mt-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100" data-sync-wompi="${escapeHtml(donation.reference)}">Sincronizar Wompi</button>`
                : '';

            return `
                <tr>
                    <td class="py-3 pl-2 align-top">${formatDate(donation.created_at)}</td>
                    <td class="py-3 align-top">
                        <p class="font-semibold text-[#293C74]">${escapeHtml(donation.concept_label || 'Otros')}${recurring}</p>
                        <p class="text-[11px] text-slate-400 uppercase">${escapeHtml(donation.provider || '')}</p>
                    </td>
                    <td class="py-3 align-top">
                        <p class="font-medium text-slate-700">${escapeHtml(donation.destination || '-')}</p>
                        ${reference}
                    </td>
                    <td class="py-3 align-top">${escapeHtml(donation.donor_name || 'Anónimo')}</td>
                    <td class="py-3 align-top text-slate-500">${escapeHtml(contact || '-')}</td>
                    <td class="py-3 align-top">${statusBadge(donation.status)}${syncAction}</td>
                    <td class="py-3 align-top text-right font-bold pr-2">${formatCurrency(donation.amount, donation.currency)}</td>
                </tr>
            `;
        }).join('');
        bindSyncButtons();
    }

    if (tableEl) tableEl.classList.remove('hidden');
}

function bindSyncButtons() {
    document.querySelectorAll('[data-sync-wompi]').forEach((button) => {
        button.addEventListener('click', async () => {
            const reference = button.getAttribute('data-sync-wompi');
            if (!reference) return;

            button.textContent = 'Sincronizando...';
            button.setAttribute('disabled', 'disabled');
            try {
                let { response, data: payload } = await fetchJsonWithTimeout('/api/portal/donations/sync-wompi', {
                    method: 'POST',
                    headers: {
                        ...currentAuthHeaders,
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({ reference }),
                }, REQUEST_TIMEOUT_MS, 'La sincronización con Wompi');
                if (!response.ok && payload?.code === 'TRANSACTION_ID_REQUIRED') {
                    const transactionId = window.prompt('Pega el ID de transacción de Wompi para esta referencia.');
                    if (!transactionId) throw new Error(payload.error || 'ID de transacción requerido');
                    ({ response, data: payload } = await fetchJsonWithTimeout('/api/portal/donations/sync-wompi', {
                        method: 'POST',
                        headers: {
                            ...currentAuthHeaders,
                            'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                        body: JSON.stringify({ reference, transactionId }),
                    }, REQUEST_TIMEOUT_MS, 'La sincronización con Wompi'));
                }
                if (!response.ok && payload?.code === 'WOMPI_LOOKUP_FAILED' && payload?.manualAvailable) {
                    const transactionId = window.prompt('No pude consultar Wompi automáticamente. Si en Wompi está aprobada, pega nuevamente el ID de transacción para marcarla aprobada manualmente.');
                    if (!transactionId) throw new Error(payload.error || 'No se pudo consultar Wompi');
                    ({ response, data: payload } = await fetchJsonWithTimeout('/api/portal/donations/sync-wompi', {
                        method: 'POST',
                        headers: {
                            ...currentAuthHeaders,
                            'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                        body: JSON.stringify({ reference, transactionId, manualApprove: true }),
                    }, REQUEST_TIMEOUT_MS, 'La sincronización con Wompi'));
                }
                if (!response.ok || !payload.ok) {
                    throw new Error(payload.error || 'No se pudo sincronizar');
                }
                await loadDonations();
            } catch (error) {
                console.error('[portal-donations] sync error', error);
                button.textContent = 'Error al sincronizar';
                setTimeout(() => {
                    button.textContent = 'Sincronizar Wompi';
                    button.removeAttribute('disabled');
                }, 2000);
            }
        });
    });
}

statusEl?.addEventListener('change', loadDonations);
domainEl?.addEventListener('change', loadDonations);

document.addEventListener('DOMContentLoaded', loadDonations);
