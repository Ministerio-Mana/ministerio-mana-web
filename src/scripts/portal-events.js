import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

// DOM Elements
const eventsList = document.getElementById('events-list');
const eventsLoading = document.getElementById('events-loading');
const eventsEmpty = document.getElementById('events-empty');
const btnNewEvent = document.getElementById('btn-new-event');
const eventModal = document.getElementById('event-modal');
const closeModal = document.getElementById('close-modal');
const eventForm = document.getElementById('event-form');
const eventIdInput = document.getElementById('event-id');
const eventModalTitle = eventModal?.querySelector('h2');
const eventSubmitBtn = eventForm?.querySelector('button[type="submit"]');
const eventScopeSelect = eventForm?.querySelector('[name="scope"]');
const eventCountryInput = eventForm?.querySelector('[name="country"]');
const eventRegionWrapper = document.getElementById('event-scope-region-wrapper');
const eventRegionSelect = document.getElementById('event-region-select');
const eventChurchWrapper = document.getElementById('event-scope-church-wrapper');
const eventChurchSelect = document.getElementById('event-church-select');

const REQUEST_TIMEOUT_MS = 15000;

let authHeaders = {};
let eventsCache = [];
let churchesCatalog = [];
let regionsCatalog = [];
let currentUserId = '';
let currentRole = 'user';
let currentCountry = '';
let currentChurchId = '';
let currentAllowedRegionIds = [];
let currentPermissions = {
    can_manage_local_events: false,
    can_manage_regional_events: false,
    can_manage_national_events: false,
    can_manage_global_events: false,
};

const churchesById = new Map();
const regionsById = new Map();

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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({
            ok: false,
            error: 'El servidor respondió sin datos válidos.',
        }));
        return { res, data };
    } catch (error) {
        if (error?.name === 'AbortError') throw makeTimeoutError(label);
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function showEventsError(error) {
    if (!eventsLoading) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'No se pudieron cargar eventos.';
    eventsLoading.className = 'py-12 text-center';
    eventsLoading.innerHTML = `
        <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-red-700">
            <p class="font-bold mb-2">Error al cargar eventos</p>
            <p class="text-sm">${escapeHtml(message)}</p>
            <button type="button" id="btn-retry-events" class="mt-4 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm border border-red-100">
                Reintentar
            </button>
        </div>
    `;
    document.getElementById('btn-retry-events')?.addEventListener('click', () => {
        void loadEvents();
    });
}

function sanitizeUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return '';
}

function normalizeCountry(value) {
    return String(value || '').trim().toLowerCase();
}

function sameCountry(left, right) {
    return normalizeCountry(left) === normalizeCountry(right);
}

function isAdminRole() {
    return currentRole === 'admin' || currentRole === 'superadmin';
}

function isNationalRole() {
    return currentRole === 'national_pastor' || currentRole === 'national_collaborator';
}

function isRegionalRole() {
    return currentRole === 'regional_pastor' || currentRole === 'regional_collaborator';
}

function isLocalRole() {
    return currentRole === 'pastor' || currentRole === 'local_collaborator' || currentRole === 'leader';
}

function hasPermission(key) {
    return Boolean(currentPermissions?.[key]);
}

function hasAnyEventManagementPermission() {
    return (
        hasPermission('can_manage_local_events')
        || hasPermission('can_manage_regional_events')
        || hasPermission('can_manage_national_events')
        || hasPermission('can_manage_global_events')
    );
}

function getAllowedScopes() {
    const scopes = [];
    if (hasPermission('can_manage_local_events')) scopes.push('LOCAL');
    if (hasPermission('can_manage_regional_events')) scopes.push('REGIONAL');
    if (hasPermission('can_manage_national_events')) scopes.push('NATIONAL');
    if (hasPermission('can_manage_global_events')) scopes.push('GLOBAL');
    return scopes;
}

function getScopedRegions() {
    let scoped = (regionsCatalog || []).filter((region) => region?.is_active !== false);

    if (isAdminRole()) {
        return scoped;
    }

    if (currentAllowedRegionIds.length) {
        scoped = scoped.filter((region) => currentAllowedRegionIds.includes(region.id));
    } else if (currentCountry) {
        scoped = scoped.filter((region) => sameCountry(region.country, currentCountry));
    } else {
        scoped = [];
    }

    return scoped;
}

function getScopedChurches() {
    let scoped = Array.isArray(churchesCatalog) ? [...churchesCatalog] : [];

    if (isLocalRole() && currentChurchId) {
        scoped = scoped.filter((church) => church.id === currentChurchId);
    } else if (isRegionalRole()) {
        if (currentAllowedRegionIds.length) {
            scoped = scoped.filter((church) => currentAllowedRegionIds.includes(church.region_id));
        } else if (currentCountry) {
            scoped = scoped.filter((church) => sameCountry(church.country, currentCountry));
        } else {
            scoped = [];
        }
    } else if (isNationalRole()) {
        if (currentCountry) {
            scoped = scoped.filter((church) => sameCountry(church.country, currentCountry));
        } else {
            scoped = [];
        }
    }

    scoped.sort((a, b) => {
        const aKey = `${a.country || ''}|${a.city || ''}|${a.name || ''}`;
        const bKey = `${b.country || ''}|${b.city || ''}|${b.name || ''}`;
        return aKey.localeCompare(bKey, 'es');
    });

    return scoped;
}

function populateRegionOptions(selectedRegionId = '') {
    if (!eventRegionSelect) return;

    const regions = getScopedRegions();
    eventRegionSelect.innerHTML = '<option value="">Selecciona una región</option>' + regions
        .map((region) => {
            const label = `${region.code || 'REG'} · ${region.name || 'Región'}${region.country ? ` (${region.country})` : ''}`;
            const selected = selectedRegionId && selectedRegionId === region.id ? ' selected' : '';
            return `<option value="${escapeAttr(region.id || '')}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join('');
}

function populateChurchOptions(selectedChurchId = '') {
    if (!eventChurchSelect) return;

    const churches = getScopedChurches();
    eventChurchSelect.innerHTML = '<option value="">Selecciona una iglesia</option>' + churches
        .map((church) => {
            const city = church.city || 'Ciudad';
            const name = church.name || 'Iglesia';
            const country = church.country ? ` · ${church.country}` : '';
            const label = `${city} · ${name}${country}`;
            const selected = selectedChurchId && selectedChurchId === church.id ? ' selected' : '';
            return `<option value="${escapeAttr(church.id || '')}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join('');
}

function syncCountryFromRegion() {
    if (!eventRegionSelect || !eventCountryInput) return;
    const regionId = String(eventRegionSelect.value || '').trim();
    if (!regionId) return;
    const region = regionsById.get(regionId);
    if (!region?.country) return;
    eventCountryInput.value = region.country;
}

function syncScopeInputs(options = {}) {
    if (!eventScopeSelect || !eventCountryInput) return;

    const preserveSelections = Boolean(options.preserveSelections);
    const scope = String(eventScopeSelect.value || '').toUpperCase();
    const needsRegion = scope === 'REGIONAL';
    const needsChurch = scope === 'LOCAL';

    const currentRegionSelection = String(eventRegionSelect?.value || '').trim();
    const currentChurchSelection = String(eventChurchSelect?.value || '').trim();

    if (eventRegionWrapper && eventRegionSelect) {
        eventRegionWrapper.classList.toggle('hidden', !needsRegion);
        eventRegionSelect.required = needsRegion;
        if (needsRegion) {
            populateRegionOptions(preserveSelections ? currentRegionSelection : '');
            eventRegionSelect.disabled = false;
            if (isRegionalRole()) {
                if (currentAllowedRegionIds.length === 1) {
                    eventRegionSelect.value = currentAllowedRegionIds[0];
                    eventRegionSelect.disabled = true;
                } else if (currentAllowedRegionIds.length > 1 && !currentAllowedRegionIds.includes(eventRegionSelect.value)) {
                    eventRegionSelect.value = '';
                }
            }
        } else {
            eventRegionSelect.required = false;
            eventRegionSelect.value = '';
            eventRegionSelect.disabled = true;
        }
    }

    if (eventChurchWrapper && eventChurchSelect) {
        eventChurchWrapper.classList.toggle('hidden', !needsChurch);
        eventChurchSelect.required = needsChurch;
        if (needsChurch) {
            populateChurchOptions(preserveSelections ? currentChurchSelection : '');
            eventChurchSelect.disabled = false;
            if (isLocalRole() && currentChurchId) {
                eventChurchSelect.value = currentChurchId;
                eventChurchSelect.disabled = true;
            }
        } else {
            eventChurchSelect.required = false;
            eventChurchSelect.value = '';
            eventChurchSelect.disabled = true;
        }
    }

    if (scope === 'GLOBAL') {
        eventCountryInput.value = '';
        eventCountryInput.disabled = true;
        return;
    }

    if (scope === 'REGIONAL') {
        syncCountryFromRegion();
        if (!isAdminRole()) {
            eventCountryInput.disabled = true;
            if (currentCountry) eventCountryInput.value = currentCountry;
        } else {
            eventCountryInput.disabled = true;
        }
        return;
    }

    if (!isAdminRole()) {
        eventCountryInput.disabled = true;
        if (currentCountry) {
            eventCountryInput.value = currentCountry;
        }
    } else {
        eventCountryInput.disabled = false;
    }
}

function syncScopeOptions() {
    if (!eventScopeSelect) return;

    const allowedScopes = getAllowedScopes();
    const hasRestrictions = allowedScopes.length > 0;

    eventScopeSelect.querySelectorAll('option').forEach((option) => {
        option.hidden = hasRestrictions && !allowedScopes.includes(option.value);
    });

    eventScopeSelect.disabled = !hasRestrictions;

    if (hasRestrictions && !allowedScopes.includes(eventScopeSelect.value)) {
        eventScopeSelect.value = allowedScopes[0];
    }

    syncScopeInputs({ preserveSelections: true });
}

function applyRolePermissions() {
    if (btnNewEvent) {
        btnNewEvent.style.display = hasAnyEventManagementPermission() ? '' : 'none';
    }
}

function getEventScope(event) {
    return String(event?.scope || '').toUpperCase();
}

function canEditEvent(event) {
    if (!event || !hasAnyEventManagementPermission()) return false;

    const scope = getEventScope(event);
    if (!scope) return false;

    if (currentUserId && event.created_by && event.created_by === currentUserId) {
        return true;
    }

    if (scope === 'GLOBAL') {
        return hasPermission('can_manage_global_events');
    }

    if (scope === 'NATIONAL') {
        if (!hasPermission('can_manage_national_events')) return false;
        if (isAdminRole()) return true;
        if (currentCountry && sameCountry(event.country, currentCountry)) return true;
        return false;
    }

    if (scope === 'REGIONAL') {
        if (!hasPermission('can_manage_regional_events')) return false;
        if (isAdminRole()) return true;
        if (event.region_id && currentAllowedRegionIds.includes(event.region_id)) return true;
        if (currentCountry && sameCountry(event.country, currentCountry)) return true;
        return false;
    }

    if (scope === 'LOCAL') {
        if (!hasPermission('can_manage_local_events')) return false;
        if (isAdminRole()) return true;

        const churchId = String(event.church_id || '').trim();
        if (!churchId) return false;

        if (currentChurchId && churchId === currentChurchId) return true;

        const church = churchesById.get(churchId);
        if (!church) return false;

        if (isRegionalRole() && currentAllowedRegionIds.length && church.region_id) {
            if (currentAllowedRegionIds.includes(church.region_id)) return true;
        }

        if ((isRegionalRole() || isNationalRole()) && currentCountry) {
            if (sameCountry(church.country, currentCountry)) return true;
        }

        return false;
    }

    return false;
}

async function loadProfile() {
    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/session', {
            headers: authHeaders,
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La sesión del portal');
        if (!res.ok) return;

        if (!data?.ok) return;

        const profile = data.profile || {};
        const scopeContext = data.scope_context || {};

        currentUserId = profile.user_id || '';
        currentRole = profile.effective_role || profile.role || 'user';
        currentCountry = scopeContext.allowed_country || profile.country || '';
        currentChurchId = scopeContext.allowed_church_id || profile.church_id || profile.portal_church_id || '';
        currentAllowedRegionIds = Array.isArray(scopeContext.allowed_region_ids)
            ? scopeContext.allowed_region_ids.filter(Boolean)
            : [];
        currentPermissions = {
            ...currentPermissions,
            ...(data.permissions || {}),
        };

        applyRolePermissions();
    } catch (err) {
        console.error(err);
    }
}

async function loadChurchesCatalog() {
    try {
        const { res, data: payload } = await fetchJsonWithTimeout('/api/portal/churches', {
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La carga de iglesias');
        if (!res.ok) {
            churchesCatalog = [];
            churchesById.clear();
            return;
        }
        churchesCatalog = Array.isArray(payload) ? payload : [];
        churchesById.clear();
        churchesCatalog.forEach((church) => {
            if (!church?.id) return;
            churchesById.set(church.id, church);
        });
    } catch (err) {
        console.error(err);
        churchesCatalog = [];
        churchesById.clear();
    }
}

async function loadRegionsCatalog() {
    try {
        const { res, data: payload } = await fetchJsonWithTimeout('/api/portal/regions', {
            headers: authHeaders,
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La carga de regiones');
        if (!res.ok) {
            regionsCatalog = [];
            regionsById.clear();
            return;
        }
        regionsCatalog = Array.isArray(payload?.regions) ? payload.regions : [];
        regionsById.clear();
        regionsCatalog.forEach((region) => {
            if (!region?.id) return;
            regionsById.set(region.id, region);
        });
    } catch (err) {
        console.error(err);
        regionsCatalog = [];
        regionsById.clear();
    }
}

// Auth & Init
async function init() {
    try {
        const auth = await ensureAuthenticated();
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }

        authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

        await loadProfile();
        await Promise.all([loadChurchesCatalog(), loadRegionsCatalog()]);

        syncScopeOptions();
        await loadEvents();
    } catch (error) {
        console.error('[portal-events] init error', error);
        showEventsError(error);
    }
}

function toInputDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openEventModal(mode, eventData = null) {
    if (!eventModal || !eventForm) return;

    eventForm.reset();

    if (eventIdInput) eventIdInput.value = eventData?.id || '';
    if (eventModalTitle) eventModalTitle.textContent = mode === 'edit' ? 'Editar Evento' : 'Nuevo Evento';
    if (eventSubmitBtn) eventSubmitBtn.textContent = mode === 'edit' ? 'Guardar Cambios' : 'Guardar Evento';

    const presetScope = String(eventData?.scope || eventScopeSelect?.value || 'LOCAL').toUpperCase();
    const presetRegionId = String(eventData?.region_id || '').trim();
    const presetChurchId = String(eventData?.church_id || '').trim();

    if (eventData) {
        eventForm.querySelector('[name="title"]').value = eventData.title || '';
        eventForm.querySelector('[name="description"]').value = eventData.description || '';
        eventForm.querySelector('[name="start_date"]').value = toInputDateTime(eventData.start_date);
        eventForm.querySelector('[name="end_date"]').value = toInputDateTime(eventData.end_date);
        eventForm.querySelector('[name="location_name"]').value = eventData.location_name || '';
        eventForm.querySelector('[name="location_address"]').value = eventData.location_address || '';
        eventForm.querySelector('[name="city"]').value = eventData.city || '';
        eventForm.querySelector('[name="country"]').value = eventData.country || '';
        eventForm.querySelector('[name="banner_url"]').value = eventData.banner_url || '';
    }

    if (eventScopeSelect) {
        eventScopeSelect.value = presetScope;
    }

    syncScopeOptions();

    if (eventRegionSelect && presetRegionId) {
        if ([...eventRegionSelect.options].some((option) => option.value === presetRegionId)) {
            eventRegionSelect.value = presetRegionId;
        }
    }

    if (eventChurchSelect && presetChurchId) {
        if ([...eventChurchSelect.options].some((option) => option.value === presetChurchId)) {
            eventChurchSelect.value = presetChurchId;
        }
    }

    syncScopeInputs({ preserveSelections: true });

    eventModal.classList.remove('hidden');
    eventModal.classList.add('flex');
}

function closeEventModal() {
    if (!eventModal) return;
    eventModal.classList.add('hidden');
    eventModal.classList.remove('flex');
}

// Load Events
async function loadEvents() {
    if (!eventsLoading || !eventsList || !eventsEmpty) return;

    eventsLoading.classList.remove('hidden');
    eventsLoading.className = 'py-12 text-center text-slate-400 animate-pulse';
    eventsLoading.textContent = 'Cargando eventos...';
    eventsList.classList.add('hidden');
    eventsEmpty.classList.add('hidden');

    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/events', {
            headers: authHeaders,
            credentials: 'include',
        }, REQUEST_TIMEOUT_MS, 'La carga de eventos');

        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar eventos');

        eventsCache = data.events || [];
        renderEvents(eventsCache);
    } catch (err) {
        console.error(err);
        showEventsError(err);
        return;
    } finally {
        if (!eventsLoading.querySelector('#btn-retry-events')) {
            eventsLoading.classList.add('hidden');
        }
    }
}

// Render Events
function renderEvents(events) {
    if (!eventsList || !eventsEmpty) return;

    if (!events.length) {
        eventsEmpty.classList.remove('hidden');
        return;
    }

    eventsList.innerHTML = events.map((event) => {
        const safeTitle = escapeHtml(event.title || 'Evento');
        const safeTitleAttr = escapeAttr(event.title || 'Evento');
        const safeScope = escapeHtml(event.scope || '');
        const safeDescription = escapeHtml(event.description || 'Sin descripción');
        const locationParts = [event.location_name, event.location_address, event.city, event.country].filter(Boolean);
        const locationLabel = locationParts.length ? locationParts.join(' · ') : 'Virtual';
        const safeLocation = escapeHtml(locationLabel);
        const startLabel = event.start_date ? new Date(event.start_date).toLocaleDateString() : '';
        const safeStartLabel = escapeHtml(startLabel);
        const safeStatus = escapeHtml(event.status || 'PUBLICADO');
        const safeEventId = escapeAttr(event.id || '');
        const bannerUrl = sanitizeUrl(event.banner_url);
        const banner = bannerUrl
            ? `<div class="h-32 rounded-2xl bg-slate-100 overflow-hidden mb-4">
                <img src="${escapeAttr(bannerUrl)}" alt="${safeTitleAttr}" class="w-full h-full object-cover">
              </div>`
            : '';
        return `
        <div class="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
            <div class="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-32 w-32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>

            <div class="relative z-10">
                ${banner}
                <div class="flex justify-between items-start mb-4">
                    <span class="px-3 py-1 rounded-full bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500 border border-slate-100">
                        ${safeScope}
                    </span>
                    <div class="text-right">
                        <p class="text-xs font-bold text-[#293C74]">${safeStartLabel}</p>
                        <p class="text-[10px] text-slate-400 uppercase tracking-widest">Inicio</p>
                    </div>
                </div>

                <h3 class="text-lg font-bold text-[#293C74] mb-2 group-hover:text-brand-teal transition-colors">${safeTitle}</h3>
                <p class="text-sm text-slate-500 line-clamp-2 mb-4">${safeDescription}</p>

                <div class="flex items-center gap-2 text-xs text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span>${safeLocation}</span>
                </div>

                <div class="mt-4 flex items-center justify-between">
                    ${canEditEvent(event) ? `
                    <button type="button" class="event-edit text-xs font-bold text-[#293C74] hover:underline" data-event-id="${safeEventId}">
                        Editar evento
                    </button>` : '<span></span>'}
                    <span class="text-[10px] uppercase tracking-widest text-slate-400">${safeStatus}</span>
                </div>
            </div>
        </div>
    `;
    }).join('');

    eventsList.classList.remove('hidden');
}

// Modal Logic
btnNewEvent?.addEventListener('click', () => {
    openEventModal('create');
});

closeModal?.addEventListener('click', () => {
    closeEventModal();
});

eventModal?.addEventListener('click', (event) => {
    if (event.target === eventModal) {
        closeEventModal();
    }
});

eventsList?.addEventListener('click', (event) => {
    const btn = event.target.closest('.event-edit');
    if (!btn) return;
    const eventId = btn.getAttribute('data-event-id');
    const eventData = eventsCache.find((item) => item.id === eventId);
    if (eventData) openEventModal('edit', eventData);
});

eventScopeSelect?.addEventListener('change', () => {
    syncScopeInputs({ preserveSelections: true });
});

eventRegionSelect?.addEventListener('change', () => {
    if (String(eventScopeSelect?.value || '').toUpperCase() === 'REGIONAL') {
        syncCountryFromRegion();
    }
});

eventForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = eventForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Guardando...';
    btn.disabled = true;

    try {
        const formData = new FormData(eventForm);
        const payload = Object.fromEntries(formData.entries());
        const eventId = payload.id ? payload.id.toString() : '';
        delete payload.id;

        Object.keys(payload).forEach((key) => {
            if (payload[key] === '') delete payload[key];
        });

        const { res, data } = await fetchJsonWithTimeout('/api/portal/events', {
            method: eventId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            credentials: 'include',
            body: JSON.stringify(eventId ? { id: eventId, ...payload } : payload),
        }, REQUEST_TIMEOUT_MS, 'El guardado del evento');

        if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

        eventForm.reset();
        closeEventModal();
        await loadEvents();
    } catch (err) {
        alert(err.message || 'No se pudo guardar el evento');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

// Run
init();
