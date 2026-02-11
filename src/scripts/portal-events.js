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

let authHeaders = {};
let eventsCache = [];
let currentRole = 'user';
let currentCountry = '';

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

function sanitizeUrl(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return '';
}

// Auth & Init
async function init() {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
        redirectToLogin();
        return;
    }

    authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

    await loadProfile();

    // Load Events
    loadEvents();
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

    if (eventData) {
        eventForm.querySelector('[name="title"]').value = eventData.title || '';
        eventForm.querySelector('[name="description"]').value = eventData.description || '';
        eventForm.querySelector('[name="start_date"]').value = toInputDateTime(eventData.start_date);
        eventForm.querySelector('[name="end_date"]').value = toInputDateTime(eventData.end_date);
        eventForm.querySelector('[name="scope"]').value = eventData.scope || 'LOCAL';
        eventForm.querySelector('[name="location_name"]').value = eventData.location_name || '';
        eventForm.querySelector('[name="location_address"]').value = eventData.location_address || '';
        eventForm.querySelector('[name="city"]').value = eventData.city || '';
        eventForm.querySelector('[name="country"]').value = eventData.country || '';
        eventForm.querySelector('[name="banner_url"]').value = eventData.banner_url || '';
    }

    syncScopeOptions();

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
    eventsLoading.classList.remove('hidden');
    eventsList.classList.add('hidden');
    eventsEmpty.classList.add('hidden');

    try {
        const res = await fetch('/api/portal/events', {
            headers: authHeaders,
            credentials: 'include'
        });
        const data = await res.json();

        if (!data.ok) throw new Error(data.error);

        eventsCache = data.events || [];
        renderEvents(eventsCache);
    } catch (err) {
        console.error(err);
        eventsEmpty.classList.remove('hidden'); // Fail gracefully
    } finally {
        eventsLoading.classList.add('hidden');
    }
}

async function loadProfile() {
    try {
        const res = await fetch('/api/portal/session', {
            headers: authHeaders,
            credentials: 'include'
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.ok) return;
        currentRole = data.profile?.role || 'user';
        currentCountry = data.profile?.country || '';
        applyRolePermissions();
    } catch (err) {
        console.error(err);
    }
}

function applyRolePermissions() {
    const canCreate = ['admin', 'superadmin', 'pastor'].includes(currentRole)
        || (currentRole === 'national_pastor' && currentCountry);
    if (btnNewEvent) {
        btnNewEvent.style.display = canCreate ? '' : 'none';
    }
}

function canEditEvent(event) {
    if (['admin', 'superadmin'].includes(currentRole)) return true;
    if (currentRole === 'pastor') return event.scope === 'LOCAL';
    if (currentRole === 'national_pastor') {
        if (!currentCountry) return false;
        return event.scope === 'NATIONAL' && event.country === currentCountry;
    }
    return false;
}

function syncScopeOptions() {
    if (!eventScopeSelect) return;
    const allowed = new Set();
    if (['admin', 'superadmin'].includes(currentRole)) {
        ['LOCAL', 'NATIONAL', 'GLOBAL'].forEach((s) => allowed.add(s));
    } else if (currentRole === 'national_pastor' && currentCountry) {
        allowed.add('NATIONAL');
    } else if (currentRole === 'pastor') {
        allowed.add('LOCAL');
    }
    const hasRestrictions = allowed.size > 0;
    eventScopeSelect.querySelectorAll('option').forEach((option) => {
        option.hidden = hasRestrictions && !allowed.has(option.value);
    });
    eventScopeSelect.disabled = !hasRestrictions;
    if (hasRestrictions && !allowed.has(eventScopeSelect.value)) {
        eventScopeSelect.value = allowed.values().next().value;
    }
}

// Render Events
function renderEvents(events) {
    if (events.length === 0) {
        eventsEmpty.classList.remove('hidden');
        return;
    }

    eventsList.innerHTML = events.map(event => {
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
    `}).join('');

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

        const res = await fetch('/api/portal/events', {
            method: eventId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            credentials: 'include',
            body: JSON.stringify(eventId ? { id: eventId, ...payload } : payload)
        });

        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

        // Reset and Reload
        eventForm.reset();
        closeEventModal();
        loadEvents();

    } catch (err) {
        alert(err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

// Run
init();
