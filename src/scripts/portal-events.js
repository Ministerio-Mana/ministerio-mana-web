import archiveIconUrl from 'lucide-static/icons/archive.svg?url';
import archiveRestoreIconUrl from 'lucide-static/icons/archive-restore.svg?url';
import calendarIconUrl from 'lucide-static/icons/calendar-days.svg?url';
import externalLinkIconUrl from 'lucide-static/icons/external-link.svg?url';
import mapPinIconUrl from 'lucide-static/icons/map-pin.svg?url';
import pencilIconUrl from 'lucide-static/icons/pencil.svg?url';
import sendIconUrl from 'lucide-static/icons/send.svg?url';
import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const eventsGate = document.getElementById('events-gate');
const eventsSecureContent = document.getElementById('events-secure-content');
const eventsList = document.getElementById('events-list');
const eventsLoading = document.getElementById('events-loading');
const eventsEmpty = document.getElementById('events-empty');
const eventFilters = document.getElementById('event-filters');
const eventSearch = document.getElementById('event-search');
const eventScopeFilter = document.getElementById('event-scope-filter');
const btnNewEvent = document.getElementById('btn-new-event');
const eventModal = document.getElementById('event-modal');
const closeModal = document.getElementById('close-modal');
const eventCancel = document.getElementById('event-cancel');
const eventForm = document.getElementById('event-form');
const eventFormError = document.getElementById('event-form-error');
const eventIdInput = document.getElementById('event-id');
const eventModalTitle = document.getElementById('event-modal-title');
const eventSubmitBtn = eventForm?.querySelector('button[type="submit"]');
const eventScopeSelect = eventForm?.querySelector('[name="scope"]');
const eventStatusSelect = eventForm?.querySelector('[name="status"]');
const eventCountryInput = eventForm?.querySelector('[name="country"]');
const eventRegionWrapper = document.getElementById('event-scope-region-wrapper');
const eventRegionSelect = document.getElementById('event-region-select');
const eventChurchWrapper = document.getElementById('event-scope-church-wrapper');
const eventChurchSelect = document.getElementById('event-church-select');
const eventPlatformPending = document.getElementById('event-platform-pending');
const eventPlatformSettings = document.getElementById('event-platform-settings');
const eventFinancePending = document.getElementById('event-finance-pending');
const eventFinanceSettings = document.getElementById('event-finance-settings');
const eventPricingModel = document.getElementById('event-pricing-model');
const eventPriceInput = document.getElementById('event-price');
const eventOnlineProvider = document.getElementById('event-online-provider');
const eventOnlineProviderWrapper = document.getElementById('event-online-provider-wrapper');
const eventRegistrationMode = document.getElementById('event-registration-mode');
const eventRegistrationUrlWrapper = document.getElementById('event-registration-url-wrapper');
const eventManualPaymentEnabled = document.getElementById('event-manual-payment-enabled');
const eventManualPaymentSettings = document.getElementById('event-manual-payment-settings');
const eventManualPaymentKind = document.getElementById('event-manual-payment-kind');
const eventManualPaymentLabel = document.getElementById('event-manual-payment-label');
const eventManualPaymentInstructions = document.getElementById('event-manual-payment-instructions');
const eventManualPaymentUrlWrapper = document.getElementById('event-manual-payment-url-wrapper');
const eventManualPaymentUrl = document.getElementById('event-manual-payment-url');
const eventManualPaymentQrWrapper = document.getElementById('event-manual-payment-qr-wrapper');
const eventManualPaymentQr = document.getElementById('event-manual-payment-qr');
const eventManualPaymentQrPath = document.getElementById('event-manual-payment-qr-path');
const eventManualPaymentQrPreview = document.getElementById('event-manual-payment-qr-preview');
const previewImage = document.getElementById('event-preview-image');
const previewDate = document.getElementById('event-preview-date');
const previewScope = document.getElementById('event-preview-scope');
const previewStatus = document.getElementById('event-preview-status');
const previewTitle = document.getElementById('event-preview-title');
const previewDescription = document.getElementById('event-preview-description');
const previewLocation = document.getElementById('event-preview-location');
const previewPrice = document.getElementById('event-preview-price');
const previewCta = document.getElementById('event-preview-cta');

const REQUEST_TIMEOUT_MS = 15000;
const SCOPE_LABELS = {
    LOCAL: 'Local',
    REGIONAL: 'Regional',
    NATIONAL: 'Nacional',
    GLOBAL: 'Global',
};
const LIFECYCLE_LABELS = {
    upcoming: 'Próximo',
    live: 'En curso',
    completed: 'Terminado',
    draft: 'Borrador',
    archived: 'Archivado',
};
const LIFECYCLE_TONES = {
    upcoming: 'bg-blue-50 text-blue-700',
    live: 'bg-teal-50 text-teal-700',
    completed: 'bg-slate-100 text-slate-700',
    draft: 'bg-amber-50 text-amber-700',
    archived: 'bg-slate-200 text-slate-600',
};

let authHeaders = {};
let eventsCache = [];
let churchesCatalog = [];
let regionsCatalog = [];
let currentRole = 'user';
let currentCountry = '';
let currentChurchId = '';
let currentAllowedRegionIds = [];
let currentFilter = 'active';
let currentPermissions = {
    can_manage_local_events: false,
    can_manage_regional_events: false,
    can_manage_national_events: false,
    can_manage_global_events: false,
    can_view_event_finances: false,
};
let eventPermissionValidated = false;
let eventPlatformReady = false;
let eventFinanceReady = false;
let manualQrPreviewObjectUrl = '';

const churchesById = new Map();
const regionsById = new Map();

function showSecureContent() {
    eventsGate?.classList.add('hidden');
    eventsSecureContent?.classList.remove('hidden');
}

function showGate(message = 'Validando permisos...') {
    if (eventsGate) {
        eventsGate.textContent = message;
        eventsGate.classList.remove('hidden');
    }
    eventsSecureContent?.classList.add('hidden');
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

function icon(url, label = '') {
    const alt = label ? ` alt="${escapeAttr(label)}"` : ' alt="" aria-hidden="true"';
    return `<img src="${escapeAttr(url)}"${alt} class="h-4 w-4 flex-none" />`;
}

function sanitizeUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^https:\/\//i.test(url)) return url;
    return '';
}

function getPublicEventPath(event) {
    if (event?.id === '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202') return '/eventos/cumbre-mundial-2026';
    const identifier = String(event?.slug || event?.id || '').trim();
    return identifier ? `/eventos/${encodeURIComponent(identifier)}` : '';
}

function syncRegistrationFields() {
    const isExternal = eventPlatformReady && eventRegistrationMode?.value === 'EXTERNAL';
    const hasRegistration = eventPlatformReady && ['EXTERNAL', 'INTERNAL'].includes(eventRegistrationMode?.value);
    eventRegistrationUrlWrapper?.classList.toggle('hidden', !isExternal);
    const urlInput = eventForm?.querySelector('[name="registration_url"]');
    if (urlInput) {
        urlInput.disabled = !isExternal;
        urlInput.required = isExternal;
    }
    previewCta?.classList.toggle('hidden', !hasRegistration);
    previewCta?.classList.toggle('inline-flex', hasRegistration);
}

function syncPlatformFields() {
    eventPlatformPending?.classList.toggle('hidden', eventPlatformReady);
    eventPlatformSettings?.classList.toggle('hidden', !eventPlatformReady);
    eventForm?.querySelectorAll('[data-platform-field]').forEach((field) => {
        field.disabled = !eventPlatformReady;
    });
    syncRegistrationFields();
}

function syncFinanceFields() {
    eventFinancePending?.classList.toggle('hidden', eventFinanceReady);
    eventFinanceSettings?.classList.toggle('hidden', !eventFinanceReady);
    eventForm?.querySelectorAll('[data-finance-field]').forEach((field) => {
        field.disabled = !eventFinanceReady;
    });
    if (!eventFinanceReady || !eventPriceInput) return;
    const isFree = eventPricingModel?.value === 'FREE';
    const usesInternalRegistration = eventRegistrationMode?.value === 'INTERNAL';
    if (isFree) eventPriceInput.value = '0';
    eventPriceInput.readOnly = isFree;
    eventPriceInput.classList.toggle('bg-slate-100', isFree);
    if (eventOnlineProvider) {
        if (isFree || !usesInternalRegistration) eventOnlineProvider.value = 'NONE';
        eventOnlineProvider.disabled = isFree || !usesInternalRegistration;
    }
    if (eventOnlineProviderWrapper) {
        const hideProvider = isFree || !usesInternalRegistration;
        eventOnlineProviderWrapper.hidden = hideProvider;
        eventOnlineProviderWrapper.style.display = hideProvider ? 'none' : '';
    }
    syncManualPaymentFields();
}

function syncManualPaymentFields() {
    const available = eventFinanceReady
        && eventPricingModel?.value !== 'FREE'
        && eventRegistrationMode?.value === 'INTERNAL';
    if (eventManualPaymentEnabled) {
        if (!available) eventManualPaymentEnabled.checked = false;
        eventManualPaymentEnabled.disabled = !available;
    }
    const enabled = available && Boolean(eventManualPaymentEnabled?.checked);
    eventManualPaymentSettings?.classList.toggle('hidden', !enabled);
    const kind = String(eventManualPaymentKind?.value || 'QR_TRANSFER').toUpperCase();
    const usesQr = enabled && kind === 'QR_TRANSFER';
    const usesUrl = enabled && kind === 'EXTERNAL';
    eventManualPaymentQrWrapper?.classList.toggle('hidden', !usesQr);
    eventManualPaymentUrlWrapper?.classList.toggle('hidden', !usesUrl);
    [eventManualPaymentKind, eventManualPaymentLabel, eventManualPaymentInstructions].forEach((field) => {
        if (field) field.disabled = !enabled;
    });
    if (eventManualPaymentUrl) {
        eventManualPaymentUrl.disabled = !usesUrl;
        eventManualPaymentUrl.required = usesUrl;
    }
    if (eventManualPaymentQr) eventManualPaymentQr.disabled = !usesQr;
}

async function loadEventPaymentOption(eventData) {
    if (!eventOnlineProvider) return;
    eventOnlineProvider.value = 'NONE';
    if (eventManualPaymentEnabled) eventManualPaymentEnabled.checked = false;
    if (eventManualPaymentQrPath) eventManualPaymentQrPath.value = '';
    if (eventManualPaymentQrPreview) {
        eventManualPaymentQrPreview.removeAttribute('src');
        eventManualPaymentQrPreview.classList.add('hidden');
    }
    if (!eventFinanceReady || !eventData?.id || eventData?.registration_mode !== 'INTERNAL') return;
    eventOnlineProvider.disabled = true;
    try {
        const params = new URLSearchParams({ event_id: eventData.id });
        const { res, data } = await fetchJsonWithTimeout(
            `/api/portal/event-payments/options?${params}`,
            { headers: authHeaders, credentials: 'include' },
            REQUEST_TIMEOUT_MS,
            'La carga de métodos de pago',
        );
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar el método de pago.');
        const activeOnline = (Array.isArray(data.options) ? data.options : []).find(
            (option) => option?.kind === 'ONLINE' && option?.is_active,
        );
        const activeManual = (Array.isArray(data.options) ? data.options : []).find(
            (option) => option?.kind !== 'ONLINE' && ['MANUAL', 'EXTERNAL'].includes(option?.provider) && option?.is_active,
        );
        eventOnlineProvider.value = activeOnline?.provider || 'NONE';
        if (activeManual && eventManualPaymentEnabled) {
            eventManualPaymentEnabled.checked = true;
            if (eventManualPaymentKind) eventManualPaymentKind.value = activeManual.kind || 'QR_TRANSFER';
            if (eventManualPaymentLabel) eventManualPaymentLabel.value = activeManual.label || '';
            if (eventManualPaymentInstructions) eventManualPaymentInstructions.value = activeManual.instructions || '';
            if (eventManualPaymentUrl) eventManualPaymentUrl.value = activeManual.external_url || '';
            if (eventManualPaymentQrPath) eventManualPaymentQrPath.value = activeManual.qr_asset_path || '';
            if (eventManualPaymentQrPreview && activeManual.qr_signed_url) {
                eventManualPaymentQrPreview.src = activeManual.qr_signed_url;
                eventManualPaymentQrPreview.classList.remove('hidden');
            }
        }
    } catch (error) {
        showFormError(error?.message || 'No se pudo cargar el método de pago.');
    } finally {
        const canUseOnlineProvider = eventFinanceReady
            && eventPricingModel?.value !== 'FREE'
            && eventRegistrationMode?.value === 'INTERNAL';
        if (!canUseOnlineProvider) eventOnlineProvider.value = 'NONE';
        eventOnlineProvider.disabled = !canUseOnlineProvider;
        if (eventOnlineProviderWrapper) {
            eventOnlineProviderWrapper.hidden = !canUseOnlineProvider;
            eventOnlineProviderWrapper.style.display = canUseOnlineProvider ? '' : 'none';
        }
        syncManualPaymentFields();
    }
}

async function saveEventPaymentOption(eventId, provider) {
    const { res, data } = await fetchJsonWithTimeout('/api/portal/event-payments/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'include',
        body: JSON.stringify({ event_id: eventId, provider }),
    }, REQUEST_TIMEOUT_MS, 'La configuración del método de pago');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el método de pago.');
}

async function uploadManualPaymentQr(eventId) {
    const file = eventManualPaymentQr?.files?.[0];
    if (!file) return String(eventManualPaymentQrPath?.value || '');
    if (file.size > 3 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('El QR debe ser una imagen PNG, JPG o WebP de máximo 3 MB.');
    }
    const payload = new FormData();
    payload.append('event_id', eventId);
    payload.append('file', file);
    const { res, data } = await fetchJsonWithTimeout('/api/portal/event-payments/qr', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: payload,
    }, REQUEST_TIMEOUT_MS, 'La carga del código QR');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el código QR.');
    if (eventManualPaymentQrPath) eventManualPaymentQrPath.value = data.path || '';
    return String(data.path || '');
}

async function saveManualPaymentOption(eventId) {
    const enabled = Boolean(eventManualPaymentEnabled?.checked)
        && eventPricingModel?.value !== 'FREE'
        && eventRegistrationMode?.value === 'INTERNAL';
    let qrAssetPath = String(eventManualPaymentQrPath?.value || '');
    const kind = String(eventManualPaymentKind?.value || 'QR_TRANSFER').toUpperCase();
    if (enabled && kind === 'QR_TRANSFER') qrAssetPath = await uploadManualPaymentQr(eventId);
    const { res, data } = await fetchJsonWithTimeout('/api/portal/event-payments/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'include',
        body: JSON.stringify({
            event_id: eventId,
            enabled,
            kind,
            label: String(eventManualPaymentLabel?.value || '').trim(),
            instructions: String(eventManualPaymentInstructions?.value || '').trim(),
            external_url: String(eventManualPaymentUrl?.value || '').trim(),
            qr_asset_path: qrAssetPath,
        }),
    }, REQUEST_TIMEOUT_MS, 'La configuración del pago manual');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el pago manual.');
}

function normalizeCountry(value) {
    return String(value || '').trim().toLowerCase();
}

function sameCountry(left, right) {
    return normalizeCountry(left) === normalizeCountry(right);
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
        const res = await fetch(url, { ...options, signal: controller.signal });
        const data = await res.json().catch(() => ({ ok: false, error: 'El servidor respondió sin datos válidos.' }));
        return { res, data };
    } catch (error) {
        if (error?.name === 'AbortError') throw makeTimeoutError(label);
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function showEventsError(error) {
    if (!eventsLoading || !eventsList || !eventsEmpty) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'No se pudieron cargar eventos.';

    eventsList.classList.add('hidden');
    eventsEmpty.classList.add('hidden');
    eventsLoading.className = 'portal-panel px-5 py-8 text-center';
    eventsLoading.innerHTML = `
        <p class="font-bold text-red-700">No se pudieron cargar los eventos</p>
        <p class="mt-1 text-sm text-slate-600">${escapeHtml(message)}</p>
        <button type="button" id="btn-retry-events" class="mt-4 min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-[#293C74]">Reintentar</button>
    `;
    document.getElementById('btn-retry-events')?.addEventListener('click', () => void loadEvents());
}

function showFormError(message = '') {
    if (!eventFormError) return;
    eventFormError.textContent = message;
    eventFormError.classList.toggle('hidden', !message);
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
    return hasPermission('can_manage_local_events')
        || hasPermission('can_manage_regional_events')
        || hasPermission('can_manage_national_events')
        || hasPermission('can_manage_global_events')
        || hasPermission('can_view_event_finances');
}

function canEditAnyEvent() {
    return getAllowedScopes().length > 0;
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
    let scoped = regionsCatalog.filter((region) => region?.is_active !== false);
    if (isAdminRole()) return scoped;
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
    let scoped = [...churchesCatalog];

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
        scoped = currentCountry ? scoped.filter((church) => sameCountry(church.country, currentCountry)) : [];
    }

    return scoped.sort((a, b) => `${a.country || ''}|${a.city || ''}|${a.name || ''}`.localeCompare(`${b.country || ''}|${b.city || ''}|${b.name || ''}`, 'es'));
}

function populateRegionOptions(selectedRegionId = '') {
    if (!eventRegionSelect) return;
    eventRegionSelect.innerHTML = '<option value="">Selecciona una región</option>' + getScopedRegions()
        .map((region) => {
            const label = `${region.code || 'REG'} · ${region.name || 'Región'}${region.country ? ` (${region.country})` : ''}`;
            return `<option value="${escapeAttr(region.id || '')}"${selectedRegionId === region.id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
        .join('');
}

function populateChurchOptions(selectedChurchId = '') {
    if (!eventChurchSelect) return;
    eventChurchSelect.innerHTML = '<option value="">Selecciona una iglesia</option>' + getScopedChurches()
        .map((church) => {
            const label = `${church.city || 'Ciudad'} · ${church.name || 'Iglesia'}${church.country ? ` · ${church.country}` : ''}`;
            return `<option value="${escapeAttr(church.id || '')}"${selectedChurchId === church.id ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        })
        .join('');
}

function syncCountryFromRegion() {
    if (!eventRegionSelect || !eventCountryInput) return;
    const region = regionsById.get(String(eventRegionSelect.value || '').trim());
    if (region?.country) eventCountryInput.value = region.country;
}

function syncScopeInputs(options = {}) {
    if (!eventScopeSelect || !eventCountryInput) return;
    const preserveSelections = Boolean(options.preserveSelections);
    const scope = String(eventScopeSelect.value || '').toUpperCase();
    const currentRegion = String(eventRegionSelect?.value || '').trim();
    const currentChurch = String(eventChurchSelect?.value || '').trim();
    const needsRegion = scope === 'REGIONAL';
    const needsChurch = scope === 'LOCAL';

    if (eventRegionWrapper && eventRegionSelect) {
        eventRegionWrapper.classList.toggle('hidden', !needsRegion);
        eventRegionSelect.required = needsRegion;
        eventRegionSelect.disabled = !needsRegion;
        if (needsRegion) {
            populateRegionOptions(preserveSelections ? currentRegion : '');
            if (isRegionalRole() && currentAllowedRegionIds.length === 1) {
                eventRegionSelect.value = currentAllowedRegionIds[0];
                eventRegionSelect.disabled = true;
            }
        } else {
            eventRegionSelect.value = '';
        }
    }

    if (eventChurchWrapper && eventChurchSelect) {
        eventChurchWrapper.classList.toggle('hidden', !needsChurch);
        eventChurchSelect.required = needsChurch;
        eventChurchSelect.disabled = !needsChurch;
        if (needsChurch) {
            populateChurchOptions(preserveSelections ? currentChurch : '');
            if (isLocalRole() && currentChurchId) {
                eventChurchSelect.value = currentChurchId;
                eventChurchSelect.disabled = true;
            }
        } else {
            eventChurchSelect.value = '';
        }
    }

    if (scope === 'GLOBAL') {
        eventCountryInput.value = '';
        eventCountryInput.disabled = true;
    } else if (scope === 'REGIONAL') {
        syncCountryFromRegion();
        eventCountryInput.disabled = true;
        if (!isAdminRole() && currentCountry) eventCountryInput.value = currentCountry;
    } else if (!isAdminRole()) {
        eventCountryInput.disabled = true;
        if (currentCountry) eventCountryInput.value = currentCountry;
    } else {
        eventCountryInput.disabled = false;
    }

    updateEventPreview();
}

function syncScopeOptions() {
    if (!eventScopeSelect) return;
    const allowedScopes = getAllowedScopes();
    eventScopeSelect.querySelectorAll('option').forEach((option) => {
        option.hidden = !allowedScopes.includes(option.value);
    });
    eventScopeSelect.disabled = allowedScopes.length === 0;
    if (allowedScopes.length && !allowedScopes.includes(eventScopeSelect.value)) {
        eventScopeSelect.value = allowedScopes[0];
    }
    syncScopeInputs({ preserveSelections: true });
}

function getEventScope(event) {
    return String(event?.scope || '').toUpperCase();
}

function canEditEvent(event) {
    if (!event || !hasAnyEventManagementPermission()) return false;
    const scope = getEventScope(event);

    if (scope === 'GLOBAL') return hasPermission('can_manage_global_events');
    if (scope === 'NATIONAL') return hasPermission('can_manage_national_events') && (isAdminRole() || sameCountry(event.country, currentCountry));
    if (scope === 'REGIONAL') {
        if (!hasPermission('can_manage_regional_events')) return false;
        if (isAdminRole()) return true;
        if (isRegionalRole()) return Boolean(event.region_id && currentAllowedRegionIds.includes(event.region_id));
        return isNationalRole() && sameCountry(event.country, currentCountry);
    }
    if (scope !== 'LOCAL' || !hasPermission('can_manage_local_events')) return false;
    if (isAdminRole()) return true;

    const churchId = String(event.church_id || '').trim();
    if (!churchId) return false;
    if (currentChurchId && churchId === currentChurchId) return true;
    const church = churchesById.get(churchId);
    if (!church) return false;
    if (isRegionalRole()) {
        return church.region_id
            ? currentAllowedRegionIds.includes(church.region_id)
            : sameCountry(church.country, currentCountry);
    }
    return isNationalRole() && sameCountry(church.country, currentCountry);
}

function getLifecycle(event, now = Date.now()) {
    const status = String(event?.status || 'PUBLISHED').toUpperCase();
    if (status === 'ARCHIVED') return 'archived';
    if (status === 'DRAFT') return 'draft';

    const start = new Date(event?.start_date || '').getTime();
    const end = new Date(event?.end_date || event?.start_date || '').getTime();
    if (!Number.isFinite(start)) return 'upcoming';
    if (now < start) return 'upcoming';
    if (Number.isFinite(end) && now <= end) return 'live';
    return 'completed';
}

function formatEventDate(event) {
    const start = new Date(event?.start_date || '');
    if (Number.isNaN(start.getTime())) return 'Fecha por definir';
    const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(start);
    const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(start);
    return `${date}, ${time}`;
}

function getLocationLabel(event) {
    return [event?.location_name, event?.city, event?.country].filter(Boolean).join(' · ') || 'Lugar por definir';
}

function getEventEconomyLabel(event) {
    const price = Number(event?.price || 0);
    if (price <= 0) return 'Gratuito';
    const currency = String(event?.currency || 'COP').toUpperCase();
    try {
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency,
            maximumFractionDigits: currency === 'COP' ? 0 : 2,
        }).format(price);
    } catch {
        return `${currency} ${price.toLocaleString('es-CO')}`;
    }
}

function getEventRegistrationLabel(event) {
    const mode = String(event?.registration_mode || 'NONE').toUpperCase();
    if (mode === 'EXTERNAL') return 'Registro externo';
    if (mode === 'INTERNAL') return 'Registro interno';
    return 'Sin registro';
}

function getFilteredEvents() {
    const query = String(eventSearch?.value || '').trim().toLowerCase();
    const scope = String(eventScopeFilter?.value || '').toUpperCase();

    return eventsCache.filter((event) => {
        const lifecycle = getLifecycle(event);
        const matchesLifecycle = currentFilter === 'active'
            ? lifecycle === 'upcoming' || lifecycle === 'live'
            : lifecycle === currentFilter;
        if (!matchesLifecycle) return false;
        if (scope && getEventScope(event) !== scope) return false;
        if (!query) return true;
        const haystack = `${event.title || ''} ${event.description || ''} ${getLocationLabel(event)}`.toLowerCase();
        return haystack.includes(query);
    });
}

function updateStatsAndCounts() {
    const counts = { active: 0, upcoming: 0, live: 0, completed: 0, draft: 0, archived: 0 };
    eventsCache.forEach((event) => {
        const lifecycle = getLifecycle(event);
        counts[lifecycle] += 1;
        if (lifecycle === 'upcoming' || lifecycle === 'live') counts.active += 1;
    });

    document.querySelectorAll('[data-filter-count]').forEach((node) => {
        node.textContent = String(counts[node.dataset.filterCount] || 0);
    });
    const visible = eventsCache.filter((event) => String(event.status || '').toUpperCase() === 'PUBLISHED').length;
    const values = {
        'event-stat-visible': visible,
        'event-stat-upcoming': counts.upcoming,
        'event-stat-completed': counts.completed,
        'event-stat-drafts': counts.draft,
    };
    Object.entries(values).forEach(([id, value]) => {
        const node = document.getElementById(id);
        if (node) node.textContent = String(value);
    });
}

function lifecycleAction(event, lifecycle) {
    if (!canEditEvent(event)) return '';
    const eventId = escapeAttr(event.id || '');
    if (lifecycle === 'archived') {
        return `<button type="button" class="event-status-action event-action" data-event-id="${eventId}" data-event-status="PUBLISHED">${icon(archiveRestoreIconUrl)} Restaurar</button>`;
    }
    if (lifecycle === 'draft') {
        return `<button type="button" class="event-status-action event-action event-action-primary" data-event-id="${eventId}" data-event-status="PUBLISHED">${icon(sendIconUrl)} Publicar</button>`;
    }
    return `<button type="button" class="event-status-action event-action" data-event-id="${eventId}" data-event-status="ARCHIVED">${icon(archiveIconUrl)} Archivar</button>`;
}

function renderEvents() {
    if (!eventsList || !eventsEmpty || !eventsLoading) return;
    updateStatsAndCounts();
    const events = getFilteredEvents();

    eventsLoading.classList.add('hidden');
    eventsList.classList.toggle('hidden', events.length === 0);
    eventsEmpty.classList.toggle('hidden', events.length > 0);

    eventsList.innerHTML = events.map((event) => {
        const lifecycle = getLifecycle(event);
        const bannerUrl = sanitizeUrl(event.banner_url);
        const start = new Date(event.start_date || '');
        const month = Number.isNaN(start.getTime()) ? 'EVENTO' : new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(start).replace('.', '').toUpperCase();
        const day = Number.isNaN(start.getTime()) ? '—' : String(start.getDate());
        const media = bannerUrl
            ? `<img src="${escapeAttr(bannerUrl)}" alt="" loading="lazy" decoding="async" class="h-24 w-full object-cover sm:h-28 sm:w-36" />`
            : `<div class="flex h-24 w-full flex-col items-center justify-center bg-[#293C74] text-white sm:h-28 sm:w-28"><span class="text-xs font-bold text-white">${escapeHtml(month)}</span><strong class="text-3xl leading-none text-white">${escapeHtml(day)}</strong></div>`;
        const description = event.description ? `<p class="mt-1 line-clamp-1 text-sm text-slate-500">${escapeHtml(event.description)}</p>` : '';
        const editAction = canEditEvent(event)
            ? `<button type="button" class="event-edit event-action" data-event-id="${escapeAttr(event.id || '')}">${icon(pencilIconUrl)} Editar</button>`
            : '';
        const publicPath = String(event.status || '').toUpperCase() === 'PUBLISHED' && event.visibility !== 'PRIVATE'
            ? getPublicEventPath(event)
            : '';
        const publicAction = publicPath
            ? `<a href="${escapeAttr(publicPath)}" target="_blank" rel="noopener noreferrer" class="event-action">${icon(externalLinkIconUrl)} Ver invitación</a>`
            : '';

        return `
          <article class="portal-panel overflow-hidden" data-event-row="${escapeAttr(event.id || '')}">
            <div class="flex flex-col sm:flex-row">
              <div class="flex-none bg-slate-100">${media}</div>
              <div class="min-w-0 flex-1 p-4 sm:px-5">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      <span class="portal-chip ${LIFECYCLE_TONES[lifecycle]}">${escapeHtml(LIFECYCLE_LABELS[lifecycle])}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(SCOPE_LABELS[getEventScope(event)] || getEventScope(event))}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(getEventEconomyLabel(event))}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(getEventRegistrationLabel(event))}</span>
                    </div>
                    <h2 class="truncate text-lg font-bold text-[#293C74]">${escapeHtml(event.title || 'Evento')}</h2>
                    ${description}
                    <div class="mt-3 flex flex-col gap-1 text-sm text-slate-600 md:flex-row md:flex-wrap md:gap-x-5">
                      <span class="inline-flex min-w-0 items-center gap-2">${icon(calendarIconUrl)} ${escapeHtml(formatEventDate(event))}</span>
                      <span class="inline-flex min-w-0 items-center gap-2">${icon(mapPinIconUrl)} <span class="truncate">${escapeHtml(getLocationLabel(event))}</span></span>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                    <a href="/portal/events/${escapeAttr(event.id || '')}" class="event-action event-action-primary">Abrir operación</a>
                    ${publicAction}
                    ${editAction}
                    ${lifecycleAction(event, lifecycle)}
                  </div>
                </div>
              </div>
            </div>
          </article>
        `;
    }).join('');
}

async function loadProfile(auth) {
    const { ok, data } = await getPortalSession({ auth });
    if (!ok || !data?.ok) throw new Error(data?.error || 'No se pudo validar el perfil.');
    const profile = data.profile || {};
    const scopeContext = data.scope_context || {};
    currentRole = profile.effective_role || profile.role || 'user';
    currentCountry = scopeContext.allowed_country || profile.country || '';
    currentChurchId = scopeContext.allowed_church_id || profile.church_id || profile.portal_church_id || '';
    currentAllowedRegionIds = Array.isArray(scopeContext.allowed_region_ids) ? scopeContext.allowed_region_ids.filter(Boolean) : [];
    currentPermissions = { ...currentPermissions, ...(data.permissions || {}) };
    btnNewEvent?.classList.toggle('hidden', !canEditAnyEvent());
}

async function loadChurchesCatalog() {
    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/churches', { credentials: 'include' }, REQUEST_TIMEOUT_MS, 'La carga de iglesias');
        churchesCatalog = res.ok && Array.isArray(data) ? data : [];
    } catch {
        churchesCatalog = [];
    }
    churchesById.clear();
    churchesCatalog.forEach((church) => church?.id && churchesById.set(church.id, church));
}

async function loadRegionsCatalog() {
    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/regions', { headers: authHeaders, credentials: 'include' }, REQUEST_TIMEOUT_MS, 'La carga de regiones');
        regionsCatalog = res.ok && Array.isArray(data?.regions) ? data.regions : [];
    } catch {
        regionsCatalog = [];
    }
    regionsById.clear();
    regionsCatalog.forEach((region) => region?.id && regionsById.set(region.id, region));
}

async function loadEvents(shouldRender = true) {
    if (!eventsLoading || !eventsList || !eventsEmpty) return;
    eventsLoading.classList.remove('hidden');
    eventsList.classList.add('hidden');
    eventsEmpty.classList.add('hidden');

    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/events', { headers: authHeaders, credentials: 'include' }, REQUEST_TIMEOUT_MS, 'La carga de eventos');
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar eventos');
        eventsCache = Array.isArray(data.events) ? data.events : [];
        eventPlatformReady = data.platform_ready === true;
        eventFinanceReady = data.finance_ready === true;
        syncPlatformFields();
        syncFinanceFields();
        if (shouldRender) renderEvents();
    } catch (error) {
        showEventsError(error);
        throw error;
    }
}

function toInputDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function updateEventPreview() {
    if (!eventForm) return;
    const value = (name) => String(eventForm.querySelector(`[name="${name}"]`)?.value || '').trim();
    const title = value('title');
    const description = value('description');
    const scope = value('scope').toUpperCase() || 'LOCAL';
    const status = value('status').toUpperCase() || 'DRAFT';
    const start = new Date(value('start_date'));
    const imageUrl = sanitizeUrl(value('banner_url'));
    const location = [value('location_name'), value('city'), value('country')].filter(Boolean).join(' · ');
    const price = Number(value('price') || 0);
    const currency = value('currency').toUpperCase() || 'COP';

    if (previewTitle) previewTitle.textContent = title || 'Título del evento';
    if (previewDescription) previewDescription.textContent = description || 'La descripción aparecerá aquí.';
    if (previewScope) previewScope.textContent = SCOPE_LABELS[scope] || scope;
    if (previewStatus) {
        previewStatus.textContent = status === 'PUBLISHED' ? 'Publicado' : status === 'ARCHIVED' ? 'Archivado' : 'Borrador';
        previewStatus.className = `portal-chip ${status === 'PUBLISHED' ? 'bg-teal-50 text-teal-700' : status === 'ARCHIVED' ? 'bg-slate-200 text-slate-600' : 'bg-amber-50 text-amber-700'}`;
    }
    if (previewDate) {
        previewDate.innerHTML = Number.isNaN(start.getTime())
            ? '<span class="block text-xs font-bold uppercase text-slate-500">Fecha</span><strong class="block text-lg text-[#293C74]">Por definir</strong>'
            : `<span class="block text-xs font-bold uppercase text-slate-500">${escapeHtml(new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(start))}</span><strong class="block text-2xl leading-none text-[#293C74]">${escapeHtml(start.getDate())}</strong>`;
    }
    if (previewLocation) previewLocation.textContent = location || 'Lugar por definir';
    if (previewPrice) {
        previewPrice.textContent = price > 0
            ? new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: currency === 'COP' ? 0 : 2 }).format(price)
            : 'Evento gratuito';
    }
    if (previewImage) {
        previewImage.classList.toggle('hidden', !imageUrl);
        previewImage.src = imageUrl || '';
        previewImage.alt = imageUrl ? title || 'Imagen del evento' : '';
    }
    syncRegistrationFields();
}

function openEventModal(mode, eventData = null) {
    if (!eventModal || !eventForm) return;
    eventForm.reset();
    showFormError();
    if (eventIdInput) eventIdInput.value = eventData?.id || '';
    if (eventModalTitle) eventModalTitle.textContent = mode === 'edit' ? 'Editar evento' : 'Nuevo evento';
    if (eventSubmitBtn) eventSubmitBtn.textContent = mode === 'edit' ? 'Guardar cambios' : 'Guardar evento';
    const archivedOption = eventStatusSelect?.querySelector('option[value="ARCHIVED"]');
    if (archivedOption) {
        archivedOption.hidden = mode !== 'edit';
        archivedOption.disabled = mode !== 'edit';
    }

    const fieldValues = {
        title: eventData?.title || '',
        description: eventData?.description || '',
        start_date: toInputDateTime(eventData?.start_date),
        end_date: toInputDateTime(eventData?.end_date),
        location_name: eventData?.location_name || '',
        location_address: eventData?.location_address || '',
        city: eventData?.city || '',
        country: eventData?.country || '',
        banner_url: eventData?.banner_url || '',
        status: String(eventData?.status || 'DRAFT').toUpperCase(),
        slug: eventData?.slug || '',
        visibility: String(eventData?.visibility || 'UNLISTED').toUpperCase(),
        category: eventData?.category || '',
        registration_mode: String(eventData?.registration_mode || 'NONE').toUpperCase(),
        registration_url: eventData?.registration_url || '',
        registration_opens_at: toInputDateTime(eventData?.registration_opens_at),
        registration_closes_at: toInputDateTime(eventData?.registration_closes_at),
        capacity: eventData?.capacity ?? '',
        contact_email: eventData?.contact_email || '',
        price: eventData?.price ?? 0,
        currency: String(eventData?.currency || 'COP').toUpperCase(),
        attendance_mode: String(eventData?.attendance_mode || 'IN_PERSON').toUpperCase(),
        pricing_model: String(eventData?.pricing_model || (Number(eventData?.price || 0) > 0 ? 'PAID' : 'FREE')).toUpperCase(),
    };
    Object.entries(fieldValues).forEach(([name, value]) => {
        const field = eventForm.querySelector(`[name="${name}"]`);
        if (field) field.value = value;
    });
    const approvalField = eventForm.querySelector('[name="registration_requires_approval"]');
    if (approvalField) approvalField.checked = Boolean(eventData?.registration_requires_approval);

    const presetScope = String(eventData?.scope || getAllowedScopes()[0] || 'LOCAL').toUpperCase();
    if (eventScopeSelect) eventScopeSelect.value = presetScope;
    syncScopeOptions();

    if (eventRegionSelect && eventData?.region_id && [...eventRegionSelect.options].some((option) => option.value === eventData.region_id)) {
        eventRegionSelect.value = eventData.region_id;
    }
    if (eventChurchSelect && eventData?.church_id && [...eventChurchSelect.options].some((option) => option.value === eventData.church_id)) {
        eventChurchSelect.value = eventData.church_id;
    }
    syncScopeInputs({ preserveSelections: true });
    syncPlatformFields();
    syncFinanceFields();
    updateEventPreview();

    eventModal.classList.remove('hidden');
    eventModal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    void loadEventPaymentOption(eventData);
    window.setTimeout(() => eventForm.querySelector('[name="title"]')?.focus(), 0);
}

function closeEventModal() {
    if (!eventModal) return;
    eventModal.classList.add('hidden');
    eventModal.classList.remove('flex');
    document.body.style.overflow = '';
    showFormError();
}

async function changeEventStatus(eventId, status) {
    const event = eventsCache.find((item) => item.id === eventId);
    if (!event || !canEditEvent(event)) return;

    if (status === 'ARCHIVED' && !window.confirm('Archivar oculta el evento de la operación diaria, pero conserva su información. ¿Continuar?')) return;

    const button = eventsList?.querySelector(`[data-event-id="${CSS.escape(eventId)}"][data-event-status]`);
    if (button) button.disabled = true;
    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            credentials: 'include',
            body: JSON.stringify({ id: eventId, status }),
        }, REQUEST_TIMEOUT_MS, 'El cambio de estado');
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo cambiar el estado.');
        eventsCache = eventsCache.map((item) => item.id === eventId ? data.event : item);
        renderEvents();
    } catch (error) {
        window.alert(error?.message || 'No se pudo cambiar el estado.');
        if (button) button.disabled = false;
    }
}

eventFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-event-filter]');
    if (!button) return;
    currentFilter = button.dataset.eventFilter || 'active';
    eventFilters.querySelectorAll('[data-event-filter]').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
    });
    renderEvents();
});

eventSearch?.addEventListener('input', renderEvents);
eventScopeFilter?.addEventListener('change', renderEvents);
btnNewEvent?.addEventListener('click', () => openEventModal('create'));
closeModal?.addEventListener('click', closeEventModal);
eventCancel?.addEventListener('click', closeEventModal);
eventModal?.addEventListener('click', (event) => {
    if (event.target === eventModal) closeEventModal();
});

eventsList?.addEventListener('click', (event) => {
    const editButton = event.target.closest('.event-edit');
    if (editButton) {
        const eventData = eventsCache.find((item) => item.id === editButton.dataset.eventId);
        if (eventData) openEventModal('edit', eventData);
        return;
    }
    const statusButton = event.target.closest('.event-status-action');
    if (statusButton) void changeEventStatus(statusButton.dataset.eventId, statusButton.dataset.eventStatus);
});

eventScopeSelect?.addEventListener('change', () => syncScopeInputs({ preserveSelections: true }));
eventRegionSelect?.addEventListener('change', () => {
    syncCountryFromRegion();
    updateEventPreview();
});
eventRegistrationMode?.addEventListener('change', () => {
    syncRegistrationFields();
    syncFinanceFields();
});
eventManualPaymentEnabled?.addEventListener('change', syncManualPaymentFields);
eventManualPaymentKind?.addEventListener('change', syncManualPaymentFields);
eventManualPaymentQr?.addEventListener('change', () => {
    if (manualQrPreviewObjectUrl) URL.revokeObjectURL(manualQrPreviewObjectUrl);
    manualQrPreviewObjectUrl = '';
    const file = eventManualPaymentQr.files?.[0];
    if (!eventManualPaymentQrPreview) return;
    if (!file) {
        eventManualPaymentQrPreview.classList.toggle('hidden', !eventManualPaymentQrPreview.getAttribute('src'));
        return;
    }
    manualQrPreviewObjectUrl = URL.createObjectURL(file);
    eventManualPaymentQrPreview.src = manualQrPreviewObjectUrl;
    eventManualPaymentQrPreview.classList.remove('hidden');
});
eventPricingModel?.addEventListener('change', () => {
    syncFinanceFields();
    updateEventPreview();
});
eventForm?.querySelector('[name="currency"]')?.addEventListener('change', () => {
    if (eventOnlineProvider?.value === 'WOMPI' && eventForm.querySelector('[name="currency"]')?.value !== 'COP') {
        eventOnlineProvider.value = 'NONE';
    }
});
eventForm?.addEventListener('input', updateEventPreview);
eventForm?.addEventListener('change', updateEventPreview);

eventForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!eventSubmitBtn) return;
    showFormError();
    const originalText = eventSubmitBtn.textContent;
    eventSubmitBtn.textContent = 'Guardando...';
    eventSubmitBtn.disabled = true;

    try {
        const formData = new FormData(eventForm);
        const payload = Object.fromEntries(formData.entries());
        const approvalField = eventForm.querySelector('[name="registration_requires_approval"]');
        if (eventFinanceReady && approvalField) {
            payload.registration_requires_approval = approvalField.checked;
        }
        const eventId = String(payload.id || '');
        delete payload.id;
        Object.keys(payload).forEach((key) => {
            if (payload[key] === '') delete payload[key];
        });

        const start = new Date(payload.start_date || '');
        const end = payload.end_date ? new Date(payload.end_date) : null;
        if (Number.isNaN(start.getTime())) throw new Error('Selecciona una fecha de inicio válida.');
        if (end && (Number.isNaN(end.getTime()) || end.getTime() < start.getTime())) {
            throw new Error('La fecha de fin debe ser posterior al inicio.');
        }
        payload.start_date = start.toISOString();
        if (end) payload.end_date = end.toISOString();
        ['registration_opens_at', 'registration_closes_at'].forEach((field) => {
            if (!payload[field]) return;
            const isoValue = toIsoDateTime(payload[field]);
            if (!isoValue) throw new Error('Revisa las fechas de apertura y cierre de inscripciones.');
            payload[field] = isoValue;
        });
        if (
            eventFinanceReady
            && payload.registration_mode === 'INTERNAL'
            && payload.pricing_model !== 'FREE'
            && (!eventOnlineProvider || eventOnlineProvider.value === 'NONE')
            && !eventManualPaymentEnabled?.checked
        ) {
            throw new Error('Selecciona un cobro automático o activa un pago verificado manualmente.');
        }
        if (eventFinanceReady && eventManualPaymentEnabled?.checked) {
            const manualKind = String(eventManualPaymentKind?.value || '').toUpperCase();
            if (String(eventManualPaymentLabel?.value || '').trim().length < 3) {
                throw new Error('Escribe el nombre visible del pago manual.');
            }
            if (String(eventManualPaymentInstructions?.value || '').trim().length < 5) {
                throw new Error('Escribe las instrucciones del pago manual.');
            }
            if (manualKind === 'QR_TRANSFER' && !eventManualPaymentQr?.files?.[0] && !eventManualPaymentQrPath?.value) {
                throw new Error('Sube la imagen del código QR.');
            }
            if (manualKind === 'EXTERNAL' && !String(eventManualPaymentUrl?.value || '').trim().startsWith('https://')) {
                throw new Error('El enlace de pago manual debe comenzar por https://');
            }
        }

        const { res, data } = await fetchJsonWithTimeout('/api/portal/events', {
            method: eventId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            credentials: 'include',
            body: JSON.stringify(eventId ? { id: eventId, ...payload } : payload),
        }, REQUEST_TIMEOUT_MS, 'El guardado del evento');
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el evento.');

        const savedEvent = data.event;
        if (eventId) {
            eventsCache = eventsCache.map((item) => item.id === eventId ? savedEvent : item);
        } else {
            eventsCache = [...eventsCache, savedEvent];
        }
        if (eventFinanceReady && savedEvent?.id && eventOnlineProvider) {
            try {
                const provider = payload.registration_mode === 'INTERNAL' && payload.pricing_model !== 'FREE'
                    ? eventOnlineProvider.value || 'NONE'
                    : 'NONE';
                await saveEventPaymentOption(savedEvent.id, provider);
                await saveManualPaymentOption(savedEvent.id);
            } catch (paymentError) {
                if (eventIdInput) eventIdInput.value = savedEvent.id;
                if (eventModalTitle) eventModalTitle.textContent = 'Editar evento';
                renderEvents();
                showFormError(`El evento quedó guardado, pero ${paymentError?.message || 'no se pudo configurar el cobro.'}`);
                return;
            }
        }
        closeEventModal();
        renderEvents();
    } catch (error) {
        showFormError(error?.message || 'No se pudo guardar el evento.');
    } finally {
        eventSubmitBtn.textContent = originalText;
        eventSubmitBtn.disabled = false;
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && eventModal?.classList.contains('flex')) closeEventModal();
});

async function init() {
    try {
        showGate();
        const auth = await ensureAuthenticated();
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }
        authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
        await loadProfile(auth);
        if (!hasAnyEventManagementPermission()) {
            window.location.replace('/portal');
            return;
        }

        eventPermissionValidated = true;
        showSecureContent();
        await Promise.all([loadChurchesCatalog(), loadRegionsCatalog(), loadEvents(false)]);
        syncScopeOptions();
        renderEvents();
    } catch (error) {
        console.error('[portal-events] init error', error);
        if (eventPermissionValidated) {
            showSecureContent();
            if (!eventsLoading?.querySelector('#btn-retry-events')) showEventsError(error);
        } else {
            showGate(error?.message || 'No se pudieron validar permisos.');
        }
    }
}

init();
