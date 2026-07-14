import archiveIconUrl from 'lucide-static/icons/archive.svg?url';
import archiveRestoreIconUrl from 'lucide-static/icons/archive-restore.svg?url';
import calendarIconUrl from 'lucide-static/icons/calendar-days.svg?url';
import externalLinkIconUrl from 'lucide-static/icons/external-link.svg?url';
import mapPinIconUrl from 'lucide-static/icons/map-pin.svg?url';
import pencilIconUrl from 'lucide-static/icons/pencil.svg?url';
import sendIconUrl from 'lucide-static/icons/send.svg?url';
import flatpickr from 'flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es.js';
import 'flatpickr/dist/flatpickr.min.css';
import {
    ensureAuthenticated,
    getPortalSession,
    redirectToLogin,
    refreshPortalAuthentication,
} from '@lib/portalAuthClient';
import {
    DEFAULT_EVENT_ATTENDANCE_MODE,
    DEFAULT_EVENT_TIMEZONE,
    normalizeAttendanceMode as normalizeEventAttendanceMode,
    normalizeEventTimeZone as normalizeContractTimeZone,
} from '@lib/eventContract.js';
import {
    canUseEventPaymentModeForScope,
    getEventProviderPrice,
    getRequiredEventProviderCurrency,
    normalizeEventOnlinePaymentMode,
    normalizeEventOnlinePaymentProvider,
} from '@lib/eventPaymentContract.js';
import { normalizeEventInvitationLayout } from '@lib/eventInvitationLayout.js';
import {
    EVENT_CUSTOM_FIELD_TYPES,
    MAX_EVENT_CUSTOM_FIELDS,
    isEventCustomChoiceField,
    normalizeEventRegistrationFormConfig,
} from '@lib/eventRegistrationForm.js';

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
const eventTitleInput = eventForm?.querySelector('[name="title"]');
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
const eventPriceCopInput = document.getElementById('event-price-cop');
const eventPriceUsdInput = document.getElementById('event-price-usd');
const eventCurrencyInput = document.getElementById('event-currency');
const eventSinglePriceSettings = document.getElementById('event-single-price-settings');
const eventDualPriceSettings = document.getElementById('event-dual-price-settings');
const eventOnlineProvider = document.getElementById('event-online-provider');
const eventOnlineProviderDual = document.getElementById('event-online-provider-dual');
const eventOnlineProviderHint = document.getElementById('event-online-provider-hint');
const eventOnlineProviderWrapper = document.getElementById('event-online-provider-wrapper');
const eventRegistrationMode = document.getElementById('event-registration-mode');
const eventRegistrationFormSettings = document.getElementById('event-registration-form-settings');
const eventRegistrationPhoneMode = document.getElementById('event-registration-phone-mode');
const eventRegistrationCollectChurch = document.getElementById('event-registration-collect-church');
const eventRegistrationWhatsAppUpdates = document.getElementById('event-registration-whatsapp-updates');
const eventCustomFieldsContainer = document.getElementById('event-custom-fields');
const eventCustomFieldAdd = document.getElementById('event-custom-field-add');
const eventCustomFieldEmpty = document.getElementById('event-custom-field-empty');
const eventRegistrationUrlWrapper = document.getElementById('event-registration-url-wrapper');
const eventRegistrationWindow = document.getElementById('event-registration-window');
const eventCapacityWrapper = document.getElementById('event-capacity-wrapper');
const eventSlugInput = document.getElementById('event-slug');
const eventSlugHint = document.getElementById('event-slug-hint');
const eventFinanceRegistrationHint = document.getElementById('event-finance-registration-hint');
const eventManualPaymentEnabled = document.getElementById('event-manual-payment-enabled');
const eventManualPaymentPanel = document.getElementById('event-manual-payment-panel');
const eventManualPaymentHint = document.getElementById('event-manual-payment-hint');
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
const eventInvitationImage = document.getElementById('event-invitation-image');
const eventInvitationImageDropzone = document.getElementById('event-invitation-image-dropzone');
const eventInvitationImageStatus = document.getElementById('event-invitation-image-status');
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
const MIN_EVENT_YEAR = 2000;
const MAX_EVENT_YEAR = 2100;
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

function normalizeAttendanceMode(value) {
    return normalizeEventAttendanceMode(value, DEFAULT_EVENT_ATTENDANCE_MODE);
}

function normalizeEventTimeZone(value) {
    return normalizeContractTimeZone(value, DEFAULT_EVENT_TIMEZONE);
}

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
let eventDualFinanceReady = false;
let manualQrPreviewObjectUrl = '';
let invitationImagePreviewObjectUrl = '';
let pendingInvitationImageFile = null;
let eventSlugManuallyEdited = false;
let eventCustomFields = [];
let eventFormDirty = false;
let eventModalReturnFocus = null;
const eventDatePickers = new Map();

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

function normalizeEventSlug(value, { trimTrailing = true } = {}) {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/g, '')
        .slice(0, 180);
    return trimTrailing ? normalized.replace(/-+$/g, '') : normalized;
}

function syncSlugInput({ finalize = false } = {}) {
    if (!eventSlugInput) return;
    const normalized = normalizeEventSlug(eventSlugInput.value, { trimTrailing: finalize });
    const finalSlug = normalizeEventSlug(normalized);
    if (eventSlugInput.value !== normalized) eventSlugInput.value = normalized;
    if (eventSlugHint) {
        eventSlugHint.textContent = finalSlug
            ? `Enlace final: /eventos/${finalSlug}`
            : 'Los espacios se convierten automáticamente en guiones.';
    }
}

function getDateTimeYear(value) {
    const match = /^(\d{4,})-/.exec(String(value || '').trim());
    return match ? Number(match[1]) : null;
}

function getDateTimeError(value, label, required = false) {
    const raw = String(value || '').trim();
    if (!raw) return required ? `Selecciona la fecha de ${label}.` : null;
    const year = getDateTimeYear(raw);
    if (year === null || year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR) {
        return `La fecha de ${label} debe tener un año entre ${MIN_EVENT_YEAR} y ${MAX_EVENT_YEAR}.`;
    }
    return null;
}

function syncDatePickerDisabledState() {
    eventDatePickers.forEach((picker) => {
        if (picker?._input) picker._input.disabled = Boolean(picker.input?.disabled);
    });
}

function setEventDateTimeValue(name, value) {
    const picker = eventDatePickers.get(name);
    const field = eventForm?.querySelector(`[name="${name}"]`);
    if (picker) {
        picker.setDate(value || null, false, 'Y-m-d\\TH:i');
    } else if (field) {
        field.value = value || '';
    }
}

function initEventDatePickers() {
    eventForm?.querySelectorAll('.js-event-datetime').forEach((input) => {
        const name = String(input.name || '');
        if (!name || eventDatePickers.has(name)) return;
        const picker = flatpickr(input, {
            locale: Spanish,
            enableTime: true,
            time_24hr: true,
            minuteIncrement: 5,
            dateFormat: 'Y-m-d\\TH:i',
            altInput: true,
            altInputClass: 'event-datetime-display',
            altFormat: 'd/m/Y · H:i',
            allowInput: true,
            disableMobile: true,
            minDate: `${MIN_EVENT_YEAR}-01-01`,
            maxDate: `${MAX_EVENT_YEAR}-12-31 23:59`,
            monthSelectorType: 'static',
            position: 'auto left',
            onReady: (_dates, _value, instance) => {
                instance.calendarContainer.classList.add('event-calendar');
                if (instance._input) instance._input.placeholder = input.placeholder || 'Selecciona fecha y hora';
                const confirmButton = document.createElement('button');
                confirmButton.type = 'button';
                confirmButton.className = 'event-calendar-confirm';
                confirmButton.textContent = 'Listo';
                confirmButton.addEventListener('click', () => {
                    instance.close();
                    updateEventPreview();
                });
                instance.calendarContainer.append(confirmButton);
            },
            onChange: () => updateEventPreview(),
            onClose: () => updateEventPreview(),
        });
        eventDatePickers.set(name, picker);
    });
    syncDatePickerDisabledState();
}

function parseMoneyInput(value, currency = 'COP') {
    const raw = String(value || '').trim().replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
    if (!raw) return 0;
    if (currency === 'COP') {
        const digits = raw.replace(/[^0-9-]/g, '');
        const amount = Number(digits);
        return Number.isFinite(amount) ? amount : NaN;
    }
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    let normalized = raw;
    if (lastComma >= 0 && lastDot >= 0) {
        const decimalSeparator = lastComma > lastDot ? ',' : '.';
        const groupingSeparator = decimalSeparator === ',' ? /\./g : /,/g;
        normalized = raw.replace(groupingSeparator, '').replace(decimalSeparator, '.');
    } else if (lastComma >= 0) {
        normalized = raw.replace(/\./g, '').replace(',', '.');
    } else if (lastDot >= 0) {
        const decimals = raw.length - lastDot - 1;
        normalized = decimals <= 2 ? raw.replace(/,/g, '') : raw.replace(/[.,]/g, '');
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : NaN;
}

function setMoneyCaretFromDigits(input, digitsBeforeCaret) {
    if (!input || !Number.isFinite(digitsBeforeCaret)) return;
    if (digitsBeforeCaret <= 0) {
        input.setSelectionRange(0, 0);
        return;
    }
    let digitsSeen = 0;
    let position = input.value.length;
    for (let index = 0; index < input.value.length; index += 1) {
        if (/\d/.test(input.value[index])) digitsSeen += 1;
        if (digitsSeen >= digitsBeforeCaret) {
            position = index + 1;
            break;
        }
    }
    input.setSelectionRange(position, position);
}

function formatMoneyField(input, currency, { preserveCaret = false } = {}) {
    if (!input) return;
    if (!String(input.value || '').trim()) return;
    const selectionStart = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = input.value.slice(0, selectionStart).replace(/\D/g, '').length;
    const amount = parseMoneyInput(input.value, currency);
    if (!Number.isFinite(amount)) return;
    input.value = new Intl.NumberFormat('es-CO', {
        minimumFractionDigits: currency === 'COP' ? 0 : 2,
        maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(amount);
    if (preserveCaret && currency === 'COP') setMoneyCaretFromDigits(input, digitsBeforeCaret);
}

function formatMoneyInput({ preserveCaret = false } = {}) {
    const currency = String(eventForm?.querySelector('[name="currency"]')?.value || 'COP').toUpperCase();
    formatMoneyField(eventPriceInput, currency, { preserveCaret });
    formatMoneyField(eventPriceCopInput, 'COP', { preserveCaret });
    formatMoneyField(eventPriceUsdInput, 'USD');
}

function syncDedicatedPriceFromSingle() {
    const mode = normalizeEventOnlinePaymentMode(eventOnlineProvider?.value);
    if (mode === 'WOMPI' && eventPriceCopInput && eventPriceInput) {
        eventPriceCopInput.value = eventPriceInput.value;
    }
    if (mode === 'STRIPE' && eventPriceUsdInput && eventPriceInput) {
        eventPriceUsdInput.value = eventPriceInput.value;
    }
}

function preparePriceFieldsForPaymentMode(mode) {
    const normalizedMode = normalizeEventOnlinePaymentMode(mode);
    if (normalizedMode === 'DUAL') {
        const currency = String(eventCurrencyInput?.value || 'COP').toUpperCase();
        if (currency === 'COP' && eventPriceCopInput && !eventPriceCopInput.value) {
            eventPriceCopInput.value = eventPriceInput?.value || '';
        }
        if (currency === 'USD' && eventPriceUsdInput && !eventPriceUsdInput.value) {
            eventPriceUsdInput.value = eventPriceInput?.value || '';
        }
        return;
    }
    if (normalizedMode === 'WOMPI' && eventPriceInput) {
        eventPriceInput.value = eventPriceCopInput?.value || '';
    }
    if (normalizedMode === 'STRIPE' && eventPriceInput) {
        eventPriceInput.value = eventPriceUsdInput?.value || '';
    }
}

const CUSTOM_FIELD_TYPE_LABELS = {
    SHORT_TEXT: 'Respuesta corta',
    LONG_TEXT: 'Respuesta abierta',
    SINGLE_CHOICE: 'Una opción',
    MULTIPLE_CHOICE: 'Varias opciones',
    YES_NO: 'Sí o no',
    DATE: 'Fecha',
};

function createCustomFieldId() {
    const raw = window.crypto?.randomUUID?.().replace(/-/g, '')
        || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `field_${raw.slice(0, 24).toLowerCase()}`;
}

function createCustomField() {
    return {
        id: createCustomFieldId(),
        type: 'SHORT_TEXT',
        label: '',
        help_text: '',
        required: false,
        options: [],
    };
}

function getCustomFieldIndex(target) {
    const card = target?.closest?.('[data-custom-field-index]');
    const index = Number(card?.dataset.customFieldIndex);
    return Number.isInteger(index) && index >= 0 && index < eventCustomFields.length ? index : -1;
}

function syncCustomFieldBuilder(isInternal = eventPlatformReady && eventRegistrationMode?.value === 'INTERNAL') {
    if (eventCustomFieldAdd) {
        eventCustomFieldAdd.disabled = !isInternal || eventCustomFields.length >= MAX_EVENT_CUSTOM_FIELDS;
        eventCustomFieldAdd.textContent = eventCustomFields.length >= MAX_EVENT_CUSTOM_FIELDS
            ? `Máximo ${MAX_EVENT_CUSTOM_FIELDS} preguntas`
            : '+ Agregar pregunta';
    }
    eventCustomFieldEmpty?.classList.toggle('hidden', eventCustomFields.length > 0);
    eventCustomFieldsContainer?.querySelectorAll('input, select, textarea, button').forEach((field) => {
        field.disabled = !isInternal;
    });
}

function renderCustomFieldBuilder() {
    if (!eventCustomFieldsContainer) return;
    eventCustomFieldsContainer.replaceChildren();
    eventCustomFields.forEach((field, index) => {
        const card = document.createElement('article');
        card.dataset.customFieldIndex = String(index);
        card.className = 'rounded-md border border-slate-200 bg-white p-4 shadow-sm';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between gap-4';
        const title = document.createElement('p');
        title.className = 'text-xs font-bold uppercase tracking-[0.08em] text-slate-500';
        title.textContent = `Pregunta ${index + 1}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.customFieldAction = 'remove';
        remove.className = 'inline-flex min-h-11 items-center rounded px-2 py-2 text-xs font-bold text-red-700 hover:bg-red-50';
        remove.textContent = 'Quitar';
        header.append(title, remove);

        const grid = document.createElement('div');
        grid.className = 'mt-4 grid gap-4 sm:grid-cols-2';
        const typeLabel = document.createElement('label');
        typeLabel.className = 'event-field';
        typeLabel.textContent = 'Tipo de respuesta';
        const type = document.createElement('select');
        type.name = 'custom_field_type';
        type.className = 'mt-2';
        EVENT_CUSTOM_FIELD_TYPES.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = CUSTOM_FIELD_TYPE_LABELS[value] || value;
            option.selected = value === field.type;
            type.append(option);
        });
        typeLabel.append(type);

        const requiredLabel = document.createElement('label');
        requiredLabel.className = 'flex items-center gap-2 self-end pb-2 text-sm font-semibold text-slate-700';
        const required = document.createElement('input');
        required.type = 'checkbox';
        required.name = 'custom_field_required';
        required.checked = Boolean(field.required);
        required.className = 'h-4 w-4 rounded border-slate-300 text-[#293C74] focus:ring-[#293C74]';
        requiredLabel.append(required, document.createTextNode('Respuesta obligatoria'));
        grid.append(typeLabel, requiredLabel);

        const label = document.createElement('label');
        label.className = 'event-field sm:col-span-2';
        label.textContent = 'Pregunta para la persona';
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.name = 'custom_field_label';
        labelInput.maxLength = 120;
        labelInput.placeholder = 'Ej. ¿Por medio de qué iglesia nos conociste?';
        labelInput.value = field.label || '';
        label.append(labelInput);
        grid.append(label);

        const help = document.createElement('label');
        help.className = 'event-field sm:col-span-2';
        help.textContent = 'Texto de ayuda (opcional)';
        const helpInput = document.createElement('input');
        helpInput.type = 'text';
        helpInput.name = 'custom_field_help';
        helpInput.maxLength = 240;
        helpInput.placeholder = 'Explica brevemente para qué se usará este dato.';
        helpInput.value = field.help_text || '';
        help.append(helpInput);
        grid.append(help);

        if (isEventCustomChoiceField(field.type)) {
            const options = document.createElement('label');
            options.className = 'event-field sm:col-span-2';
            options.textContent = 'Opciones (una por línea)';
            const optionsInput = document.createElement('textarea');
            optionsInput.name = 'custom_field_options';
            optionsInput.rows = 3;
            optionsInput.maxLength = 960;
            optionsInput.placeholder = 'Primera opción\nSegunda opción';
            optionsInput.value = Array.isArray(field.options) ? field.options.join('\n') : '';
            options.append(optionsInput);
            const hint = document.createElement('small');
            hint.className = 'mt-2 block text-xs font-normal text-slate-500';
            hint.textContent = 'Incluye entre 2 y 12 opciones claras.';
            options.append(hint);
            grid.append(options);
        }
        card.append(header, grid);
        eventCustomFieldsContainer.append(card);
    });
    syncCustomFieldBuilder();
}

function getCustomFieldsForSaving() {
    const fields = eventCustomFields.map((field) => ({
        ...field,
        label: String(field.label || '').trim(),
        help_text: String(field.help_text || '').trim(),
        options: Array.isArray(field.options) ? field.options.map((option) => String(option).trim()).filter(Boolean) : [],
    }));
    const missingLabel = fields.find((field) => !field.label || field.label.length < 3);
    if (missingLabel) throw new Error('Escribe una pregunta clara de al menos 3 caracteres.');
    const invalidOptions = fields.find((field) => isEventCustomChoiceField(field.type) && field.options.length < 2);
    if (invalidOptions) throw new Error('Las preguntas de opciones necesitan al menos dos respuestas.');
    return normalizeEventRegistrationFormConfig({ fields }).fields;
}

function syncRegistrationFields() {
    const isExternal = eventPlatformReady && eventRegistrationMode?.value === 'EXTERNAL';
    const isInternal = eventPlatformReady && eventRegistrationMode?.value === 'INTERNAL';
    const hasRegistration = isExternal || isInternal;
    eventRegistrationUrlWrapper?.classList.toggle('hidden', !isExternal);
    eventRegistrationWindow?.classList.toggle('hidden', !hasRegistration);
    eventCapacityWrapper?.classList.toggle('hidden', !isInternal);
    eventRegistrationFormSettings?.classList.toggle('hidden', !isInternal);
    const urlInput = eventForm?.querySelector('[name="registration_url"]');
    const capacityInput = eventForm?.querySelector('[name="capacity"]');
    const registrationDateInputs = eventForm?.querySelectorAll('[name="registration_opens_at"], [name="registration_closes_at"]') || [];
    if (urlInput) {
        urlInput.disabled = !isExternal;
        urlInput.required = isExternal;
    }
    if (capacityInput) capacityInput.disabled = !isInternal;
    registrationDateInputs.forEach((field) => {
        field.disabled = !hasRegistration;
    });
    [eventRegistrationPhoneMode, eventRegistrationCollectChurch, eventRegistrationWhatsAppUpdates].forEach((field) => {
        if (field) field.disabled = !isInternal;
    });
    syncCustomFieldBuilder(isInternal);
    syncDatePickerDisabledState();
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
    syncDatePickerDisabledState();
}

function syncFinanceFields() {
    eventFinancePending?.classList.toggle('hidden', eventFinanceReady);
    eventFinanceSettings?.classList.toggle('hidden', !eventFinanceReady);
    eventForm?.querySelectorAll('[data-finance-field]').forEach((field) => {
        field.disabled = !eventFinanceReady;
    });
    if (!eventFinanceReady || !eventPriceInput) return;
    const pricingModel = String(eventPricingModel?.value || 'FREE').toUpperCase();
    const isFree = pricingModel === 'FREE';
    const hasFixedPrice = pricingModel === 'PAID';
    const usesInternalRegistration = eventRegistrationMode?.value === 'INTERNAL';
    const scope = String(eventScopeSelect?.value || 'LOCAL').toUpperCase();
    if (eventPricingModel) eventPricingModel.disabled = !usesInternalRegistration;
    let paymentMode = normalizeEventOnlinePaymentMode(eventOnlineProvider?.value);
    const dualAllowed = eventDualFinanceReady && canUseEventPaymentModeForScope('DUAL', scope);
    if (eventOnlineProviderDual) {
        eventOnlineProviderDual.hidden = !dualAllowed;
        eventOnlineProviderDual.disabled = !dualAllowed;
    }
    if (paymentMode === 'DUAL' && !dualAllowed) {
        paymentMode = 'NONE';
        if (eventOnlineProvider) eventOnlineProvider.value = 'NONE';
    }
    const usesDualPayment = paymentMode === 'DUAL' && usesInternalRegistration && !isFree;
    const currencyField = eventCurrencyInput;
    const provider = normalizeEventOnlinePaymentProvider(paymentMode);
    const requiredProviderCurrency = getRequiredEventProviderCurrency(provider);
    if (currencyField && requiredProviderCurrency) currencyField.value = requiredProviderCurrency;
    if (currencyField) {
        currencyField.disabled = !usesInternalRegistration || isFree || usesDualPayment || Boolean(requiredProviderCurrency);
        currencyField.classList.toggle('bg-slate-100', !usesInternalRegistration || isFree || usesDualPayment || Boolean(requiredProviderCurrency));
    }
    const approvalField = eventForm?.querySelector('[name="registration_requires_approval"]');
    if (approvalField) approvalField.disabled = !usesInternalRegistration;
    if (eventFinanceRegistrationHint) {
        eventFinanceRegistrationHint.classList.toggle('hidden', usesInternalRegistration);
    }
    if (!hasFixedPrice) eventPriceInput.value = '0';
    eventSinglePriceSettings?.classList.toggle('hidden', usesDualPayment);
    eventDualPriceSettings?.classList.toggle('hidden', !usesDualPayment || !hasFixedPrice);
    eventPriceInput.disabled = !usesInternalRegistration || !hasFixedPrice || usesDualPayment;
    eventPriceInput.classList.toggle('bg-slate-100', !hasFixedPrice || !usesInternalRegistration || usesDualPayment);
    if (eventPriceCopInput) eventPriceCopInput.disabled = !usesDualPayment || !hasFixedPrice;
    if (eventPriceUsdInput) eventPriceUsdInput.disabled = !usesDualPayment || !hasFixedPrice;
    if (eventOnlineProvider) {
        if (isFree || !usesInternalRegistration) eventOnlineProvider.value = 'NONE';
        eventOnlineProvider.disabled = isFree || !usesInternalRegistration;
    }
    if (eventOnlineProviderWrapper) {
        const hideProvider = isFree || !usesInternalRegistration;
        eventOnlineProviderWrapper.hidden = hideProvider;
        eventOnlineProviderWrapper.style.display = hideProvider ? 'none' : '';
    }
    if (eventOnlineProviderHint) {
        eventOnlineProviderHint.textContent = !eventDualFinanceReady && scope === 'GLOBAL'
            ? 'El cobro dual aparecerá cuando ejecutes la migración pendiente en Supabase.'
            : usesDualPayment
            ? 'La persona elige Colombia/Wompi o exterior/Stripe antes de pagar.'
            : paymentMode === 'WOMPI'
            ? 'Wompi cobra siempre en pesos y se registra como recaudo nacional.'
            : paymentMode === 'STRIPE'
            ? 'Stripe cobra en dólares para pagos internacionales.'
            : '';
    }
    formatMoneyInput();
    syncManualPaymentFields();
}

function syncManualPaymentFields() {
    const onlineMode = normalizeEventOnlinePaymentMode(eventOnlineProvider?.value);
    const hasOnlineProvider = onlineMode !== 'NONE';
    const available = eventFinanceReady
        && eventPricingModel?.value !== 'FREE'
        && eventRegistrationMode?.value === 'INTERNAL'
        && !hasOnlineProvider;
    if (eventManualPaymentEnabled) {
        if (!available) eventManualPaymentEnabled.checked = false;
        eventManualPaymentEnabled.disabled = !available;
    }
    eventManualPaymentPanel?.classList.toggle('opacity-60', !available);
    if (eventManualPaymentHint) {
        eventManualPaymentHint.textContent = hasOnlineProvider
            ? `${onlineMode === 'DUAL' ? 'Wompi y Stripe procesan' : onlineMode === 'WOMPI' ? 'Wompi procesa' : 'Stripe procesa'} el cobro automático; el pago manual queda desactivado.`
            : available
            ? 'Actívalo para recibir un QR, transferencia, enlace externo o efectivo y revisar el comprobante.'
            : 'Selecciona “Inscripción en Maná” y un precio distinto de gratuito para habilitarlo.';
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
        const options = Array.isArray(data.options) ? data.options : [];
        eventDualFinanceReady = eventDualFinanceReady && data.dual_payment_ready === true;
        const activeOnline = options.filter((option) => option?.kind === 'ONLINE' && option?.is_active);
        const activeProviders = new Set(activeOnline.map((option) => option?.provider));
        const activeMode = activeProviders.has('WOMPI') && activeProviders.has('STRIPE')
            ? 'DUAL'
            : activeOnline[0]?.provider || 'NONE';
        const activeManual = options.find(
            (option) => option?.kind !== 'ONLINE' && ['MANUAL', 'EXTERNAL'].includes(option?.provider) && option?.is_active,
        );
        eventOnlineProvider.value = activeMode;
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
        syncFinanceFields();
    }
}

async function saveEventPaymentOption(eventId, mode) {
    const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/event-payments/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, mode }),
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
    const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/event-payments/qr', {
        method: 'POST',
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
    const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/event-payments/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

async function fetchAuthorizedJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const withAuth = () => ({
        ...options,
        headers: { ...(options.headers || {}), ...authHeaders },
        credentials: 'include',
    });
    let result = await fetchJsonWithTimeout(url, withAuth(), timeoutMs, label);
    if (result.res.status !== 401) return result;

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

    authHeaders = session.headers;
    result = await fetchJsonWithTimeout(url, withAuth(), timeoutMs, label);
    return result;
}

function showEventsError(error) {
    if (!eventsLoading || !eventsList || !eventsEmpty) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'No se pudieron cargar eventos.';

    eventsList.classList.add('hidden');
    eventsEmpty.classList.add('hidden');
    eventsLoading.className = 'portal-panel px-6 py-8 text-center';
    eventsLoading.innerHTML = `
        <p class="font-bold text-red-700">No se pudieron cargar los eventos</p>
        <p class="mt-2 text-sm text-slate-600">${escapeHtml(message)}</p>
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
    const timeZone = normalizeEventTimeZone(event?.timezone);
    const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone }).format(start);
    const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone }).format(start);
    return `${date}, ${time}`;
}

function getLocationLabel(event) {
    return [event?.location_name, event?.city, event?.country].filter(Boolean).join(' · ') || 'Lugar por definir';
}

function getEventEconomyLabel(event) {
    const copPrice = getEventProviderPrice(event, 'WOMPI');
    const usdPrice = getEventProviderPrice(event, 'STRIPE');
    if (copPrice > 0 && usdPrice > 0) {
        return `${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(copPrice)} · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usdPrice)}`;
    }
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
        const bannerLayout = normalizeEventInvitationLayout(event.banner_layout);
        const start = new Date(event.start_date || '');
        const month = Number.isNaN(start.getTime()) ? 'EVENTO' : new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(start).replace('.', '').toUpperCase();
        const day = Number.isNaN(start.getTime()) ? '—' : String(start.getDate());
        const media = bannerUrl
            ? `<div class="event-list-media event-list-media--${escapeAttr(bannerLayout.toLowerCase())}"><img src="${escapeAttr(bannerUrl)}" alt="" loading="lazy" decoding="async" /></div>`
            : `<div class="event-list-media event-list-media--horizontal flex flex-col items-center justify-center bg-[#293C74] text-white"><span class="text-xs font-bold text-white">${escapeHtml(month)}</span><strong class="text-3xl leading-none text-white">${escapeHtml(day)}</strong></div>`;
        const description = event.description ? `<p class="mt-2 line-clamp-1 text-sm text-slate-500">${escapeHtml(event.description)}</p>` : '';
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
              <div class="min-w-0 flex-1 p-4 sm:px-6">
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      <span class="portal-chip ${LIFECYCLE_TONES[lifecycle]}">${escapeHtml(LIFECYCLE_LABELS[lifecycle])}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(SCOPE_LABELS[getEventScope(event)] || getEventScope(event))}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(getEventEconomyLabel(event))}</span>
                      <span class="portal-chip border border-slate-200 bg-white text-slate-600">${escapeHtml(getEventRegistrationLabel(event))}</span>
                    </div>
                    <h2 class="truncate text-lg font-bold text-[#293C74]">${escapeHtml(event.title || 'Evento')}</h2>
                    ${description}
                    <div class="mt-4 flex flex-col gap-2 text-sm text-slate-600 md:flex-row md:flex-wrap md:gap-x-6">
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
        eventDualFinanceReady = data.dual_finance_ready === true;
        syncPlatformFields();
        syncFinanceFields();
        if (shouldRender) renderEvents();
    } catch (error) {
        showEventsError(error);
        throw error;
    }
}

function getDateTimeParts(value, timeZone) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const normalizedTimeZone = normalizeEventTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: normalizedTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function toInputDateTime(value, timeZone = DEFAULT_EVENT_TIMEZONE) {
    if (!value) return '';
    try {
        const parts = getDateTimeParts(value, timeZone);
        return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : '';
    } catch {
        return '';
    }
}

function getTimeZoneOffsetMs(timestamp, timeZone) {
    const parts = getDateTimeParts(new Date(timestamp), timeZone);
    if (!parts) return null;
    const representedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
    );
    return representedAsUtc - timestamp;
}

function toIsoDateTime(value, timeZone = DEFAULT_EVENT_TIMEZONE) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    try {
        const wallTimeAsUtc = Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
        );
        const firstOffset = getTimeZoneOffsetMs(wallTimeAsUtc, timeZone);
        if (firstOffset === null) return null;
        let instant = wallTimeAsUtc - firstOffset;
        const resolvedOffset = getTimeZoneOffsetMs(instant, timeZone);
        if (resolvedOffset === null) return null;
        if (resolvedOffset !== firstOffset) instant = wallTimeAsUtc - resolvedOffset;
        const date = new Date(instant);
        return toInputDateTime(date, timeZone) === value ? date.toISOString() : null;
    } catch {
        return null;
    }
}

function updateEventPreview() {
    if (!eventForm) return;
    const value = (name) => String(eventForm.querySelector(`[name="${name}"]`)?.value || '').trim();
    const title = value('title');
    const description = value('description');
    const scope = value('scope').toUpperCase() || 'LOCAL';
    const status = value('status').toUpperCase() || 'DRAFT';
    const start = eventDatePickers.get('start_date')?.selectedDates?.[0] || null;
    const imageUrl = invitationImagePreviewObjectUrl || sanitizeUrl(value('banner_url'));
    const location = [value('location_name'), value('city'), value('country')].filter(Boolean).join(' · ');
    const currency = value('currency').toUpperCase() || 'COP';
    const price = parseMoneyInput(value('price'), currency);
    const paymentMode = normalizeEventOnlinePaymentMode(eventOnlineProvider?.value);
    const copPrice = parseMoneyInput(eventPriceCopInput?.value, 'COP');
    const usdPrice = parseMoneyInput(eventPriceUsdInput?.value, 'USD');
    const usesInternalRegistration = value('registration_mode').toUpperCase() === 'INTERNAL';

    if (previewTitle) previewTitle.textContent = title || 'Título del evento';
    if (previewDescription) previewDescription.textContent = description || 'La descripción aparecerá aquí.';
    if (previewScope) previewScope.textContent = SCOPE_LABELS[scope] || scope;
    if (previewStatus) {
        previewStatus.textContent = status === 'PUBLISHED' ? 'Publicado' : status === 'ARCHIVED' ? 'Archivado' : 'Borrador';
        previewStatus.className = `portal-chip ${status === 'PUBLISHED' ? 'bg-teal-50 text-teal-700' : status === 'ARCHIVED' ? 'bg-slate-200 text-slate-600' : 'bg-amber-50 text-amber-700'}`;
    }
    if (previewDate) {
        previewDate.innerHTML = !start || Number.isNaN(start.getTime())
            ? '<span class="block text-xs font-bold uppercase text-slate-500">Fecha</span><strong class="block text-lg text-[#293C74]">Por definir</strong>'
            : `<span class="block text-xs font-bold uppercase text-slate-500">${escapeHtml(new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(start))}</span><strong class="block text-2xl leading-none text-[#293C74]">${escapeHtml(start.getDate())}</strong>`;
    }
    if (previewLocation) previewLocation.textContent = location || 'Lugar por definir';
    if (previewPrice) {
        previewPrice.textContent = usesInternalRegistration && paymentMode === 'DUAL' && copPrice > 0 && usdPrice > 0
            ? `${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(copPrice)} Colombia · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usdPrice)} exterior`
            : usesInternalRegistration && Number.isFinite(price) && price > 0
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

function setInvitationImageStatus(message = '', tone = 'info') {
    if (!eventInvitationImageStatus) return;
    eventInvitationImageStatus.textContent = message;
    eventInvitationImageStatus.className = message
        ? `mt-2 text-xs font-medium ${tone === 'error' ? 'text-red-700' : tone === 'success' ? 'text-emerald-700' : 'text-slate-600'}`
        : 'mt-2 hidden text-xs font-medium';
}

function clearPendingInvitationImage() {
    pendingInvitationImageFile = null;
    if (invitationImagePreviewObjectUrl) URL.revokeObjectURL(invitationImagePreviewObjectUrl);
    invitationImagePreviewObjectUrl = '';
    if (eventInvitationImage) eventInvitationImage.value = '';
    setInvitationImageStatus();
}

function setPendingInvitationImage(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 4 * 1024 * 1024) {
        pendingInvitationImageFile = null;
        setInvitationImageStatus('Usa una imagen JPG, PNG o WebP de máximo 4 MB.', 'error');
        return;
    }
    if (invitationImagePreviewObjectUrl) URL.revokeObjectURL(invitationImagePreviewObjectUrl);
    pendingInvitationImageFile = file;
    invitationImagePreviewObjectUrl = URL.createObjectURL(file);
    setInvitationImageStatus(`${file.name} lista para guardarse en SharePoint.`, 'success');
    updateEventPreview();
}

async function uploadInvitationImage(eventId) {
    if (!pendingInvitationImageFile) return null;
    const formData = new FormData();
    formData.append('event_id', eventId);
    formData.append('file', pendingInvitationImageFile);
    const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/event-invitation-image', {
        method: 'POST',
        body: formData,
    }, REQUEST_TIMEOUT_MS * 2, 'La carga de la imagen de invitación');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar la imagen de invitación.');
    const bannerField = eventForm?.querySelector('[name="banner_url"]');
    if (bannerField) bannerField.value = String(data.banner_url || '');
    clearPendingInvitationImage();
    return {
        bannerUrl: String(data.banner_url || ''),
        layout: normalizeEventInvitationLayout(data.layout),
    };
}

function openEventModal(mode, eventData = null) {
    if (!eventModal || !eventForm) return;
    if (document.activeElement instanceof HTMLElement) eventModalReturnFocus = document.activeElement;
    clearPendingInvitationImage();
    eventForm.reset();
    eventDatePickers.forEach((picker) => picker.clear(false));
    eventSlugManuallyEdited = Boolean(eventData?.slug);
    showFormError();
    if (eventIdInput) eventIdInput.value = eventData?.id || '';
    if (eventModalTitle) eventModalTitle.textContent = mode === 'edit' ? 'Editar evento' : 'Nuevo evento';
    if (eventSubmitBtn) eventSubmitBtn.textContent = mode === 'edit' ? 'Guardar cambios' : 'Guardar evento';
    const archivedOption = eventStatusSelect?.querySelector('option[value="ARCHIVED"]');
    if (archivedOption) {
        archivedOption.hidden = mode !== 'edit';
        archivedOption.disabled = mode !== 'edit';
    }

    const eventTimeZone = normalizeEventTimeZone(eventData?.timezone);
    const fieldValues = {
        title: eventData?.title || '',
        description: eventData?.description || '',
        start_date: toInputDateTime(eventData?.start_date, eventTimeZone),
        end_date: toInputDateTime(eventData?.end_date, eventTimeZone),
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
        registration_opens_at: toInputDateTime(eventData?.registration_opens_at, eventTimeZone),
        registration_closes_at: toInputDateTime(eventData?.registration_closes_at, eventTimeZone),
        capacity: eventData?.capacity ?? '',
        contact_email: eventData?.contact_email || '',
        contact_whatsapp: eventData?.contact_whatsapp || '',
        contact_whatsapp_message: eventData?.contact_whatsapp_message || '',
        timezone: eventTimeZone,
        price: eventData?.price ?? 0,
        price_cop: eventData?.price_cop ?? (String(eventData?.currency || '').toUpperCase() === 'COP' ? eventData?.price ?? '' : ''),
        price_usd: eventData?.price_usd ?? (String(eventData?.currency || '').toUpperCase() === 'USD' ? eventData?.price ?? '' : ''),
        currency: String(eventData?.currency || 'COP').toUpperCase(),
        attendance_mode: normalizeAttendanceMode(eventData?.attendance_mode),
        pricing_model: String(eventData?.pricing_model || (Number(eventData?.price || 0) > 0 ? 'PAID' : 'FREE')).toUpperCase(),
    };
    Object.entries(fieldValues).forEach(([name, value]) => {
        const field = eventForm.querySelector(`[name="${name}"]`);
        if (field) field.value = value;
    });
    ['start_date', 'end_date', 'registration_opens_at', 'registration_closes_at'].forEach((name) => {
        setEventDateTimeValue(name, fieldValues[name]);
    });
    syncSlugInput();
    formatMoneyInput();
    const approvalField = eventForm.querySelector('[name="registration_requires_approval"]');
    if (approvalField) approvalField.checked = Boolean(eventData?.registration_requires_approval);
    const formConfig = normalizeEventRegistrationFormConfig(eventData?.registration_form_config);
    if (eventRegistrationPhoneMode) eventRegistrationPhoneMode.value = formConfig.phone;
    if (eventRegistrationCollectChurch) eventRegistrationCollectChurch.checked = formConfig.church;
    if (eventRegistrationWhatsAppUpdates) eventRegistrationWhatsAppUpdates.checked = formConfig.whatsapp_updates;
    eventCustomFields = formConfig.fields.map((field) => ({ ...field, options: [...field.options] }));
    renderCustomFieldBuilder();

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
    eventModal.setAttribute('aria-hidden', 'false');
    eventFormDirty = false;
    document.body.style.overflow = 'hidden';
    void loadEventPaymentOption(eventData);
    window.setTimeout(() => eventForm.querySelector('[name="title"]')?.focus(), 0);
}

function getEventModalFocusableElements() {
    if (!eventModal) return [];
    const selector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const containers = [eventModal, ...document.querySelectorAll('.event-calendar.open')];
    return containers.flatMap((container) => [...container.querySelectorAll(selector)])
        .filter((element, index, elements) => elements.indexOf(element) === index)
        .filter((element) => !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0);
}

function closeEventModal(returnFocusOverride = null) {
    if (!eventModal) return;
    eventModal.classList.add('hidden');
    eventModal.classList.remove('flex');
    eventModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    showFormError();
    clearPendingInvitationImage();
    eventFormDirty = false;
    const returnFocus = returnFocusOverride || eventModalReturnFocus;
    eventModalReturnFocus = null;
    window.queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
        else btnNewEvent?.focus();
    });
}

function requestCloseEventModal() {
    if (eventFormDirty && !window.confirm('Hay cambios sin guardar en este evento. ¿Quieres descartarlos?')) return;
    closeEventModal();
}

function handleEventModalKeydown(event) {
    if (!eventModal?.classList.contains('flex')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeModal?.focus();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getEventModalFocusableElements();
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

async function changeEventStatus(eventId, status) {
    const event = eventsCache.find((item) => item.id === eventId);
    if (!event || !canEditEvent(event)) return;

    if (status === 'ARCHIVED' && !window.confirm('Archivar oculta el evento de la operación diaria, pero conserva su información. ¿Continuar?')) return;

    const button = eventsList?.querySelector(`[data-event-id="${CSS.escape(eventId)}"][data-event-status]`);
    if (button) button.disabled = true;
    try {
        const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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
        item.setAttribute('aria-pressed', String(active));
    });
    renderEvents();
});

eventSearch?.addEventListener('input', renderEvents);
eventScopeFilter?.addEventListener('change', renderEvents);
btnNewEvent?.addEventListener('click', () => openEventModal('create'));
closeModal?.addEventListener('click', requestCloseEventModal);
eventCancel?.addEventListener('click', requestCloseEventModal);
eventModal?.addEventListener('click', (event) => {
    if (event.target === eventModal) closeModal?.focus();
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

eventScopeSelect?.addEventListener('change', () => {
    syncScopeInputs({ preserveSelections: true });
    syncFinanceFields();
    updateEventPreview();
});
eventRegionSelect?.addEventListener('change', () => {
    syncCountryFromRegion();
    updateEventPreview();
});
eventRegistrationMode?.addEventListener('change', () => {
    syncRegistrationFields();
    syncFinanceFields();
});
eventCustomFieldAdd?.addEventListener('click', () => {
    if (eventCustomFields.length >= MAX_EVENT_CUSTOM_FIELDS) return;
    eventFormDirty = true;
    eventCustomFields.push(createCustomField());
    renderCustomFieldBuilder();
    eventCustomFieldsContainer?.querySelector('[name="custom_field_label"]')?.focus();
});
eventCustomFieldsContainer?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-custom-field-action="remove"]');
    const index = getCustomFieldIndex(button);
    if (!button || index < 0) return;
    eventFormDirty = true;
    eventCustomFields.splice(index, 1);
    renderCustomFieldBuilder();
});
eventCustomFieldsContainer?.addEventListener('input', (event) => {
    const index = getCustomFieldIndex(event.target);
    if (index < 0) return;
    const field = eventCustomFields[index];
    if (event.target.name === 'custom_field_label') field.label = event.target.value;
    if (event.target.name === 'custom_field_help') field.help_text = event.target.value;
    if (event.target.name === 'custom_field_options') {
        field.options = event.target.value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12);
    }
});
eventCustomFieldsContainer?.addEventListener('change', (event) => {
    const index = getCustomFieldIndex(event.target);
    if (index < 0) return;
    const field = eventCustomFields[index];
    if (event.target.name === 'custom_field_type') {
        field.type = String(event.target.value || 'SHORT_TEXT').toUpperCase();
        if (!isEventCustomChoiceField(field.type)) field.options = [];
        renderCustomFieldBuilder();
    }
    if (event.target.name === 'custom_field_required') field.required = Boolean(event.target.checked);
});
eventSlugInput?.addEventListener('input', () => {
    eventSlugManuallyEdited = true;
    syncSlugInput();
});
eventSlugInput?.addEventListener('blur', () => syncSlugInput({ finalize: true }));
eventTitleInput?.addEventListener('input', () => {
    if (!eventSlugInput || eventSlugManuallyEdited) return;
    eventSlugInput.value = normalizeEventSlug(eventTitleInput.value);
    syncSlugInput();
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
eventOnlineProvider?.addEventListener('change', () => {
    preparePriceFieldsForPaymentMode(eventOnlineProvider.value);
    syncFinanceFields();
    updateEventPreview();
});
eventCurrencyInput?.addEventListener('change', () => {
    formatMoneyInput();
    updateEventPreview();
});
eventPriceInput?.addEventListener('input', () => {
    formatMoneyInput({ preserveCaret: true });
    syncDedicatedPriceFromSingle();
});
eventPriceInput?.addEventListener('blur', () => {
    formatMoneyInput();
    syncDedicatedPriceFromSingle();
    updateEventPreview();
});
eventPriceCopInput?.addEventListener('input', () => formatMoneyField(eventPriceCopInput, 'COP', { preserveCaret: true }));
eventPriceCopInput?.addEventListener('blur', () => {
    formatMoneyField(eventPriceCopInput, 'COP');
    updateEventPreview();
});
eventPriceUsdInput?.addEventListener('input', () => formatMoneyField(eventPriceUsdInput, 'USD'));
eventPriceUsdInput?.addEventListener('blur', () => {
    formatMoneyField(eventPriceUsdInput, 'USD');
    updateEventPreview();
});
eventInvitationImage?.addEventListener('change', () => setPendingInvitationImage(eventInvitationImage.files?.[0]));
eventInvitationImageDropzone?.addEventListener('click', () => eventInvitationImage?.click());
eventInvitationImageDropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        eventInvitationImage?.click();
    }
});
eventInvitationImageDropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    eventInvitationImageDropzone.classList.add('is-dragging');
});
eventInvitationImageDropzone?.addEventListener('dragleave', () => eventInvitationImageDropzone.classList.remove('is-dragging'));
eventInvitationImageDropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    eventInvitationImageDropzone.classList.remove('is-dragging');
    setPendingInvitationImage(event.dataTransfer?.files?.[0]);
});
eventForm?.addEventListener('input', () => {
    eventFormDirty = true;
    updateEventPreview();
});
eventForm?.addEventListener('change', () => {
    eventFormDirty = true;
    updateEventPreview();
});

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
        const registrationMode = eventPlatformReady
            ? String(eventRegistrationMode?.value || 'NONE').toUpperCase()
            : String(payload.registration_mode || 'NONE').toUpperCase();
        payload.registration_mode = registrationMode;
        if (eventPlatformReady) {
            payload.registration_form_config = {
                phone: String(eventRegistrationPhoneMode?.value || 'OPTIONAL').toUpperCase(),
                church: Boolean(eventRegistrationCollectChurch?.checked),
                whatsapp_updates: Boolean(eventRegistrationWhatsAppUpdates?.checked),
                fields: registrationMode === 'INTERNAL' ? getCustomFieldsForSaving() : [],
            };
        }
        payload.attendance_mode = normalizeAttendanceMode(eventForm.querySelector('[name="attendance_mode"]')?.value);
        payload.timezone = normalizeEventTimeZone(
            payload.timezone || eventForm.querySelector('[name="timezone"]')?.value
        );
        if (eventPlatformReady && eventSlugInput) {
            payload.slug = normalizeEventSlug(eventSlugInput.value);
            eventSlugInput.value = payload.slug;
            syncSlugInput();
        }
        const eventId = String(payload.id || '');
        delete payload.id;
        Object.keys(payload).forEach((key) => {
            if (payload[key] === '') delete payload[key];
        });
        if (eventPlatformReady) {
            ['contact_whatsapp', 'contact_whatsapp_message'].forEach((name) => {
                const raw = String(eventForm.querySelector(`[name="${name}"]`)?.value || '').trim();
                payload[name] = raw || null;
            });
        }

        const timeZone = payload.timezone;
        const startDateError = getDateTimeError(payload.start_date, 'inicio', true);
        if (startDateError) throw new Error(startDateError);
        const endDateError = getDateTimeError(payload.end_date, 'fin');
        if (endDateError) throw new Error(endDateError);
        const startIso = toIsoDateTime(payload.start_date, timeZone);
        const endIso = payload.end_date ? toIsoDateTime(payload.end_date, timeZone) : null;
        if (!startIso) throw new Error('La fecha de inicio o la zona horaria no son válidas.');
        const start = new Date(startIso);
        const end = endIso ? new Date(endIso) : null;
        if (payload.end_date && !endIso) throw new Error('La fecha de fin no es válida.');
        if (end && end.getTime() < start.getTime()) {
            throw new Error('La fecha de fin debe ser posterior al inicio.');
        }
        payload.start_date = startIso;
        payload.end_date = endIso;

        if (registrationMode === 'NONE') {
            payload.registration_url = null;
            payload.registration_opens_at = null;
            payload.registration_closes_at = null;
            payload.capacity = null;
        } else {
            const registrationDateFields = [
                ['registration_opens_at', 'apertura de inscripciones'],
                ['registration_closes_at', 'cierre de inscripciones'],
            ];
            registrationDateFields.forEach(([field, label]) => {
                const rawValue = String(eventForm.querySelector(`[name="${field}"]`)?.value || '').trim();
                const dateError = getDateTimeError(rawValue, label);
                if (dateError) throw new Error(dateError);
                if (!rawValue) {
                    payload[field] = null;
                    return;
                }
                const isoValue = toIsoDateTime(rawValue, timeZone);
                if (!isoValue) throw new Error(`La fecha de ${label} o la zona horaria no son válidas.`);
                payload[field] = isoValue;
            });
            const opensAt = payload.registration_opens_at ? new Date(payload.registration_opens_at).getTime() : null;
            const closesAt = payload.registration_closes_at ? new Date(payload.registration_closes_at).getTime() : null;
            if (opensAt !== null && closesAt !== null && closesAt < opensAt) {
                throw new Error('El cierre de inscripciones debe ser posterior a la apertura.');
            }
            if (registrationMode !== 'INTERNAL') payload.capacity = null;
        }

        const pricingModel = registrationMode === 'INTERNAL'
            ? String(eventPricingModel?.value || 'FREE').toUpperCase()
            : 'FREE';
        const paymentMode = pricingModel === 'FREE'
            ? 'NONE'
            : normalizeEventOnlinePaymentMode(eventOnlineProvider?.value);
        let currency = String(eventForm.querySelector('[name="currency"]')?.value || 'COP').toUpperCase();
        let parsedPrice = pricingModel === 'PAID' ? parseMoneyInput(eventPriceInput?.value, currency) : 0;
        if (paymentMode === 'DUAL') {
            if (!eventDualFinanceReady) throw new Error('Falta ejecutar la migración de cobro dual en Supabase.');
            if (!canUseEventPaymentModeForScope(paymentMode, payload.scope)) {
                throw new Error('El cobro Wompi + Stripe está disponible únicamente para eventos globales.');
            }
            const priceCop = pricingModel === 'PAID' ? parseMoneyInput(eventPriceCopInput?.value, 'COP') : null;
            const priceUsd = pricingModel === 'PAID' ? parseMoneyInput(eventPriceUsdInput?.value, 'USD') : null;
            if (pricingModel === 'PAID' && (!Number.isFinite(priceCop) || priceCop <= 0 || priceCop > 1_000_000_000)) {
                throw new Error('El precio para Colombia en pesos no es válido.');
            }
            if (pricingModel === 'PAID' && (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 1_000_000_000)) {
                throw new Error('El precio internacional en dólares no es válido.');
            }
            currency = 'COP';
            parsedPrice = pricingModel === 'PAID' ? priceCop : 0;
            payload.price_cop = priceCop;
            payload.price_usd = priceUsd;
        } else {
            if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 1_000_000_000) {
                throw new Error('El precio por persona no es válido.');
            }
            if (pricingModel === 'PAID' && parsedPrice <= 0) {
                throw new Error('El precio fijo debe ser mayor que cero.');
            }
            if (eventDualFinanceReady) {
                payload.price_cop = pricingModel === 'PAID' && currency === 'COP' ? parsedPrice : null;
                payload.price_usd = pricingModel === 'PAID' && currency === 'USD' ? parsedPrice : null;
            }
        }
        payload.pricing_model = pricingModel;
        payload.price = parsedPrice;
        payload.currency = currency;
        payload.registration_requires_approval = registrationMode === 'INTERNAL' && Boolean(approvalField?.checked);
        if (
            eventFinanceReady
            && registrationMode === 'INTERNAL'
            && payload.pricing_model !== 'FREE'
            && paymentMode === 'NONE'
            && !eventManualPaymentEnabled?.checked
        ) {
            throw new Error('Selecciona un cobro automático o activa un pago verificado manualmente.');
        }
        if (eventFinanceReady && registrationMode === 'INTERNAL' && eventManualPaymentEnabled?.checked) {
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

        const { res, data } = await fetchAuthorizedJsonWithTimeout('/api/portal/events', {
            method: eventId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventId ? { id: eventId, ...payload } : payload),
        }, REQUEST_TIMEOUT_MS, 'El guardado del evento');
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar el evento.');

        const savedEvent = data.event;
        if (eventId) {
            eventsCache = eventsCache.map((item) => item.id === eventId ? savedEvent : item);
        } else {
            eventsCache = [...eventsCache, savedEvent];
        }
        if (savedEvent?.id && pendingInvitationImageFile) {
            try {
                const invitationImage = await uploadInvitationImage(savedEvent.id);
                if (invitationImage?.bannerUrl) {
                    savedEvent.banner_url = invitationImage.bannerUrl;
                    savedEvent.banner_layout = invitationImage.layout;
                    eventsCache = eventsCache.map((item) => item.id === savedEvent.id ? savedEvent : item);
                }
            } catch (imageError) {
                if (eventIdInput) eventIdInput.value = savedEvent.id;
                if (eventModalTitle) eventModalTitle.textContent = 'Editar evento';
                renderEvents();
                showFormError(`El evento quedó guardado, pero ${imageError?.message || 'no se pudo cargar la invitación.'}`);
                return;
            }
        }
        if (eventFinanceReady && savedEvent?.id && eventOnlineProvider) {
            try {
                const mode = payload.registration_mode === 'INTERNAL' && payload.pricing_model !== 'FREE'
                    ? paymentMode
                    : 'NONE';
                await saveEventPaymentOption(savedEvent.id, mode);
                await saveManualPaymentOption(savedEvent.id);
            } catch (paymentError) {
                if (eventIdInput) eventIdInput.value = savedEvent.id;
                if (eventModalTitle) eventModalTitle.textContent = 'Editar evento';
                renderEvents();
                showFormError(`El evento quedó guardado, pero ${paymentError?.message || 'no se pudo configurar el cobro.'}`);
                return;
            }
        }
        eventFormDirty = false;
        closeEventModal(btnNewEvent);
        renderEvents();
    } catch (error) {
        showFormError(error?.message || 'No se pudo guardar el evento.');
    } finally {
        eventSubmitBtn.textContent = originalText;
        eventSubmitBtn.disabled = false;
    }
});

document.addEventListener('keydown', (event) => {
    handleEventModalKeydown(event);
});

window.addEventListener('beforeunload', (event) => {
    if (!eventFormDirty || !eventModal?.classList.contains('flex')) return;
    event.preventDefault();
    event.returnValue = '';
});

async function init() {
    try {
        initEventDatePickers();
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
