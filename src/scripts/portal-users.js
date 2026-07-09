import { getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const tableEl = document.getElementById('users-table');
const gateEl = document.getElementById('users-gate');
const secureContentEl = document.getElementById('users-secure-content');
const tbody = tableEl?.querySelector('tbody');
const loadingEl = document.getElementById('users-loading');
const emptyEl = document.getElementById('users-empty');
const searchInput = document.getElementById('users-search');
const roleFilter = document.getElementById('users-role-filter');
const statusFilter = document.getElementById('users-status-filter');
const countryFilter = document.getElementById('users-country-filter');
const cityFilter = document.getElementById('users-city-filter');
const scopeFilter = document.getElementById('users-scope-filter');
const clearFiltersBtn = document.getElementById('users-clear-filters');
const usersSummaryEl = document.getElementById('users-summary');
const countEl = document.getElementById('users-count');

// Modal Elements
const modal = document.getElementById('create-user-modal');
const btnOpen = document.getElementById('btn-open-create-user');
const btnCancel = document.getElementById('btn-cancel-create');
const form = document.getElementById('create-user-form');
const btnSubmit = document.getElementById('btn-submit-create');
const roleSelect = document.getElementById('user-role-select');
const scopeCountryWrapper = document.getElementById('user-scope-country');
const scopeCountryInput = document.getElementById('user-country-input');
const scopeCountryList = document.getElementById('user-country-list');
const scopeRegionWrapper = document.getElementById('user-scope-region');
const scopeRegionSelect = document.getElementById('user-region-select');
const scopeChurchWrapper = document.getElementById('user-scope-church');
const scopeChurchSelect = document.getElementById('user-church-select');
const scopeCampusMissionaryWrapper = document.getElementById('user-campus-missionary');
const scopeCampusMissionarySelect = document.getElementById('user-campus-missionary-select');
const navLinkEvents = document.getElementById('nav-link-events');
const navLinkUsers = document.getElementById('nav-link-users');
const navLinkCampus = document.getElementById('nav-link-campus');
const navLinkFinances = document.getElementById('nav-link-finances');
const navLinkDonations = document.getElementById('nav-link-donations');
const navLinkRegions = document.getElementById('nav-link-regions');
const navLinkPrayers = document.getElementById('nav-link-prayers');

let currentUserRole = 'user';
let currentUserId = '';
let currentUserCountry = '';
let currentUserRegionId = '';
let currentUserChurchId = '';
let currentAllowedRegionIds = [];
let currentCreatableRoles = [];
let currentToken = '';
let currentMemberships = [];
let allUsers = [];
let churchesCatalog = [];
let regionsCatalog = [];
let scopeListenerAttached = false;
let scopeCatalogsPromise = null;
const pendingRoleChanges = new Map();

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

const roleTranslations = {
    'superadmin': 'Super Admin',
    'admin': 'Admin',
    'national_pastor': 'Pastor Nacional',
    'national_collaborator': 'Colaborador Nacional',
    'regional_pastor': 'Pastor Regional',
    'regional_collaborator': 'Colaborador Regional',
    'campus_missionary': 'Misionero Campus',
    'finance': 'Equipo Financiero',
    'intercessor': 'Intercesor',
    'pastor': 'Pastor Local',
    'local_collaborator': 'Colaborador Local',
    'leader': 'Líder (Legacy)',
    'user': 'Usuario (Asistente)'
};

const roleOrder = [
    'superadmin',
    'admin',
    'national_pastor',
    'national_collaborator',
    'regional_pastor',
    'regional_collaborator',
    'campus_missionary',
    'finance',
    'intercessor',
    'pastor',
    'local_collaborator',
    'leader',
    'user',
];

const quickRoleChangeRoles = new Set([
    'superadmin',
    'admin',
    'campus_missionary',
    'finance',
    'intercessor',
    'user',
]);

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
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
    } finally {
        window.clearTimeout(timeoutId);
    }
}

const accessStatusTranslations = {
    active: 'Activo',
    invited: 'Invitado',
    confirmed: 'Confirmado',
    pending: 'Pendiente',
    blocked: 'Bloqueado',
    deleted: 'Eliminado',
    unknown: 'Sin diagnóstico',
};

const summaryStatusOrder = ['all', 'active', 'invited', 'pending', 'blocked', 'deleted'];

const scopeCategoryLabels = {
    global: 'Global',
    national: 'Nacional',
    regional: 'Regional',
    church: 'Iglesia',
    campus: 'Campus',
    intercession: 'Intercesión',
    assistant: 'Asistente',
};

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

function normalizeSearchText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function getUserCountry(user) {
    return String(user?.church?.country || user?.country || '').trim();
}

function getUserCity(user) {
    return String(user?.church?.city || user?.city || '').trim();
}

function getScopeCategory(user) {
    const role = String(user?.role || 'user');
    if (role === 'superadmin' || role === 'admin' || role === 'finance') return 'global';
    if (role === 'national_pastor' || role === 'national_collaborator') return 'national';
    if (role === 'regional_pastor' || role === 'regional_collaborator') return 'regional';
    if (role === 'pastor' || role === 'local_collaborator' || role === 'leader') return 'church';
    if (role === 'campus_missionary') return 'campus';
    if (role === 'intercessor') return 'intercession';
    return 'assistant';
}

function getSearchableUserText(user) {
    const role = String(user?.role || '');
    const roleLabel = roleTranslations[role] || role;
    const country = getUserCountry(user);
    const city = getUserCity(user);
    const churchName = String(user?.church?.name || user?.church_name || '');
    const regionName = String(user?.region?.name || '');
    const regionCode = String(user?.region?.code || '');
    const status = String(user?.access_status || '');
    const statusLabel = accessStatusTranslations[status] || status;
    const scopeLabel = getScopeLabel(user);
    const scopeCategory = scopeCategoryLabels[getScopeCategory(user)] || '';
    const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return normalizeSearchText([
        name,
        user?.email || '',
        role,
        roleLabel,
        country,
        city,
        churchName,
        regionName,
        regionCode,
        status,
        statusLabel,
        scopeLabel,
        scopeCategory,
    ].join(' '));
}

function applySidebarPermissions(role, memberships = [], permissions = {}) {
    const membershipRoles = (memberships || []).map((m) => m?.role).filter(Boolean);
    let effectiveRole = role || 'user';
    if (effectiveRole === 'user') {
        if (membershipRoles.includes('church_admin')) {
            effectiveRole = 'pastor';
        } else if (membershipRoles.includes('church_member')) {
            effectiveRole = 'local_collaborator';
        }
    }

    const eventManagementRoles = ['superadmin', 'admin', 'national_pastor', 'regional_pastor', 'pastor'];
    const userManagementRoles = ['superadmin', 'admin', 'national_pastor', 'national_collaborator', 'regional_pastor', 'regional_collaborator', 'pastor', 'local_collaborator', 'leader'];
    const campusRoles = ['superadmin', 'admin', 'finance', 'campus_missionary'];
    const financeRoles = ['superadmin', 'admin', 'finance'];
    const regionsRoles = ['superadmin', 'admin'];
    const prayerRoles = ['superadmin', 'admin', 'intercessor'];
    const hasPermissionPayload = permissions && typeof permissions === 'object' && Object.keys(permissions).length > 0;
    const canManageEvents = hasPermissionPayload
        ? Boolean(
            permissions.can_manage_local_events
            || permissions.can_manage_regional_events
            || permissions.can_manage_national_events
            || permissions.can_manage_global_events
        )
        : eventManagementRoles.includes(effectiveRole);
    const canManageUsers = hasPermissionPayload
        ? Boolean(permissions.can_manage_users)
        : userManagementRoles.includes(effectiveRole);
    const canAccessCampus = hasPermissionPayload
        ? Boolean(permissions.can_access_campus)
        : campusRoles.includes(effectiveRole);
    const canAccessFinances = hasPermissionPayload
        ? Boolean(permissions.can_access_finances)
        : financeRoles.includes(effectiveRole);
    const canAccessPrayers = hasPermissionPayload
        ? Boolean(permissions.can_access_prayers)
        : prayerRoles.includes(effectiveRole);

    if (navLinkEvents) navLinkEvents.style.display = canManageEvents ? 'flex' : 'none';
    if (navLinkUsers) navLinkUsers.style.display = canManageUsers ? 'flex' : 'none';
    if (navLinkCampus) navLinkCampus.style.display = canAccessCampus ? 'flex' : 'none';
    if (navLinkFinances) navLinkFinances.style.display = canAccessFinances ? 'flex' : 'none';
    if (navLinkDonations) navLinkDonations.style.display = canAccessFinances ? 'flex' : 'none';
    if (navLinkRegions) navLinkRegions.style.display = regionsRoles.includes(effectiveRole) ? 'flex' : 'none';
    if (navLinkPrayers) navLinkPrayers.style.display = canAccessPrayers ? 'flex' : 'none';
    return effectiveRole;
}

async function init() {
    showGate();
    const { auth, data: payload } = await getPortalSession();
    if (!auth.isAuthenticated) {
        redirectToLogin();
        return;
    }

    if (!payload?.ok) {
        showSecureContent();
        if (loadingEl) loadingEl.textContent = payload?.error || 'No se pudo validar la sesión.';
        return;
    }

    const token = auth.token || '';
    currentToken = token;

    // 1. Get My Profile to set UI permissions
    try {
        if (payload?.ok) {
            const profile = payload.profile || {};
            const memberships = payload.memberships || [];
            const scopeContext = payload.scope_context || {};
            const allowedRegionIds = Array.isArray(scopeContext.allowed_region_ids)
                ? scopeContext.allowed_region_ids.filter(Boolean)
                : [];
            currentMemberships = memberships;
            currentUserRole = profile.role || 'user';
            currentUserId = profile.user_id || '';
            currentUserCountry = scopeContext.allowed_country || profile.country || '';
            currentAllowedRegionIds = allowedRegionIds;
            currentUserRegionId = allowedRegionIds[0] || profile.region_id || '';
            currentUserChurchId = scopeContext.allowed_church_id
                || profile.church_id
                || profile.portal_church_id
                || memberships.find((m) => m?.church?.id)?.church?.id
                || '';
            currentCreatableRoles = Array.isArray(payload.creatable_roles) ? payload.creatable_roles : [];

            currentUserRole = applySidebarPermissions(currentUserRole, memberships, payload.permissions || {});
            if (!payload.permissions?.can_manage_users) {
                window.location.replace('/portal');
                return;
            }
            showSecureContent();

            // Hide Create Button for Roles that cannot create users
            if (btnOpen) btnOpen.style.display = currentCreatableRoles.length ? '' : 'none';

            if (currentUserRole === 'admin' || currentUserRole === 'superadmin') {
                document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            }
        }
    } catch (e) { console.error(e); }

    // 2. Load Users before optional create-user catalogs so the table paints faster.
    loadUsers(token);

    const warmScopeCatalogs = () => {
        void ensureScopeCatalogs(token);
    };
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(warmScopeCatalogs, { timeout: 2000 });
    } else {
        window.setTimeout(warmScopeCatalogs, 1000);
    }

    // 3. Setup Events
    setupModal(token);

    searchInput?.addEventListener('input', () => applyFilters());
    roleFilter?.addEventListener('change', () => applyFilters());
    statusFilter?.addEventListener('change', () => applyFilters());
    countryFilter?.addEventListener('change', () => {
        populateLocationFilters();
        applyFilters();
    });
    cityFilter?.addEventListener('change', () => applyFilters());
    scopeFilter?.addEventListener('change', () => applyFilters());

    usersSummaryEl?.addEventListener('click', (event) => {
        const source = event.target;
        const target = source instanceof Element ? source.closest('[data-summary-status]') : null;
        if (!target || !statusFilter) return;
        statusFilter.value = target.dataset.summaryStatus || '';
        applyFilters();
    });

    clearFiltersBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (roleFilter) roleFilter.value = '';
        if (statusFilter) statusFilter.value = '';
        if (countryFilter) countryFilter.value = '';
        if (scopeFilter) scopeFilter.value = '';
        populateLocationFilters();
        if (cityFilter) cityFilter.value = '';
        applyFilters();
    });
}

async function loadChurches() {
    if (!scopeChurchSelect || !scopeCountryList) return;
    try {
        const res = await fetch('/api/portal/churches');
        if (!res.ok) return;
        const data = await res.json();
        churchesCatalog = Array.isArray(data) ? data : [];
        populateScopeOptions();
    } catch (err) {
        console.error(err);
    }
}

async function loadRegions(token) {
    if (!scopeRegionSelect || !token) return;
    try {
        const res = await fetch('/api/portal/regions', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
            regionsCatalog = [];
            populateRegionOptions();
            return;
        }
        const payload = await res.json();
        regionsCatalog = Array.isArray(payload?.regions) ? payload.regions : [];
        populateRegionOptions();
    } catch (err) {
        console.error(err);
        regionsCatalog = [];
        populateRegionOptions();
    }
}

function ensureScopeCatalogs(token) {
    if (!scopeCatalogsPromise) {
        scopeCatalogsPromise = Promise.all([
            loadChurches(),
            loadRegions(token),
        ]).catch((err) => {
            scopeCatalogsPromise = null;
            console.error(err);
        });
    }
    return scopeCatalogsPromise;
}

function populateScopeOptions() {
    if (!scopeChurchSelect || !scopeCountryList) return;
    let scoped = churchesCatalog;
    if ((currentUserRole === 'national_pastor' || currentUserRole === 'national_collaborator') && currentUserCountry) {
        scoped = scoped.filter(c => (c.country || '').toLowerCase() === currentUserCountry.toLowerCase());
    }
    if (currentUserRole === 'regional_pastor' || currentUserRole === 'regional_collaborator') {
        const allowedRegionIds = currentAllowedRegionIds.length
            ? currentAllowedRegionIds
            : (currentUserRegionId ? [currentUserRegionId] : []);
        if (allowedRegionIds.length) {
            scoped = scoped.filter(c => allowedRegionIds.includes(c.region_id));
        }
    }
    scopeChurchSelect.innerHTML = '<option value="">Selecciona una iglesia</option>' +
        scoped
            .map(c => {
                const safeId = escapeAttr(c.id || '');
                const cityLabel = c.city || c.country || 'Ciudad';
                const safeCity = escapeHtml(cityLabel);
                const safeName = escapeHtml(c.name || '');
                const countryLabel = c.country ? ` · ${escapeHtml(c.country)}` : '';
                return `<option value="${safeId}">${safeCity} · ${safeName}${countryLabel}</option>`;
            })
            .join('');

    const countries = Array.from(new Set(churchesCatalog.map(c => c.country).filter(Boolean))).sort();
    scopeCountryList.innerHTML = countries.map(c => `<option value="${escapeAttr(c)}"></option>`).join('');
}

function populateRegionOptions() {
    if (!scopeRegionSelect) return;
    let scopedRegions = regionsCatalog;

    if ((currentUserRole === 'national_pastor' || currentUserRole === 'national_collaborator') && currentUserCountry) {
        scopedRegions = scopedRegions.filter(r => (r.country || '').toLowerCase() === currentUserCountry.toLowerCase());
    }

    if (currentUserRole === 'regional_pastor' || currentUserRole === 'regional_collaborator') {
        const allowedRegionIds = currentAllowedRegionIds.length
            ? currentAllowedRegionIds
            : (currentUserRegionId ? [currentUserRegionId] : []);
        if (allowedRegionIds.length) {
            scopedRegions = scopedRegions.filter(r => allowedRegionIds.includes(r.id));
        }
    }

    scopeRegionSelect.innerHTML = '<option value="">Selecciona una región</option>' +
        scopedRegions
            .filter(r => r?.is_active !== false)
            .map((region) => {
                const label = `${region.code || 'REG'} · ${region.name || 'Región'}${region.country ? ` (${region.country})` : ''}`;
                return `<option value="${escapeAttr(region.id || '')}">${escapeHtml(label)}</option>`;
            })
            .join('');
}

function updateScopeFields(role) {
    const needsCountry = role === 'national_pastor' || role === 'national_collaborator';
    const needsRegion = role === 'regional_pastor' || role === 'regional_collaborator';
    const needsChurch = role === 'pastor' || role === 'local_collaborator' || role === 'leader';
    const needsCampusMissionary = role === 'campus_missionary';
    const isNationalCreator = currentUserRole === 'national_pastor' || currentUserRole === 'national_collaborator';
    const isRegionalCreator = currentUserRole === 'regional_pastor' || currentUserRole === 'regional_collaborator';
    const isLocalCreator = currentUserRole === 'pastor' || currentUserRole === 'local_collaborator' || currentUserRole === 'leader';
    const allowedRegionIds = currentAllowedRegionIds.length
        ? currentAllowedRegionIds
        : (currentUserRegionId ? [currentUserRegionId] : []);

    if (scopeCountryWrapper && scopeCountryInput) {
        scopeCountryWrapper.classList.toggle('hidden', !needsCountry);
        scopeCountryInput.disabled = !needsCountry || (needsCountry && isNationalCreator);
        if (!needsCountry) {
            scopeCountryInput.value = '';
        } else if (isNationalCreator && currentUserCountry) {
            scopeCountryInput.value = currentUserCountry;
        }
    }

    if (scopeRegionWrapper && scopeRegionSelect) {
        scopeRegionWrapper.classList.toggle('hidden', !needsRegion);
        if (!needsRegion) {
            scopeRegionSelect.disabled = true;
            scopeRegionSelect.value = '';
        } else {
            scopeRegionSelect.disabled = false;
            if (isRegionalCreator && allowedRegionIds.length === 1) {
                scopeRegionSelect.value = allowedRegionIds[0];
                scopeRegionSelect.disabled = true;
            } else if (isRegionalCreator && allowedRegionIds.length > 1) {
                if (!allowedRegionIds.includes(scopeRegionSelect.value)) {
                    scopeRegionSelect.value = '';
                }
            }
        }
    }

    if (scopeChurchWrapper && scopeChurchSelect) {
        scopeChurchWrapper.classList.toggle('hidden', !needsChurch);
        if (!needsChurch) {
            scopeChurchSelect.disabled = true;
            scopeChurchSelect.value = '';
        } else if (isLocalCreator && currentUserChurchId) {
            scopeChurchSelect.value = currentUserChurchId;
            scopeChurchSelect.disabled = true;
        } else {
            scopeChurchSelect.disabled = false;
        }
    }

    if (scopeCampusMissionaryWrapper && scopeCampusMissionarySelect) {
        scopeCampusMissionaryWrapper.classList.toggle('hidden', !needsCampusMissionary);
        scopeCampusMissionarySelect.disabled = !needsCampusMissionary;
        if (!needsCampusMissionary) {
            scopeCampusMissionarySelect.value = '';
        }
    }
}

function attachScopeListener() {
    if (scopeListenerAttached || !roleSelect) return;
    roleSelect.addEventListener('change', () => updateScopeFields(roleSelect.value));
    scopeListenerAttached = true;
}

async function loadUsers(token) {
    try {
        const res = await fetch('/api/portal/admin/users/list', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 403) {
            window.location.replace('/portal');
            return;
        }

        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        allUsers = data.users || [];
        pendingRoleChanges.clear();
        populateLocationFilters();
        renderSummaryCards();
        applyFilters();

    } catch (err) {
        console.error(err);
        if (loadingEl) loadingEl.textContent = 'Error al cargar usuarios.';
    }
}

function populateLocationFilters() {
    if (!countryFilter && !cityFilter) return;

    const selectedCountry = countryFilter?.value || '';
    const selectedCity = cityFilter?.value || '';

    const countries = Array.from(new Set(
        (allUsers || [])
            .map((user) => getUserCountry(user))
            .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'es'));

    if (countryFilter) {
        countryFilter.innerHTML = '<option value="">Todos los países</option>'
            + countries.map((country) => `<option value="${escapeAttr(country)}">${escapeHtml(country)}</option>`).join('');
        if (countries.includes(selectedCountry)) {
            countryFilter.value = selectedCountry;
        } else {
            countryFilter.value = '';
        }
    }

    const countryScope = countryFilter?.value || '';
    const cities = Array.from(new Set(
        (allUsers || [])
            .filter((user) => {
                if (!countryScope) return true;
                return getUserCountry(user) === countryScope;
            })
            .map((user) => getUserCity(user))
            .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b, 'es'));

    if (cityFilter) {
        cityFilter.innerHTML = '<option value="">Todas las ciudades</option>'
            + cities.map((city) => `<option value="${escapeAttr(city)}">${escapeHtml(city)}</option>`).join('');
        if (cities.includes(selectedCity)) {
            cityFilter.value = selectedCity;
        } else {
            cityFilter.value = '';
        }
    }
}

function renderSummaryCards() {
    if (!usersSummaryEl) return;
    const selectedStatus = statusFilter?.value || '';
    const counts = (allUsers || []).reduce((acc, user) => {
        const status = String(user?.access_status || 'unknown');
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    usersSummaryEl.innerHTML = summaryStatusOrder.map((statusKey) => {
        const isAll = statusKey === 'all';
        const count = isAll ? allUsers.length : (counts[statusKey] || 0);
        const isActive = (isAll && !selectedStatus) || selectedStatus === statusKey;
        const title = isAll ? 'Todos' : (accessStatusTranslations[statusKey] || statusKey);
        const style = isActive
            ? 'border-[#293C74] bg-[#EEF2FF] text-[#293C74]'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
        return `
            <button
                type="button"
                data-summary-status="${escapeAttr(isAll ? '' : statusKey)}"
                class="text-left rounded-xl border px-3 py-2 transition-colors ${style}"
            >
                <p class="text-[10px] uppercase tracking-widest font-bold">${escapeHtml(title)}</p>
                <p class="text-lg font-black leading-tight">${escapeHtml(count)}</p>
            </button>
        `;
    }).join('');
}

function applyFilters() {
    const query = normalizeSearchText(searchInput?.value || '');
    const roleValue = roleFilter?.value || '';
    const statusValue = statusFilter?.value || '';
    const countryValue = countryFilter?.value || '';
    const cityValue = cityFilter?.value || '';
    const scopeValue = scopeFilter?.value || '';
    const queryTokens = query ? query.split(/\s+/).filter(Boolean) : [];

    renderSummaryCards();

    const filtered = (allUsers || []).filter((user) => {
        const searchable = getSearchableUserText(user);
        if (queryTokens.length && queryTokens.some((token) => !searchable.includes(token))) return false;
        if (roleValue && user.role !== roleValue) return false;
        if (statusValue && user.access_status !== statusValue) return false;
        if (countryValue && getUserCountry(user) !== countryValue) return false;
        if (cityValue && getUserCity(user) !== cityValue) return false;
        if (scopeValue && getScopeCategory(user) !== scopeValue) return false;
        return true;
    });
    renderTable(filtered);
}

function roleBadgeClass(role) {
    if (role === 'admin' || role === 'superadmin') return 'bg-purple-100 text-purple-700';
    if (role === 'finance') return 'bg-amber-100 text-amber-800';
    if (role === 'intercessor') return 'bg-rose-100 text-rose-700';
    if (role === 'pastor' || role === 'national_pastor' || role === 'regional_pastor') return 'bg-blue-100 text-blue-700';
    if (role === 'local_collaborator' || role === 'national_collaborator' || role === 'regional_collaborator') return 'bg-teal-100 text-teal-700';
    return 'bg-slate-100 text-slate-600';
}

function statusBadgeClass(status) {
    if (status === 'active') return 'bg-emerald-100 text-emerald-700';
    if (status === 'invited') return 'bg-amber-100 text-amber-700';
    if (status === 'confirmed') return 'bg-cyan-100 text-cyan-700';
    if (status === 'blocked') return 'bg-rose-100 text-rose-700';
    if (status === 'deleted') return 'bg-slate-200 text-slate-700';
    return 'bg-slate-100 text-slate-600';
}

function formatDateTime(value) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}

function getScopeLabel(user) {
    const role = user?.role || 'user';
    const church = user?.church || null;
    const region = user?.region || null;
    const churchName = church?.name || user?.church_name || '';
    const cityName = church?.city || user?.city || '';
    const countryName = church?.country || user?.country || '';
    const regionName = region?.name || '';
    const regionCode = region?.code || '';

    if (role === 'national_pastor' || role === 'national_collaborator') {
        return countryName ? `País: ${countryName}` : 'País no asignado';
    }

    if (role === 'regional_pastor' || role === 'regional_collaborator') {
        if (regionName || regionCode) {
            const regionLabel = regionCode && regionName ? `${regionCode} · ${regionName}` : (regionCode || regionName);
            return countryName ? `Región: ${regionLabel} · ${countryName}` : `Región: ${regionLabel}`;
        }
        return user?.region_id ? 'Región asignada' : 'Región no asignada';
    }

    if (role === 'pastor' || role === 'local_collaborator' || role === 'leader') {
        if (!churchName) return 'Iglesia no asignada';
        const parts = [churchName];
        if (cityName) parts.push(cityName);
        if (countryName) parts.push(countryName);
        return parts.join(' · ');
    }

    if (role === 'campus_missionary') {
        return countryName ? `Campus · ${countryName}` : 'Campus';
    }

    return countryName || 'Global';
}

function renderRoleCell(user) {
    const pendingRole = pendingRoleChanges.get(user.user_id);
    const selectedRole = pendingRole?.nextRole || user.role;
    if (currentUserRole === 'superadmin') {
        const options = roleOrder.filter((role) => quickRoleChangeRoles.has(role) || role === selectedRole).map((role) => {
            const label = escapeHtml(roleTranslations[role] || role);
            const safeRole = escapeAttr(role);
            const selected = selectedRole === role ? 'selected' : '';
            return `<option value="${safeRole}" ${selected}>${label}</option>`;
        }).join('');
        const selectedCampusSlug = pendingRole?.campusMissionarySlug ?? user.campus_missionary_slug ?? '';
        const campusOptions = Array.from(scopeCampusMissionarySelect?.options || [])
            .filter((option) => option.value)
            .map((option) => {
                const selected = option.value === selectedCampusSlug ? 'selected' : '';
                return `<option value="${escapeAttr(option.value)}" ${selected}>${escapeHtml(option.textContent || option.value)}</option>`;
            })
            .join('');
        return `
            <div class="space-y-1">
                <select data-action="role" data-user-id="${escapeAttr(user.user_id || '')}" class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-[#293C74]">
                    ${options}
                </select>
                ${selectedRole === 'campus_missionary' ? `
                    <select data-action="campus-missionary" data-user-id="${escapeAttr(user.user_id || '')}" class="max-w-48 bg-white border border-slate-200 rounded-lg px-2 py-2 text-[11px] font-semibold text-slate-600">
                        <option value="">Selecciona misionero</option>
                        ${campusOptions}
                    </select>
                ` : ''}
                ${pendingRole ? '<p class="text-[10px] text-amber-600 font-bold uppercase tracking-wider">Cambio pendiente</p>' : ''}
            </div>
        `;
    }

    const label = escapeHtml(roleTranslations[selectedRole] || selectedRole || 'Usuario');
    const badgeClass = roleBadgeClass(selectedRole);
    return `
        <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
            ${label}
        </span>
    `;
}

function renderActionsCell(user, canSendAccessLink, canCopyAccessLink, safeEmailAttr, resetLabel) {
    const pendingRole = pendingRoleChanges.get(user.user_id);
    const isDeleted = user?.access_status === 'deleted' || user?.is_account_deleted === true;
    const isBlocked = user?.access_status === 'blocked' || user?.is_blocked === true;
    const isActorSuperadmin = currentUserRole === 'superadmin';
    const isTargetSuperadmin = String(user?.role || '') === 'superadmin';
    const isSelf = Boolean(currentUserId && user?.user_id === currentUserId);
    const resetButton = canSendAccessLink
        ? (isDeleted
            ? '<span class="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cuenta eliminada</span>'
            : `<button data-action="reset" data-email="${safeEmailAttr}" class="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-[#293C74] hover:bg-slate-100">${escapeHtml(resetLabel)}</button>`)
        : '';
    const accessLinkButton = canCopyAccessLink && !isDeleted
        ? `<button data-action="copy-access-link" data-email="${safeEmailAttr}" title="Generar y copiar enlace temporal de acceso" class="px-3 py-2 rounded-lg border border-cyan-200 bg-cyan-50 text-xs font-bold text-cyan-800 hover:bg-cyan-100">Copiar enlace</button>`
        : '';
    let lifecycleButtons = '';
    if (isActorSuperadmin && !isSelf && !isTargetSuperadmin) {
        if (isDeleted) {
            lifecycleButtons = `<button data-action="restore-user" data-user-id="${escapeAttr(user.user_id || '')}" class="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 hover:bg-emerald-100">Restaurar</button>`;
        } else {
            const blockLabel = isBlocked ? 'Desbloquear' : 'Bloquear';
            const blockAction = isBlocked ? 'unblock-user' : 'block-user';
            lifecycleButtons = `
                <button data-action="${blockAction}" data-user-id="${escapeAttr(user.user_id || '')}" class="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs font-bold text-amber-700 hover:bg-amber-100">${blockLabel}</button>
                <button data-action="delete-user" data-user-id="${escapeAttr(user.user_id || '')}" class="px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700 hover:bg-rose-100">Eliminar</button>
            `;
        }
    }

    if (!pendingRole) {
        const combined = [lifecycleButtons, accessLinkButton, resetButton].filter(Boolean).join('');
        if (!combined) {
            return '<span class="text-[10px] text-slate-400 uppercase tracking-widest">-</span>';
        }
        return `<div class="flex items-center justify-end gap-2 flex-wrap">${combined}</div>`;
    }

    return `
        <div class="flex items-center justify-end gap-2 flex-wrap">
            <button data-action="cancel-role" data-user-id="${escapeAttr(user.user_id || '')}" class="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button data-action="save-role" data-user-id="${escapeAttr(user.user_id || '')}" class="px-3 py-2 rounded-lg bg-[#293C74] text-xs font-bold text-white hover:brightness-110">Guardar rol</button>
            ${lifecycleButtons}
            ${accessLinkButton}
            ${resetButton}
        </div>
    `;
}

function renderTable(users) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (countEl) {
        const total = allUsers.length;
        const count = users.length;
        const hasFilters = Boolean(searchInput?.value || roleFilter?.value || statusFilter?.value);
        countEl.textContent = hasFilters ? `${count} de ${total} usuarios` : `${total} usuarios`;
    }
    if (users.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (tableEl) tableEl.classList.add('hidden');
        return;
    }

    if (tableEl) tableEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    if (tbody) {
        tbody.innerHTML = users.map(u => {
            const fullName = u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Sin nombre';
            const safeFullName = escapeHtml(fullName);
            const safeEmail = escapeHtml(u.email || '');
            const safeEmailAttr = escapeAttr(u.email || '');
            const accessStatus = u.access_status || 'unknown';
            const safeStatusLabel = escapeHtml(accessStatusTranslations[accessStatus] || accessStatus);
            const accessStatusClass = statusBadgeClass(accessStatus);
            const lastSignInLabel = formatDateTime(u.last_sign_in_at);
            const safeLastSignIn = escapeHtml(lastSignInLabel);
            const scopeLabel = getScopeLabel(u);
            const safeScope = escapeHtml(scopeLabel);
            const resetLabel = accessStatus === 'invited' || accessStatus === 'pending' ? 'Reenviar acceso' : 'Reset contraseña';
            const canSendAccessLink = ['superadmin', 'admin', 'national_pastor', 'regional_pastor', 'pastor', 'local_collaborator'].includes(currentUserRole);
            const protectedAccessLinkRoles = ['superadmin', 'admin', 'finance'];
            const canCopyAccessLink = ['superadmin', 'admin'].includes(currentUserRole)
                && (currentUserRole === 'superadmin' || !protectedAccessLinkRoles.includes(u.role));
            return `
                <tr class="group hover:bg-slate-50 transition-colors">
                    <td class="py-3 pl-2 font-medium text-[#293C74]">${safeFullName}</td>
                    <td class="py-3 text-slate-500">${safeEmail}</td>
                    <td class="py-3">
                        ${renderRoleCell(u)}
                    </td>
                    <td class="py-3 text-slate-500 text-xs font-semibold">${safeScope}</td>
                    <td class="py-3">
                        <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${accessStatusClass}">
                            ${safeStatusLabel}
                        </span>
                    </td>
                    <td class="py-3 text-slate-400 text-xs">${safeLastSignIn}</td>
                    <td class="py-3 text-right pr-2">
                        ${renderActionsCell(u, canSendAccessLink, canCopyAccessLink, safeEmailAttr, resetLabel)}
                    </td>
                </tr>
            `;
        }).join('');
    }
}

tbody?.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!['role', 'campus-missionary'].includes(target.dataset.action)) return;
    const userId = target.dataset.userId;
    if (!userId || !currentToken) return;
    const role = target.value;
    const user = allUsers.find((item) => item.user_id === userId);
    if (!user) return;

    if (target.dataset.action === 'campus-missionary') {
        const pending = pendingRoleChanges.get(userId) || {
            previousRole: user.role,
            nextRole: 'campus_missionary',
        };
        pending.campusMissionarySlug = target.value;
        pendingRoleChanges.set(userId, pending);
        applyFilters();
        return;
    }

    if (user.role === role) {
        pendingRoleChanges.delete(userId);
    } else {
        pendingRoleChanges.set(userId, {
            previousRole: user.role,
            nextRole: role,
            campusMissionarySlug: role === 'campus_missionary' ? (user.campus_missionary_slug || '') : null,
        });
    }
    applyFilters();
});

tbody?.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !currentToken) return;
    const action = target.dataset.action;

    if (action === 'copy-access-link') {
        const email = target.dataset.email;
        if (!email) return;
        const originalText = target.textContent;
        target.textContent = 'Generando...';
        target.setAttribute('disabled', 'disabled');
        try {
            const res = await fetch('/api/portal/admin/access-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                credentials: 'include',
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok || !data.actionUrl) {
                throw new Error(data.error || 'No se pudo generar el enlace');
            }
            await copySensitiveText(data.actionUrl);
            target.textContent = 'Enlace copiado';
            window.setTimeout(() => {
                target.textContent = originalText;
                target.removeAttribute('disabled');
            }, 2500);
        } catch (err) {
            console.error(err);
            target.textContent = originalText;
            target.removeAttribute('disabled');
            alert(err.message || 'No se pudo generar el enlace.');
        }
        return;
    }

    if (action === 'save-role') {
        const userId = target.dataset.userId;
        const pending = userId ? pendingRoleChanges.get(userId) : null;
        if (!userId || !pending) return;
        const user = allUsers.find((item) => item.user_id === userId);
        if (!user) return;
        const roleLabel = roleTranslations[pending.nextRole] || pending.nextRole;
        if (pending.nextRole === 'campus_missionary' && !pending.campusMissionarySlug) {
            alert('Selecciona el misionero Campus que corresponde a esta cuenta.');
            return;
        }
        const confirmed = window.confirm(`¿Guardar cambio de rol para ${user.email}?\nNuevo rol: ${roleLabel}`);
        if (!confirmed) return;

        const originalText = target.textContent;
        target.textContent = 'Guardando...';
        target.setAttribute('disabled', 'disabled');
        try {
            const res = await fetch('/api/portal/admin/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify({
                    userId,
                    role: pending.nextRole,
                    campusMissionarySlug: pending.campusMissionarySlug || null,
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar el rol');
            const idx = allUsers.findIndex((item) => item.user_id === userId);
            if (idx !== -1) {
                allUsers[idx].role = pending.nextRole;
                allUsers[idx].campus_missionary_slug = pending.nextRole === 'campus_missionary'
                    ? pending.campusMissionarySlug
                    : null;
            }
            pendingRoleChanges.delete(userId);
            applyFilters();
        } catch (err) {
            console.error(err);
            target.textContent = originalText;
            target.removeAttribute('disabled');
            alert(err.message || 'No se pudo actualizar el rol.');
        }
        return;
    }

    if (action === 'cancel-role') {
        const userId = target.dataset.userId;
        if (!userId) return;
        pendingRoleChanges.delete(userId);
        applyFilters();
        return;
    }

    if (action === 'block-user' || action === 'unblock-user' || action === 'delete-user' || action === 'restore-user') {
        const userId = target.dataset.userId;
        if (!userId) return;
        const user = allUsers.find((item) => item.user_id === userId);
        if (!user) return;

        const lifecycleActionMap = {
            'block-user': 'block',
            'unblock-user': 'unblock',
            'delete-user': 'delete',
            'restore-user': 'restore',
        };
        const apiAction = lifecycleActionMap[action];
        if (!apiAction) return;

        const fullName = user.full_name || user.email || 'este usuario';
        let confirmationMessage = '';
        if (apiAction === 'block') {
            confirmationMessage = `¿Bloquear acceso de ${fullName}?`;
        } else if (apiAction === 'unblock') {
            confirmationMessage = `¿Desbloquear acceso de ${fullName}?`;
        } else if (apiAction === 'delete') {
            confirmationMessage = `¿Eliminar (soft-delete) la cuenta de ${fullName}?`;
        } else {
            confirmationMessage = `¿Restaurar cuenta de ${fullName}?`;
        }

        const confirmed = window.confirm(confirmationMessage);
        if (!confirmed) return;

        let reason = '';
        if (apiAction === 'delete') {
            const promptValue = window.prompt('Motivo (opcional):', '');
            if (promptValue === null) return;
            reason = String(promptValue || '').trim();
        }

        const originalText = target.textContent;
        target.textContent = 'Procesando...';
        target.setAttribute('disabled', 'disabled');
        try {
            const res = await fetch('/api/portal/admin/users/lifecycle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify({ userId, action: apiAction, reason }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');
            await loadUsers(currentToken);
            applyFilters();
        } catch (err) {
            console.error(err);
            target.textContent = originalText;
            target.removeAttribute('disabled');
            alert(err.message || 'No se pudo actualizar.');
        }
        return;
    }

    if (action !== 'reset') return;
    const email = target.dataset.email;
    if (!email) return;
    const originalText = target.textContent;
    target.textContent = 'Enviando...';
    target.setAttribute('disabled', 'disabled');
    try {
        const res = await fetch('/api/portal/admin/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo enviar');
        target.textContent = 'Enviado';
    } catch (err) {
        console.error(err);
        target.textContent = originalText;
        target.removeAttribute('disabled');
        alert(err.message || 'No se pudo enviar.');
    }
});

async function copySensitiveText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('El navegador no permitió copiar el enlace');
}

function setupModal(token) {
    btnOpen?.addEventListener('click', () => {
        if (!currentCreatableRoles.length) {
            alert('No tienes permisos para crear usuarios.');
            return;
        }

        modal?.classList.remove('hidden');

        // Populate Roles dynamically
        if (roleSelect) {
            roleSelect.innerHTML = '';
            const allowedRoles = roleOrder.filter((role) => currentCreatableRoles.includes(role));

            allowedRoles.forEach((role) => {
                const opt = document.createElement('option');
                opt.value = role;
                opt.textContent = roleTranslations[role] || role;
                roleSelect.appendChild(opt);
            });

            if (!allowedRoles.length) {
                alert('No tienes permisos para crear usuarios.');
                modal?.classList.add('hidden');
                return;
            }
            roleSelect.value = allowedRoles[0];
            attachScopeListener();
            populateScopeOptions();
            populateRegionOptions();
            updateScopeFields(roleSelect.value);
            void ensureScopeCatalogs(token).then(() => {
                populateScopeOptions();
                populateRegionOptions();
                updateScopeFields(roleSelect.value);
            });
        }
    });

    btnCancel?.addEventListener('click', () => {
        modal?.classList.add('hidden');
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const body = Object.fromEntries(formData);

        const originalText = btnSubmit.textContent;
        btnSubmit.textContent = 'Creando...';
        btnSubmit.disabled = true;

        try {
            const { res, data } = await fetchJsonWithTimeout('/api/portal/admin/users/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            }, 30000);

            if (!res.ok || !data.ok) throw new Error(data.error || 'Error al crear');

            let successMessage = 'Usuario creado exitosamente.';
            if (data.inviteSent) {
                successMessage = data.accessEmailSent
                    ? 'Usuario creado. Le enviamos un enlace para activar su cuenta y crear su contraseña.'
                    : 'Usuario creado, pero no se pudo enviar el correo de activación. Usa Reenviar acceso.';
            } else if (data.accessEmailSent) {
                successMessage = 'Usuario creado con contraseña temporal. También enviamos un enlace para activar o cambiar su contraseña.';
            } else {
                successMessage = 'Usuario creado con contraseña temporal, pero no se pudo enviar el correo. Entrégale la contraseña temporal o usa Reenviar acceso.';
            }
            alert(successMessage);
            modal?.classList.add('hidden');
            form.reset();
            loadUsers(token); // Reload list

        } catch (err) {
            console.error(err);
            const message = err?.name === 'AbortError'
                ? 'La creación tardó demasiado y se canceló. Revisa si el usuario se creó antes de intentarlo otra vez.'
                : err?.message || 'No se pudo crear el usuario.';
            alert(`Error: ${message}`);
        } finally {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
    });
}

init().catch((error) => {
    console.error('[portal-users] init error', error);
    showGate(error?.message || 'No se pudieron validar permisos.');
});
