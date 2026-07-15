import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const gateEl = document.getElementById('campus-gate');
const secureContentEl = document.getElementById('campus-secure-content');
const loadingEl = document.getElementById('donors-loading');
const contentEl = document.getElementById('donors-content');
const emptyEl = document.getElementById('donors-empty');
const subtitleEl = document.getElementById('campus-subtitle');
const donorStatsEl = document.getElementById('donor-stats');
const searchEl = document.getElementById('donor-search');
const missionaryFilterContainerEl = document.getElementById('donor-missionary-filter-container');
const missionaryFilterEl = document.getElementById('donor-missionary-filter');
const resultCountEl = document.getElementById('donors-result-count');
const loadMoreEl = document.getElementById('donors-load-more');
const scopeLabelEl = document.getElementById('campus-scope-label');
const coverageNoteEl = document.getElementById('campus-coverage-note');
const reportActionsEl = document.getElementById('campus-report-actions');
const exportGeneralEl = document.getElementById('campus-export-general');
const exportMissionaryEl = document.getElementById('campus-export-missionary');
const exportFeedbackEl = document.getElementById('campus-export-feedback');
const filterButtons = Array.from(document.querySelectorAll('[data-donor-filter]'));
const adminStatEls = Array.from(document.querySelectorAll('.admin-campus-stat'));

const statTotalDonors = document.getElementById('stat-total-donors');
const statRecurringDonors = document.getElementById('stat-recurring-donors');
const statOneTimeDonors = document.getElementById('stat-one-time-donors');
const statCampusCop = document.getElementById('stat-campus-cop');
const statCampusUsd = document.getElementById('stat-campus-usd');
const statActiveMissionaries = document.getElementById('stat-active-missionaries');
const filterCountAll = document.getElementById('filter-count-all');
const filterCountRecurring = document.getElementById('filter-count-recurring');
const filterCountOneTime = document.getElementById('filter-count-one-time');

const REQUEST_TIMEOUT_MS = 15000;
const DONORS_PAGE_SIZE = 20;

let campusSessionChecked = false;
let allDonors = [];
let currentFilter = 'all';
let currentMissionarySlug = 'all';
let visibleDonorLimit = DONORS_PAGE_SIZE;
let isAdminView = false;
let loadRevision = 0;
let currentAuthHeaders = {};
let exportInFlight = false;

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

function normalizeSearch(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function scopeLabel(scope = {}, isMissionary = false) {
    if (isMissionary) return 'Alcance personal · solo tus donantes';
    if (scope.is_global) return 'Alcance financiero global';
    const countries = Array.isArray(scope.country_keys) ? scope.country_keys : [];
    const regions = Array.isArray(scope.region_ids) ? scope.region_ids : [];
    const churches = Array.isArray(scope.church_ids) ? scope.church_ids : [];
    if (countries.length) {
        const names = countries.map((value) => String(value).replace(/-/g, ' ')).join(', ');
        return `Alcance financiero nacional · ${names}`;
    }
    if (regions.length) return `Alcance financiero regional · ${regions.length} ${regions.length === 1 ? 'región' : 'regiones'}`;
    if (churches.length) return `Alcance financiero local · ${churches.length} ${churches.length === 1 ? 'iglesia' : 'iglesias'}`;
    return 'Sin alcance financiero';
}

function formatCurrency(amount, currency) {
    const normalizedCurrency = String(currency || 'COP').toUpperCase();
    const fractionDigits = normalizedCurrency === 'USD' ? 2 : 0;
    if (!amount && amount !== 0) return formatCurrency(0, normalizedCurrency);
    return new Intl.NumberFormat(normalizedCurrency === 'USD' ? 'en-US' : 'es-CO', {
        style: 'currency',
        currency: normalizedCurrency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(amount);
}

function formatTotals(totalsByCurrency, className = '') {
    const entries = Object.entries(totalsByCurrency || {})
        .filter(([, amount]) => Number.isFinite(Number(amount)));
    if (!entries.length) return '—';
    return entries
        .sort(([currencyA], [currencyB]) => {
            const order = { COP: 0, USD: 1 };
            return (order[currencyA] ?? 2) - (order[currencyB] ?? 2) || currencyA.localeCompare(currencyB);
        })
        .map(([currency, amount]) => `<p class="${className}">${formatCurrency(Number(amount), currency)}</p>`)
        .join('');
}

function formatDate(value) {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function makeTimeoutError(label) {
    const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
    error.name = 'TimeoutError';
    return error;
}

async function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = window.setTimeout(() => reject(makeTimeoutError(label)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
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

function showLoading() {
    loadingEl?.classList.remove('hidden');
    if (loadingEl) {
        loadingEl.className = 'py-12 text-center text-slate-400 animate-pulse';
        loadingEl.textContent = 'Cargando donantes...';
    }
    contentEl?.classList.add('hidden');
    emptyEl?.classList.add('hidden');
    resultCountEl?.classList.add('hidden');
    loadMoreEl?.classList.add('hidden');
    contentEl?.setAttribute('aria-busy', 'true');
}

function showLoadError(error) {
    if (!loadingEl) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'No se pudieron cargar los donantes.';
    loadingEl.className = 'py-12 text-center';
    loadingEl.innerHTML = `
        <div class="mx-auto max-w-md rounded-lg border border-red-100 bg-red-50 px-4 py-4 text-red-700">
            <p class="mb-2 font-bold">Error al cargar donantes</p>
            <p class="text-sm">${escapeHtml(message)}</p>
            <button type="button" id="btn-retry-donors" class="mt-4 min-h-11 rounded-lg border border-red-100 bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm">
                Reintentar
            </button>
        </div>
    `;
    document.getElementById('btn-retry-donors')?.addEventListener('click', () => void loadDonors());
}

function updateFilterState() {
    filterButtons.forEach((button) => {
        const active = button.dataset.donorFilter === currentFilter;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('bg-white', active);
        button.classList.toggle('text-[#293C74]', active);
        button.classList.toggle('shadow-sm', active);
        button.classList.toggle('text-slate-500', !active);
    });
}

function getDonorMissionarySlugs(donor) {
    const slugs = new Set();
    (donor?.donations || []).forEach((donation) => {
        (donation?.missionary?.slugs || []).forEach((slug) => {
            const normalized = String(slug || '').trim();
            if (normalized) slugs.add(normalized);
        });
    });
    return slugs;
}

function populateMissionaryFilter(donors, showFilter) {
    missionaryFilterContainerEl?.classList.toggle('hidden', !showFilter);
    if (!missionaryFilterEl || !showFilter) return;

    const missionaries = new Map();
    donors.forEach((donor) => {
        (donor?.donations || []).forEach((donation) => {
            const slugs = donation?.missionary?.slugs || [];
            const names = donation?.missionary?.names || [];
            slugs.forEach((slug, index) => {
                const normalizedSlug = String(slug || '').trim();
                if (!normalizedSlug) return;
                const name = String(names[index] || normalizedSlug).trim();
                missionaries.set(normalizedSlug, name || normalizedSlug);
            });
        });
    });

    missionaryFilterEl.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Todos los misioneros';
    missionaryFilterEl.appendChild(allOption);
    Array.from(missionaries.entries())
        .sort(([, left], [, right]) => left.localeCompare(right, 'es'))
        .forEach(([slug, name]) => {
            const option = document.createElement('option');
            option.value = slug;
            option.textContent = name;
            missionaryFilterEl.appendChild(option);
        });
    currentMissionarySlug = 'all';
    missionaryFilterEl.value = currentMissionarySlug;
    updateMissionaryExportButton();
}

function selectedMissionaryName() {
    if (!missionaryFilterEl || currentMissionarySlug === 'all') return '';
    return missionaryFilterEl.selectedOptions?.[0]?.textContent?.trim() || '';
}

function updateMissionaryExportButton() {
    if (!exportMissionaryEl) return;
    const missionaryName = selectedMissionaryName();
    exportMissionaryEl.disabled = exportInFlight || !missionaryName;
    exportMissionaryEl.textContent = missionaryName
        ? `Descargar informe de ${missionaryName}`
        : 'Informe por misionero';
}

function setExportFeedback(message = '', tone = 'info') {
    if (!exportFeedbackEl) return;
    if (!message) {
        exportFeedbackEl.textContent = '';
        exportFeedbackEl.classList.add('hidden');
        return;
    }
    const styles = tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-sky-200 bg-sky-50 text-sky-900';
    exportFeedbackEl.className = `rounded-xl border px-4 py-4 text-sm font-semibold ${styles}`;
    exportFeedbackEl.textContent = message;
}

function setExportBusy(isBusy) {
    exportInFlight = isBusy;
    if (exportGeneralEl) {
        exportGeneralEl.disabled = isBusy;
        exportGeneralEl.textContent = isBusy ? 'Preparando Excel…' : 'Descargar informe general';
    }
    updateMissionaryExportButton();
}

function fileNameFromDisposition(value, fallback) {
    const match = String(value || '').match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
    return match ? decodeURIComponent(match[1].replace(/\"/g, '').trim()) : fallback;
}

async function downloadCampusReport(missionarySlug = '') {
    if (exportInFlight || !isAdminView) return;
    setExportBusy(true);
    setExportFeedback(missionarySlug
        ? 'Preparando el informe del misionero seleccionado…'
        : 'Preparando el informe general de Campus…');
    try {
        const url = new URL('/api/portal/campus/export', window.location.origin);
        if (missionarySlug) url.searchParams.set('missionary', missionarySlug);
        const response = await fetch(url, {
            headers: currentAuthHeaders,
            credentials: 'include',
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || 'No se pudo generar el informe de Campus.');
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileNameFromDisposition(
            response.headers.get('content-disposition'),
            missionarySlug ? `campus-${missionarySlug}.xlsx` : 'campus-informe-general.xlsx',
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        setExportFeedback('Informe listo. Puedes abrirlo en Excel web, OneDrive o descargarlo en tu equipo.');
    } catch (error) {
        console.error('[campus] export error', error);
        setExportFeedback(error?.message || 'No se pudo generar el informe de Campus.', 'error');
    } finally {
        setExportBusy(false);
    }
}

function getFilteredDonors() {
    const query = normalizeSearch(searchEl?.value);
    return allDonors.filter((donor) => {
        if (currentFilter !== 'all' && donor.givingType !== currentFilter) return false;
        if (currentMissionarySlug !== 'all' && !getDonorMissionarySlugs(donor).has(currentMissionarySlug)) return false;
        if (!query) return true;
        const missionaryNames = (donor.donations || [])
            .flatMap((donation) => donation?.missionary?.names || [donation?.missionary?.name])
            .filter(Boolean);
        return normalizeSearch([
            donor.name,
            donor.email,
            donor.phone,
            donor.missionary?.name,
            ...missionaryNames,
        ].filter(Boolean).join(' ')).includes(query);
    });
}

function getEmptyMessage() {
    if (searchEl?.value?.trim()) return 'No hay donantes que coincidan con la búsqueda.';
    if (currentMissionarySlug !== 'all') return 'Este misionero todavía no tiene donantes en el filtro seleccionado.';
    if (currentFilter === 'recurring') return 'Todavía no hay donantes recurrentes en este alcance.';
    if (currentFilter === 'one_time') return 'Todavía no hay personas con donación única en este alcance.';
    return 'No se encontraron donantes todavía.';
}

function buildDonorCard(donor, donorIndex) {
    const isRecurring = donor.givingType === 'recurring';
    const donorNameRaw = donor.name || 'Donante Anónimo';
    const donorName = escapeHtml(donorNameRaw);
    const donorEmail = escapeHtml(donor.email || '');
    const donorPhone = escapeHtml(donor.phone || '');
    const donorInitial = escapeHtml(String(donorNameRaw).trim().charAt(0).toUpperCase() || '?');
    const lastDonationDate = formatDate(donor.lastDonation);
    const relationshipBadge = isRecurring
        ? '<span class="portal-chip border border-emerald-200 bg-emerald-50 text-emerald-800">Donante recurrente</span>'
        : '<span class="portal-chip border border-sky-200 bg-sky-50 text-sky-800">Donación única</span>';
    const thanksText = isRecurring
        ? `Hola ${donorNameRaw}, gracias por tu apoyo constante a Campus Maná. Tu compromiso mensual nos ayuda a sostener la misión en las universidades. Cuenta con nuestra gratitud y oraciones.`
        : `Hola ${donorNameRaw}, gracias por tu siembra a Campus Maná. Tu generosidad nos ayuda a compartir el evangelio en las universidades. Si deseas seguir caminando con esta misión, será una alegría contar nuevamente contigo.`;
    const thanksMessage = encodeURIComponent(thanksText);
    const subject = encodeURIComponent(isRecurring
        ? 'Gracias por tu apoyo constante a Campus Maná'
        : 'Gracias por apoyar Campus Maná');
    const phoneDigits = String(donor.phone || '').replace(/\D/g, '');
    const contactActions = [
        donor.email
            ? `<a class="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-[#293C74]/30 hover:text-[#293C74]" href="mailto:${encodeURIComponent(donor.email)}?subject=${subject}&body=${thanksMessage}">Correo</a>`
            : '',
        phoneDigits.length >= 8
            ? `<a class="inline-flex min-h-11 items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" href="https://wa.me/${phoneDigits}?text=${thanksMessage}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
            : '',
    ].filter(Boolean).join('');

    const donationLines = Array.isArray(donor.donations) && donor.donations.length
        ? `
            <details class="mt-4 border-t border-slate-100 pt-4">
                <summary class="flex min-h-11 cursor-pointer list-none items-center text-xs font-bold text-[#293C74] hover:text-[#20315f]">
                    Ver historial de ${donor.donations.length} aporte${donor.donations.length === 1 ? '' : 's'}
                </summary>
                <div class="space-y-2 pt-2">
                ${donor.donations.slice(0, 4).map((donation) => {
                    const recurringDonation = donation.frequency === 'recurring';
                    const provider = String(donation.provider || '').toUpperCase();
                    const currency = String(donation.currency || '').toUpperCase();
                    const expectedCurrency = provider === 'WOMPI' ? 'COP' : provider === 'STRIPE' ? 'USD' : null;
                    const typeBadge = recurringDonation
                        ? '<span class="portal-chip bg-emerald-100 text-emerald-800">Mensual</span>'
                        : '<span class="portal-chip bg-sky-100 text-sky-800">Una vez</span>';
                    const providerBadge = isAdminView && provider
                        ? `<span class="portal-chip bg-slate-100 text-slate-700">${escapeHtml(provider)} · ${escapeHtml(currency || 'SIN MONEDA')}</span>`
                        : '';
                    const currencyMismatch = isAdminView && expectedCurrency && currency !== expectedCurrency
                        ? '<span class="portal-chip bg-red-100 text-red-700">Revisar moneda</span>'
                        : '';
                    const date = donation.created_at ? formatDate(donation.created_at) : '';
                    const names = donation.missionary?.names?.length
                        ? donation.missionary.names.join(', ')
                        : donation.missionary?.name || 'Campus';
                    const amount = isAdminView && donation.amount !== null
                        ? `<span class="font-bold text-brand-teal">${formatCurrency(donation.amount, donation.currency)}</span>`
                        : '';
                    const perMissionary = isAdminView && donation.amountPerMissionary
                        ? `<span class="text-slate-400">(${formatCurrency(donation.amountPerMissionary, donation.currency)} por misionero)</span>`
                        : '';
                    return `
                        <div class="flex flex-col gap-2 border-b border-slate-200/70 pb-2 text-xs text-slate-500 last:border-0 last:pb-0 md:flex-row md:items-center md:justify-between">
                            <span class="flex flex-wrap items-center gap-2">
                                ${typeBadge}
                                ${providerBadge}
                                ${currencyMismatch}
                                <strong class="text-[#293C74]">${escapeHtml(names)}</strong>
                                ${date ? `<span>· ${escapeHtml(date)}</span>` : ''}
                            </span>
                            <span>${amount} ${perMissionary}</span>
                        </div>
                    `;
                }).join('')}
                ${donor.donations.length > 4
                    ? `<p class="pt-2 text-xs font-semibold text-slate-400">+${donor.donations.length - 4} donaciones anteriores</p>`
                    : ''}
                </div>
            </details>
        `
        : '';

    const amountDisplay = isAdminView && donor.totalsByCurrency
        ? `
            <div class="w-full border-t border-slate-100 pt-4 sm:w-auto sm:min-w-[160px] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 sm:text-right">
                <p class="mb-2 text-xs font-bold uppercase text-slate-400">Total donado</p>
                ${formatTotals(donor.totalsByCurrency, 'break-words text-lg font-bold text-brand-teal')}
            </div>
        `
        : '';

    return `
        <article class="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm" data-donor-index="${donorIndex}" tabindex="-1">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex min-w-0 flex-1 items-start gap-4">
                    <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#293C74] text-sm font-bold text-white">
                        ${donorInitial}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="mb-2 flex flex-wrap items-center gap-2">
                            <h3 class="text-base font-bold text-[#293C74]">${donorName}</h3>
                            ${relationshipBadge}
                        </div>
                        ${donor.email ? `<p class="mb-2 break-all text-sm text-slate-600">${donorEmail}</p>` : ''}
                        ${donor.phone ? `<p class="break-words text-sm text-slate-500">${donorPhone}</p>` : ''}

                        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
                            <span><strong>${donor.donationCount}</strong> donación${donor.donationCount > 1 ? 'es' : ''}</span>
                            ${donor.recurringDonationCount > 0 ? `<span><strong>${donor.recurringDonationCount}</strong> mensual${donor.recurringDonationCount > 1 ? 'es' : ''}</span>` : ''}
                            ${donor.oneTimeDonationCount > 0 ? `<span><strong>${donor.oneTimeDonationCount}</strong> de una vez</span>` : ''}
                            <span>Última: <strong>${lastDonationDate}</strong></span>
                        </div>

                        ${donor.missionary?.name ? `
                            <div class="mt-4">
                                <span class="portal-chip bg-[#293C74]/10 text-[#293C74]">
                                    ${escapeHtml(donor.missionary.name)}
                                </span>
                            </div>
                        ` : ''}
                        ${contactActions ? `<div class="mt-4 flex flex-wrap gap-2">${contactActions}</div>` : ''}
                        ${donationLines}
                    </div>
                </div>
                ${amountDisplay}
            </div>
        </article>
    `;
}

function renderDonors() {
    updateFilterState();
    const filteredDonors = getFilteredDonors();
    const visibleDonors = filteredDonors.slice(0, visibleDonorLimit);

    loadingEl?.classList.add('hidden');
    contentEl?.setAttribute('aria-busy', 'false');
    if (!filteredDonors.length) {
        contentEl?.classList.add('hidden');
        loadMoreEl?.classList.add('hidden');
        resultCountEl?.classList.add('hidden');
        if (emptyEl) {
            emptyEl.textContent = getEmptyMessage();
            emptyEl.classList.remove('hidden');
        }
        return;
    }

    emptyEl?.classList.add('hidden');
    if (contentEl) {
        contentEl.innerHTML = visibleDonors.map((donor, index) => buildDonorCard(donor, index)).join('');
        contentEl.classList.remove('hidden');
        contentEl.setAttribute('aria-busy', 'false');
    }
    if (resultCountEl) {
        resultCountEl.textContent = `Mostrando ${visibleDonors.length} de ${filteredDonors.length} donantes`;
        resultCountEl.classList.remove('hidden');
    }
    loadMoreEl?.classList.toggle('hidden', visibleDonors.length >= filteredDonors.length);
}

function updateCoverage(coverage = {}, isMissionary = false) {
    if (!coverageNoteEl) return;
    const loaded = Number(coverage.loadedDonationRows || 0);
    const total = Number(coverage.totalDonationRows || 0);
    const isTruncated = coverage.isTruncated === true;
    if (!isTruncated) {
        coverageNoteEl.textContent = '';
        coverageNoteEl.classList.add('hidden');
        return;
    }
    coverageNoteEl.textContent = isMissionary || !total
        ? `Se muestran los ${loaded} aportes aprobados más recientes. Usa Finanzas para el histórico contable completo.`
        : `Se muestran ${loaded} de ${total} aportes aprobados de este alcance. Usa Finanzas para el histórico contable completo.`;
    coverageNoteEl.classList.remove('hidden');
}

function updateStats(stats, isAdmin) {
    donorStatsEl?.classList.remove('hidden');
    if (statTotalDonors) statTotalDonors.textContent = String(stats?.totalDonors || 0);
    if (statRecurringDonors) statRecurringDonors.textContent = String(stats?.recurringDonors || 0);
    if (statOneTimeDonors) statOneTimeDonors.textContent = String(stats?.oneTimeDonors || 0);
    if (filterCountAll) filterCountAll.textContent = String(stats?.totalDonors || 0);
    if (filterCountRecurring) filterCountRecurring.textContent = String(stats?.recurringDonors || 0);
    if (filterCountOneTime) filterCountOneTime.textContent = String(stats?.oneTimeDonors || 0);

    adminStatEls.forEach((element) => element.classList.toggle('hidden', !isAdmin));
    if (isAdmin) {
        if (statCampusCop) statCampusCop.textContent = formatCurrency(Number(stats?.totalsByCurrency?.COP || 0), 'COP');
        if (statCampusUsd) statCampusUsd.textContent = formatCurrency(Number(stats?.totalsByCurrency?.USD || 0), 'USD');
        if (statActiveMissionaries) {
            statActiveMissionaries.textContent = String(stats?.activeMissionaries || 0);
        }
    }
}

async function loadDonors() {
    const requestRevision = ++loadRevision;
    showLoading();
    try {
        const auth = await withTimeout(
            ensureAuthenticated(),
            REQUEST_TIMEOUT_MS,
            'La autenticación del portal',
        );
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }
        const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
        currentAuthHeaders = headers;

        const sessionRequest = campusSessionChecked
            ? Promise.resolve(null)
            : getPortalSession({ auth });
        const donorsRequest = fetchJsonWithTimeout('/api/portal/campus/donors', {
            headers,
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La carga de donantes');
        const [sessionResult, donorsResult] = await Promise.all([sessionRequest, donorsRequest]);
        if (requestRevision !== loadRevision) return;

        if (sessionResult) {
            const { ok, data: sessionData } = sessionResult;
            if (!ok || !sessionData?.ok) {
                throw new Error(sessionData?.error || 'No se pudo validar la sesión.');
            }
            if (!sessionData.permissions?.can_access_campus) {
                window.location.replace('/portal');
                return;
            }
            campusSessionChecked = true;
            showSecureContent();
        }

        const { response, data } = donorsResult;

        if (!response.ok || !data.ok) {
            if (response.status === 403) {
                window.location.replace('/portal');
                return;
            }
            throw new Error(data.error || 'No se pudieron cargar los donantes.');
        }

        isAdminView = Boolean(data.isAdmin);
        reportActionsEl?.classList.toggle('hidden', !isAdminView);
        reportActionsEl?.classList.toggle('flex', isAdminView);
        allDonors = Array.isArray(data.donors) ? data.donors : [];
        visibleDonorLimit = DONORS_PAGE_SIZE;
        populateMissionaryFilter(allDonors, isAdminView);

        if (data.isCampusMissionary) {
            subtitleEl.textContent = 'Tus donantes recurrentes y de una sola vez';
        } else if (data.viewMode === 'administrative' || data.isAdmin) {
            subtitleEl.textContent = 'Vista administrativa de donantes Campus';
        }
        if (scopeLabelEl) scopeLabelEl.textContent = scopeLabel(data.financeScope, data.isCampusMissionary);

        updateStats(data.stats, isAdminView);
        updateCoverage(data.coverage, data.isCampusMissionary);
        renderDonors();
    } catch (error) {
        if (requestRevision !== loadRevision) return;
        console.error('[campus] Error loading donors:', error);
        if (campusSessionChecked) {
            showSecureContent();
            showLoadError(error);
        } else {
            showGate(error?.message || 'No se pudieron validar permisos.');
        }
    }
}

filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
        currentFilter = button.dataset.donorFilter || 'all';
        visibleDonorLimit = DONORS_PAGE_SIZE;
        renderDonors();
    });
});

searchEl?.addEventListener('input', () => {
    visibleDonorLimit = DONORS_PAGE_SIZE;
    renderDonors();
});

missionaryFilterEl?.addEventListener('change', () => {
    currentMissionarySlug = missionaryFilterEl.value || 'all';
    visibleDonorLimit = DONORS_PAGE_SIZE;
    updateMissionaryExportButton();
    renderDonors();
});

exportGeneralEl?.addEventListener('click', () => void downloadCampusReport());
exportMissionaryEl?.addEventListener('click', () => {
    if (currentMissionarySlug === 'all') return;
    void downloadCampusReport(currentMissionarySlug);
});

loadMoreEl?.addEventListener('click', () => {
    const previousVisibleCount = Math.min(getFilteredDonors().length, visibleDonorLimit);
    visibleDonorLimit += DONORS_PAGE_SIZE;
    renderDonors();
    window.requestAnimationFrame(() => {
        contentEl?.querySelector(`[data-donor-index="${previousVisibleCount}"]`)?.focus();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    showGate();
    void loadDonors();
});
