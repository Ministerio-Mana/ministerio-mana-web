import { getPortalSession, redirectToLogin } from '@lib/portalAuthClient';
import {
    PORTAL_ROLE_LABELS,
    PORTAL_ROLE_ORDER,
    getPortalRoleDefinition,
    getRoleScope,
} from '@lib/portalRbac';
import {
    filterPortalChurches,
    filterPortalRegions,
    findPortalCountry,
    listPortalCities,
    listPortalCountries,
    normalizePortalCountryKey,
    normalizeTerritoryKey,
} from '@lib/portalGeography';

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
const paginationEl = document.getElementById('users-pagination');
const pageInfoEl = document.getElementById('users-page-info');
const pageSizeEl = document.getElementById('users-page-size');
const pagePrevBtn = document.getElementById('users-page-prev');
const pageNextBtn = document.getElementById('users-page-next');

// Modal Elements
const modal = document.getElementById('create-user-modal');
const btnOpen = document.getElementById('btn-open-create-user');
const btnCancel = document.getElementById('btn-cancel-create');
const createUserClose = document.getElementById('create-user-close');
const createUserFeedback = document.getElementById('create-user-feedback');
const form = document.getElementById('create-user-form');
const btnSubmit = document.getElementById('btn-submit-create');
const roleSelect = document.getElementById('user-role-select');
const scopeCountryWrapper = document.getElementById('user-scope-country');
const scopeCountryInput = document.getElementById('user-country-input');
const scopeCountryLabel = document.getElementById('user-country-label');
const scopeRegionWrapper = document.getElementById('user-scope-region');
const scopeRegionSelect = document.getElementById('user-region-select');
const scopeRegionLabel = document.getElementById('user-region-label');
const scopeChurchWrapper = document.getElementById('user-scope-church');
const scopeChurchSelect = document.getElementById('user-church-select');
const scopeCampusMissionaryWrapper = document.getElementById('user-campus-missionary');
const scopeCampusMissionarySelect = document.getElementById('user-campus-missionary-select');
const financeOnboardingWrapper = document.getElementById('user-finance-scope');
const financeOnboardingScope = document.getElementById('user-finance-scope-type');
const financeOnboardingCountryWrapper = document.getElementById('user-finance-country-wrapper');
const financeOnboardingCountry = document.getElementById('user-finance-country');
const financeOnboardingRegionWrapper = document.getElementById('user-finance-region-wrapper');
const financeOnboardingRegion = document.getElementById('user-finance-region');
const financeOnboardingChurchWrapper = document.getElementById('user-finance-church-wrapper');
const financeOnboardingChurch = document.getElementById('user-finance-church');
const roleScopeModal = document.getElementById('role-scope-modal');
const roleScopeForm = document.getElementById('role-scope-form');
const roleScopeClose = document.getElementById('role-scope-close');
const roleScopeCancel = document.getElementById('role-scope-cancel');
const roleScopeSave = document.getElementById('role-scope-save');
const roleScopeUser = document.getElementById('role-scope-user');
const roleScopeRole = document.getElementById('role-scope-role');
const roleScopeCountryWrapper = document.getElementById('role-scope-country-wrapper');
const roleScopeCountry = document.getElementById('role-scope-country');
const roleScopeRegionWrapper = document.getElementById('role-scope-region-wrapper');
const roleScopeRegion = document.getElementById('role-scope-region');
const roleScopeChurchWrapper = document.getElementById('role-scope-church-wrapper');
const roleScopeChurch = document.getElementById('role-scope-church');
const roleScopeCampusWrapper = document.getElementById('role-scope-campus-wrapper');
const roleScopeCampus = document.getElementById('role-scope-campus');
const roleScopeFeedback = document.getElementById('role-scope-feedback');
const financeAssignmentModal = document.getElementById('finance-assignment-modal');
const financeAssignmentClose = document.getElementById('finance-assignment-close');
const financeAssignmentCancel = document.getElementById('finance-assignment-cancel');
const financeAssignmentUser = document.getElementById('finance-assignment-user');
const financeAssignmentMigration = document.getElementById('finance-assignment-migration');
const financeAssignmentList = document.getElementById('finance-assignment-list');
const financeAssignmentCount = document.getElementById('finance-assignment-count');
const financeAssignmentForm = document.getElementById('finance-assignment-form');
const financeAssignmentScope = document.getElementById('finance-assignment-scope');
const financeAssignmentCountryWrapper = document.getElementById('finance-assignment-country-wrapper');
const financeAssignmentCountry = document.getElementById('finance-assignment-country');
const financeAssignmentRegionWrapper = document.getElementById('finance-assignment-region-wrapper');
const financeAssignmentRegion = document.getElementById('finance-assignment-region');
const financeAssignmentChurchWrapper = document.getElementById('finance-assignment-church-wrapper');
const financeAssignmentChurch = document.getElementById('finance-assignment-church');
const financeAssignmentFeedback = document.getElementById('finance-assignment-feedback');
const financeAssignmentSave = document.getElementById('finance-assignment-save');
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
let usersPage = 1;
let financeAssignmentUserId = '';
let roleScopeUserId = '';
let activeFinanceAssignments = [];
let financeHierarchyMigrationRequired = false;
let createUserDirty = false;
const dialogReturnFocus = new Map();

function getDialogFocusableElements(dialog) {
    if (!dialog) return [];
    return [...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0);
}

function showAccessibleDialog(dialog, preferredFocus = null) {
    if (!dialog) return;
    if (document.activeElement instanceof HTMLElement) dialogReturnFocus.set(dialog, document.activeElement);
    dialog.setAttribute('aria-hidden', 'false');
    dialog.classList.remove('hidden');
    dialog.classList.add('flex');
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => (preferredFocus || getDialogFocusableElements(dialog)[0])?.focus());
}

function hideAccessibleDialog(dialog, fallbackFocus = null) {
    if (!dialog) return;
    dialog.setAttribute('aria-hidden', 'true');
    dialog.classList.add('hidden');
    dialog.classList.remove('flex');
    document.body.style.overflow = '';
    const returnFocus = dialogReturnFocus.get(dialog) || fallbackFocus;
    dialogReturnFocus.delete(dialog);
    window.queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
        else fallbackFocus?.focus();
    });
}

function handleAccessibleDialogKeydown(event, dialog, closeButton) {
    if (!dialog || dialog.getAttribute('aria-hidden') !== 'false') return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeButton?.focus();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getDialogFocusableElements(dialog);
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

const roleTranslations = PORTAL_ROLE_LABELS;
const roleOrder = PORTAL_ROLE_ORDER;

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

function getCanonicalCountryLabel(value) {
    const raw = String(value || '').trim();
    return findPortalCountry(raw, churchesCatalog, regionsCatalog) || raw;
}

function getScopeCategory(user) {
    const role = String(user?.role || 'user');
    if (role === 'campus_missionary') return 'campus';
    if (role === 'intercessor') return 'intercession';
    const scope = getRoleScope(role);
    if (scope === 'global') return 'global';
    if (scope === 'country') return 'national';
    if (scope === 'region') return 'regional';
    if (scope === 'church') return 'church';
    return 'assistant';
}

function getFinanceAssignmentSummary(user) {
    const assignments = Array.isArray(user?.finance_assignments) ? user.finance_assignments : [];
    if (!assignments.length) return '';
    const order = ['global', 'country', 'region', 'church'];
    const labels = {
        global: 'Global',
        country: 'Nacional',
        region: 'Regional',
        church: 'Local',
    };
    const levels = Array.from(new Set(assignments.map((assignment) => assignment?.scope_type).filter(Boolean)))
        .sort((left, right) => order.indexOf(left) - order.indexOf(right))
        .map((scopeType) => labels[scopeType] || scopeType);
    return levels.length ? `Finanzas: ${levels.join(' + ')}` : '';
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
    const financeScopeLabel = getFinanceAssignmentSummary(user);
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
        financeScopeLabel,
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
    setupRoleScopeModal();
    setupFinanceAssignmentModal();

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

    pageSizeEl?.addEventListener('change', () => {
        usersPage = 1;
        applyFilters({ resetPage: false });
    });
    pagePrevBtn?.addEventListener('click', () => {
        if (usersPage <= 1) return;
        usersPage -= 1;
        applyFilters({ resetPage: false });
    });
    pageNextBtn?.addEventListener('click', () => {
        usersPage += 1;
        applyFilters({ resetPage: false });
    });
}

async function loadChurches() {
    if (!scopeChurchSelect) return;
    try {
        const res = await fetch('/api/portal/churches');
        if (!res.ok) return;
        const data = await res.json();
        churchesCatalog = Array.isArray(data) ? data : [];
        populateScopeOptions();
        populateLocationFilters();
        applyFilters({ resetPage: false });
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
            populateLocationFilters();
            return;
        }
        const payload = await res.json();
        regionsCatalog = Array.isArray(payload?.regions) ? payload.regions : [];
        populateRegionOptions();
        populateLocationFilters();
        applyFilters({ resetPage: false });
    } catch (err) {
        console.error(err);
        regionsCatalog = [];
        populateRegionOptions();
        populateLocationFilters();
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

function populateCountrySelect(select, selectedValue = '') {
    if (!select) return;
    const countries = listPortalCountries(churchesCatalog, regionsCatalog);
    const selectedKey = normalizePortalCountryKey(selectedValue || select.value);
    select.innerHTML = '<option value="">Selecciona un país</option>'
        + countries.map((country) => `<option value="${escapeAttr(country)}">${escapeHtml(country)}</option>`).join('');
    const matchedCountry = countries.find((country) => normalizePortalCountryKey(country) === selectedKey);
    select.value = matchedCountry || '';
}

function getCreatorAllowedRegionIds() {
    if (currentUserRole !== 'regional_pastor' && currentUserRole !== 'regional_collaborator') return [];
    return currentAllowedRegionIds.length
        ? currentAllowedRegionIds
        : (currentUserRegionId ? [currentUserRegionId] : []);
}

function populateScopeOptions() {
    if (!scopeChurchSelect) return;
    const selectedCountry = scopeCountryInput?.value || currentUserCountry || '';
    const selectedRegionId = scopeRegionSelect?.value || '';
    const allowedRegionIds = getCreatorAllowedRegionIds();
    const scoped = filterPortalChurches(churchesCatalog, {
        country: selectedCountry,
        regionId: selectedRegionId,
        allowedRegionIds,
    });
    scopeChurchSelect.innerHTML = '<option value="">Selecciona una iglesia</option>' +
        scoped
            .map(c => {
                const safeId = escapeAttr(c.id || '');
                const cityLabel = c.city || c.country || 'Ciudad';
                const safeCity = escapeHtml(cityLabel);
                const safeName = escapeHtml(c.name || '');
                const countryLabel = c.country ? ` · ${escapeHtml(getCanonicalCountryLabel(c.country))}` : '';
                return `<option value="${safeId}">${safeCity} · ${safeName}${countryLabel}</option>`;
            })
            .join('');

    populateCountrySelect(scopeCountryInput, selectedCountry);
    populateCountrySelect(financeOnboardingCountry, financeOnboardingCountry?.value || currentUserCountry);
    populateCountrySelect(financeAssignmentCountry, financeAssignmentCountry?.value || currentUserCountry);

    if (financeOnboardingChurch) {
        const financeChurches = filterPortalChurches(churchesCatalog, {
            country: financeOnboardingCountry?.value || '',
            regionId: financeOnboardingRegion?.value || '',
        });
        financeOnboardingChurch.innerHTML = '<option value="">Selecciona una iglesia</option>'
            + financeChurches.map((church) => {
                const label = [church.name, church.city, getCanonicalCountryLabel(church.country)].filter(Boolean).join(' · ');
                return `<option value="${escapeAttr(church.id || '')}">${escapeHtml(label || 'Iglesia')}</option>`;
            }).join('');
    }
}

function populateRegionOptions() {
    if (!scopeRegionSelect) return;
    const scopedRegions = filterPortalRegions(regionsCatalog, {
        country: scopeCountryInput?.value || currentUserCountry || '',
        allowedRegionIds: getCreatorAllowedRegionIds(),
    });

    scopeRegionSelect.innerHTML = '<option value="">Selecciona una región</option>' +
        scopedRegions
            .map((region) => {
                const countryLabel = getCanonicalCountryLabel(region.country);
                const label = `${region.code || 'REG'} · ${region.name || 'Región'}${countryLabel ? ` (${countryLabel})` : ''}`;
                return `<option value="${escapeAttr(region.id || '')}">${escapeHtml(label)}</option>`;
            })
            .join('');
    if (financeOnboardingRegion) {
        const financeRegions = filterPortalRegions(regionsCatalog, {
            country: financeOnboardingCountry?.value || '',
        });
        financeOnboardingRegion.innerHTML = '<option value="">Selecciona una región</option>'
            + financeRegions.map((region) => {
                const label = [region.code, region.name, getCanonicalCountryLabel(region.country)].filter(Boolean).join(' · ');
                return `<option value="${escapeAttr(region.id || '')}">${escapeHtml(label || 'Región')}</option>`;
            }).join('');
    }
}

function updateFinanceOnboardingFields() {
    const isFinance = roleSelect?.value === 'finance';
    const scopeType = financeOnboardingScope?.value || 'country';
    const needsCountry = isFinance && scopeType !== 'global';
    const needsRegion = isFinance && scopeType === 'region';
    const usesRegionFilter = isFinance && scopeType === 'church';
    const needsChurch = isFinance && scopeType === 'church';

    financeOnboardingWrapper?.classList.toggle('hidden', !isFinance);
    if (financeOnboardingScope) financeOnboardingScope.disabled = !isFinance;

    financeOnboardingCountryWrapper?.classList.toggle('hidden', !needsCountry);
    if (financeOnboardingCountry) {
        financeOnboardingCountry.disabled = !needsCountry;
        financeOnboardingCountry.required = needsCountry;
        if (!needsCountry) financeOnboardingCountry.value = '';
    }

    financeOnboardingRegionWrapper?.classList.toggle('hidden', !(needsRegion || usesRegionFilter));
    if (financeOnboardingRegion) {
        financeOnboardingRegion.disabled = !(needsRegion || usesRegionFilter);
        financeOnboardingRegion.required = needsRegion;
        financeOnboardingRegion.name = needsRegion ? 'financeScopeId' : '';
        if (!(needsRegion || usesRegionFilter)) financeOnboardingRegion.value = '';
    }

    financeOnboardingChurchWrapper?.classList.toggle('hidden', !needsChurch);
    if (financeOnboardingChurch) {
        financeOnboardingChurch.disabled = !needsChurch;
        financeOnboardingChurch.required = needsChurch;
        if (!needsChurch) financeOnboardingChurch.value = '';
    }
}

function updateScopeFields(role) {
    const needsCountry = role === 'national_pastor' || role === 'national_collaborator';
    const needsRegion = role === 'regional_pastor' || role === 'regional_collaborator';
    const needsChurch = role === 'pastor' || role === 'local_collaborator' || role === 'leader';
    const usesTerritory = needsCountry || needsRegion || needsChurch;
    const needsCampusMissionary = role === 'campus_missionary';
    const isNationalCreator = currentUserRole === 'national_pastor' || currentUserRole === 'national_collaborator';
    const isRegionalCreator = currentUserRole === 'regional_pastor' || currentUserRole === 'regional_collaborator';
    const isLocalCreator = currentUserRole === 'pastor' || currentUserRole === 'local_collaborator' || currentUserRole === 'leader';
    const allowedRegionIds = currentAllowedRegionIds.length
        ? currentAllowedRegionIds
        : (currentUserRegionId ? [currentUserRegionId] : []);

    if (scopeCountryWrapper && scopeCountryInput) {
        scopeCountryWrapper.classList.toggle('hidden', !usesTerritory);
        scopeCountryInput.required = usesTerritory;
        scopeCountryInput.disabled = !usesTerritory || (usesTerritory && (isNationalCreator || isRegionalCreator || isLocalCreator));
        if (!usesTerritory) {
            scopeCountryInput.value = '';
        } else if ((isNationalCreator || isRegionalCreator || isLocalCreator) && currentUserCountry) {
            scopeCountryInput.value = currentUserCountry;
        }
        if (scopeCountryLabel) scopeCountryLabel.textContent = needsCountry ? 'País del rol nacional' : 'País';
    }

    if (scopeRegionWrapper && scopeRegionSelect) {
        const showRegion = needsRegion || needsChurch;
        scopeRegionWrapper.classList.toggle('hidden', !showRegion);
        scopeRegionSelect.required = needsRegion;
        if (!showRegion) {
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
        if (scopeRegionLabel) scopeRegionLabel.textContent = needsRegion ? 'Región del rol regional' : 'Región (filtro opcional)';
    }

    if (scopeChurchWrapper && scopeChurchSelect) {
        scopeChurchWrapper.classList.toggle('hidden', !needsChurch);
        scopeChurchSelect.required = needsChurch;
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

    updateFinanceOnboardingFields();
}

function attachScopeListener() {
    if (scopeListenerAttached || !roleSelect) return;
    roleSelect.addEventListener('change', () => updateScopeFields(roleSelect.value));
    financeOnboardingScope?.addEventListener('change', updateFinanceOnboardingFields);
    scopeCountryInput?.addEventListener('change', () => {
        populateRegionOptions();
        populateScopeOptions();
    });
    scopeRegionSelect?.addEventListener('change', populateScopeOptions);
    financeOnboardingCountry?.addEventListener('change', () => {
        populateRegionOptions();
        populateScopeOptions();
    });
    financeOnboardingRegion?.addEventListener('change', populateScopeOptions);
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

    const countries = listPortalCountries(churchesCatalog, regionsCatalog);

    if (countryFilter) {
        countryFilter.innerHTML = '<option value="">Todos los países</option>'
            + countries.map((country) => `<option value="${escapeAttr(country)}">${escapeHtml(country)}</option>`).join('');
        countryFilter.value = findPortalCountry(selectedCountry, churchesCatalog, regionsCatalog) || '';
    }

    const countryScope = countryFilter?.value || '';
    const cities = listPortalCities(churchesCatalog, { country: countryScope });

    if (cityFilter) {
        cityFilter.innerHTML = '<option value="">Todas las ciudades</option>'
            + cities.map((city) => `<option value="${escapeAttr(city)}">${escapeHtml(city)}</option>`).join('');
        const selectedCityKey = normalizeTerritoryKey(selectedCity);
        cityFilter.value = cities.find((city) => normalizeTerritoryKey(city) === selectedCityKey) || '';
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
                class="min-h-16 rounded-md border px-4 py-2 text-left transition-colors ${style}"
            >
                <p class="text-[10px] uppercase tracking-widest font-bold">${escapeHtml(title)}</p>
                <p class="text-lg font-black leading-tight">${escapeHtml(count)}</p>
            </button>
        `;
    }).join('');
}

function applyFilters(options = {}) {
    const query = normalizeSearchText(searchInput?.value || '');
    const roleValue = roleFilter?.value || '';
    const statusValue = statusFilter?.value || '';
    const countryValue = countryFilter?.value || '';
    const cityValue = cityFilter?.value || '';
    const scopeValue = scopeFilter?.value || '';
    const queryTokens = query ? query.split(/\s+/).filter(Boolean) : [];

    if (options.resetPage !== false) usersPage = 1;
    renderSummaryCards();

    const filtered = (allUsers || []).filter((user) => {
        const searchable = getSearchableUserText(user);
        if (queryTokens.length && queryTokens.some((token) => !searchable.includes(token))) return false;
        const hasFinanceAccess = String(user?.role || '') === 'finance'
            || Number(user?.finance_assignment_count || 0) > 0;
        if (roleValue === 'finance' && !hasFinanceAccess) return false;
        if (roleValue && roleValue !== 'finance' && user.role !== roleValue) return false;
        if (statusValue && user.access_status !== statusValue) return false;
        if (countryValue && normalizePortalCountryKey(getUserCountry(user)) !== normalizePortalCountryKey(countryValue)) return false;
        if (cityValue && normalizeTerritoryKey(getUserCity(user)) !== normalizeTerritoryKey(cityValue)) return false;
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
    const countryName = getCanonicalCountryLabel(church?.country || user?.country || '');
    const regionName = region?.name || '';
    const regionCode = region?.code || '';

    if (getRoleScope(role) === 'global') {
        return 'Global';
    }

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
    const selectedRole = user.role || 'user';
    const label = escapeHtml(roleTranslations[selectedRole] || selectedRole || 'Usuario');
    const badgeClass = roleBadgeClass(selectedRole);
    const financeCount = Number(user?.finance_assignment_count || 0);
    return `
        <div class="min-w-0 space-y-2">
            <span class="portal-chip uppercase ${badgeClass}">${label}</span>
            ${financeCount ? `<p class="flex items-center gap-2 text-xs font-bold text-[#1E6B78]"><span class="h-2 w-2 rounded-full bg-[#28A6BD]"></span>Finanzas · ${financeCount}</p>` : ''}
        </div>
    `;
}

function renderActionsCell(user, canSendAccessLink, canCopyAccessLink, safeEmailAttr, resetLabel) {
    const isDeleted = user?.access_status === 'deleted' || user?.is_account_deleted === true;
    const isBlocked = user?.access_status === 'blocked' || user?.is_blocked === true;
    const isActorSuperadmin = currentUserRole === 'superadmin';
    const isTargetSuperadmin = String(user?.role || '') === 'superadmin';
    const isTargetGlobalAdmin = ['admin', 'superadmin'].includes(String(user?.role || ''));
    const isSelf = Boolean(currentUserId && user?.user_id === currentUserId);
    const resetButton = canSendAccessLink
        ? (isDeleted
            ? '<span class="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Cuenta eliminada</span>'
            : `<button type="button" data-action="reset" data-email="${safeEmailAttr}" class="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-left text-xs font-bold text-[#293C74] hover:bg-slate-50">${escapeHtml(resetLabel)}</button>`)
        : '';
    const accessLinkButton = canCopyAccessLink && !isDeleted
        ? `<button type="button" data-action="copy-access-link" data-email="${safeEmailAttr}" title="Generar y copiar enlace temporal de acceso" class="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-left text-xs font-bold text-[#293C74] hover:bg-slate-50">Copiar enlace de acceso</button>`
        : '';
    const financeCount = Number(user?.finance_assignment_count || 0);
    const financeButton = isActorSuperadmin && !isDeleted && !isTargetGlobalAdmin
        ? `<button type="button" data-action="manage-finance" data-user-id="${escapeAttr(user.user_id || '')}" class="min-h-11 w-full rounded-lg border border-[#28A6BD]/30 bg-[#EAF9FC] px-4 py-2 text-left text-xs font-bold text-[#1E5F6C] hover:bg-[#D9F4F8]">${financeCount ? `Administrar acceso financiero (${financeCount})` : 'Dar acceso financiero'}</button>`
        : '';
    const roleScopeButton = isActorSuperadmin && !isDeleted
        ? `<button type="button" data-action="edit-role-scope" data-user-id="${escapeAttr(user.user_id || '')}" class="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-left text-xs font-bold text-[#293C74] hover:bg-slate-50">Editar rol y alcance</button>`
        : '';
    let lifecycleButtons = '';
    if (isActorSuperadmin && !isSelf && !isTargetSuperadmin) {
        if (isDeleted) {
            lifecycleButtons = `<button type="button" data-action="restore-user" data-user-id="${escapeAttr(user.user_id || '')}" class="min-h-11 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-left text-xs font-bold text-emerald-800 hover:bg-emerald-100">Restaurar cuenta</button>`;
        } else {
            const blockLabel = isBlocked ? 'Desbloquear' : 'Bloquear';
            const blockAction = isBlocked ? 'unblock-user' : 'block-user';
            lifecycleButtons = `
                <button type="button" data-action="${blockAction}" data-user-id="${escapeAttr(user.user_id || '')}" class="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">${blockLabel} cuenta</button>
                <button type="button" data-action="delete-user" data-user-id="${escapeAttr(user.user_id || '')}" class="min-h-11 w-full rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-100">Eliminar cuenta</button>
            `;
        }
    }

    const combined = [roleScopeButton, financeButton, lifecycleButtons, accessLinkButton, resetButton].filter(Boolean).join('');
    if (!combined) {
        return '<span class="text-[10px] text-slate-400 uppercase tracking-widest">-</span>';
    }
    return `
        <details class="user-actions-menu relative w-full text-left lg:inline-block lg:w-auto">
            <summary class="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-[#293C74] hover:border-[#293C74]/30 hover:bg-slate-50 lg:justify-center">
                Gestionar <span aria-hidden="true">⌄</span>
            </summary>
            <div class="relative z-30 mt-2 w-full space-y-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl lg:absolute lg:right-0 lg:w-64">
                ${combined}
            </div>
        </details>
    `;
}

function renderTable(users) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (countEl) {
        const total = allUsers.length;
        const count = users.length;
        const hasFilters = Boolean(
            searchInput?.value
            || roleFilter?.value
            || statusFilter?.value
            || countryFilter?.value
            || cityFilter?.value
            || scopeFilter?.value
        );
        countEl.textContent = hasFilters ? `${count} de ${total} usuarios` : `${total} usuarios`;
    }
    if (users.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (tableEl) tableEl.classList.add('hidden');
        if (paginationEl) {
            paginationEl.classList.add('hidden');
            paginationEl.classList.remove('flex');
        }
        return;
    }

    if (tableEl) tableEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    const pageSize = Math.max(1, Number(pageSizeEl?.value || 10));
    const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
    usersPage = Math.min(Math.max(1, usersPage), totalPages);
    const pageStart = (usersPage - 1) * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, users.length);
    const visibleUsers = users.slice(pageStart, pageEnd);

    if (paginationEl) {
        paginationEl.classList.remove('hidden');
        paginationEl.classList.add('flex');
    }
    if (pageInfoEl) pageInfoEl.textContent = `Mostrando ${pageStart + 1}-${pageEnd} de ${users.length}`;
    if (pagePrevBtn) pagePrevBtn.disabled = usersPage <= 1;
    if (pageNextBtn) pageNextBtn.disabled = usersPage >= totalPages;

    if (tbody) {
        tbody.innerHTML = visibleUsers.map(u => {
            const fullName = u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Sin nombre';
            const safeFullName = escapeHtml(fullName);
            const safeEmail = escapeHtml(u.email || '');
            const safeEmailAttr = escapeAttr(u.email || '');
            const accessStatus = u.access_status || 'unknown';
            const safeStatusLabel = escapeHtml(accessStatusTranslations[accessStatus] || accessStatus);
            const accessStatusClass = statusBadgeClass(accessStatus);
            const lastSignInLabel = formatDateTime(u.last_sign_in_at);
            const safeLastSignIn = escapeHtml(lastSignInLabel);
            const primaryScopeLabel = getScopeLabel(u);
            const financeScopeLabel = getFinanceAssignmentSummary(u);
            const scopeLabel = financeScopeLabel
                ? (u.role === 'finance' ? financeScopeLabel : `${primaryScopeLabel} · ${financeScopeLabel}`)
                : primaryScopeLabel;
            const safeScope = escapeHtml(scopeLabel);
            const resetLabel = accessStatus === 'invited' || accessStatus === 'pending' ? 'Reenviar acceso' : 'Reset contraseña';
            const canSendAccessLink = ['superadmin', 'admin', 'national_pastor', 'regional_pastor', 'pastor', 'local_collaborator'].includes(currentUserRole);
            const protectedAccessLinkRoles = ['superadmin', 'admin', 'finance'];
            const canCopyAccessLink = ['superadmin', 'admin'].includes(currentUserRole)
                && (currentUserRole === 'superadmin' || !protectedAccessLinkRoles.includes(u.role));
            return `
                <tr class="group hover:bg-slate-50 transition-colors">
                    <td data-label="Nombre" class="py-4 pl-2 font-medium text-[#293C74]">${safeFullName}</td>
                    <td data-label="Email" class="py-4 text-slate-500">${safeEmail}</td>
                    <td data-label="Rol" class="py-4">
                        ${renderRoleCell(u)}
                    </td>
                    <td data-label="Alcance" class="py-4 text-slate-500 text-xs font-semibold">${safeScope}</td>
                    <td data-label="Estado acceso" class="py-4">
                        <span class="portal-chip uppercase ${accessStatusClass}">
                            ${safeStatusLabel}
                        </span>
                    </td>
                    <td data-label="Último ingreso" class="py-4 text-slate-500 text-xs">${safeLastSignIn}</td>
                    <td data-label="Acciones" class="py-4 text-right pr-2">
                        ${renderActionsCell(u, canSendAccessLink, canCopyAccessLink, safeEmailAttr, resetLabel)}
                    </td>
                </tr>
            `;
        }).join('');
    }
}

tbody?.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !currentToken) return;
    const action = target.dataset.action;

    if (action === 'edit-role-scope') {
        const userId = target.dataset.userId;
        if (!userId) return;
        await openRoleScopeModal(userId);
        return;
    }

    if (action === 'manage-finance') {
        const userId = target.dataset.userId;
        if (!userId) return;
        await openFinanceAssignmentModal(userId);
        return;
    }

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

function setRoleScopeFeedback(message = '', type = 'info') {
    if (!roleScopeFeedback) return;
    if (!message) {
        roleScopeFeedback.textContent = '';
        roleScopeFeedback.className = 'hidden rounded-xl px-4 py-4 text-sm';
        return;
    }
    const styles = type === 'error'
        ? 'border border-red-200 bg-red-50 text-red-800'
        : type === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border border-sky-200 bg-sky-50 text-sky-800';
    roleScopeFeedback.className = `rounded-xl px-4 py-4 text-sm ${styles}`;
    roleScopeFeedback.textContent = message;
}

function populateRoleScopeOptions(selectedRegionId = '', selectedChurchId = '') {
    const country = roleScopeCountry?.value || '';
    const regionValue = selectedRegionId || roleScopeRegion?.value || '';
    const churchValue = selectedChurchId || roleScopeChurch?.value || '';
    populateCountrySelect(roleScopeCountry, country);

    if (roleScopeRegion) {
        roleScopeRegion.innerHTML = '<option value="">Selecciona una región</option>'
            + filterPortalRegions(regionsCatalog, { country })
                .filter((region) => region?.id)
                .map((region) => {
                    const label = [region.code, region.name, getCanonicalCountryLabel(region.country)].filter(Boolean).join(' · ');
                    return `<option value="${escapeAttr(region.id)}">${escapeHtml(label || 'Región')}</option>`;
                }).join('');
        if ([...roleScopeRegion.options].some((option) => option.value === regionValue)) {
            roleScopeRegion.value = regionValue;
        }
    }

    if (roleScopeChurch) {
        roleScopeChurch.innerHTML = '<option value="">Selecciona una iglesia</option>'
            + filterPortalChurches(churchesCatalog, {
                country,
                regionId: roleScopeRegion?.value || '',
            })
                .filter((church) => church?.id)
                .map((church) => {
                    const label = [church.name, church.city, getCanonicalCountryLabel(church.country)].filter(Boolean).join(' · ');
                    return `<option value="${escapeAttr(church.id)}">${escapeHtml(label || 'Iglesia')}</option>`;
                }).join('');
        if ([...roleScopeChurch.options].some((option) => option.value === churchValue)) {
            roleScopeChurch.value = churchValue;
        }
    }
}

function updateRoleScopeFields() {
    const definition = getPortalRoleDefinition(roleScopeRole?.value || 'user');
    const scope = definition?.scope || 'self';
    const usesTerritory = ['country', 'region', 'church'].includes(scope);
    const usesRegion = scope === 'region' || scope === 'church';
    const usesChurch = scope === 'church';
    const usesCampus = definition?.role === 'campus_missionary';

    roleScopeCountryWrapper?.classList.toggle('hidden', !usesTerritory);
    roleScopeRegionWrapper?.classList.toggle('hidden', !usesRegion);
    roleScopeChurchWrapper?.classList.toggle('hidden', !usesChurch);
    roleScopeCampusWrapper?.classList.toggle('hidden', !usesCampus);

    if (roleScopeCountry) {
        roleScopeCountry.disabled = !usesTerritory;
        roleScopeCountry.required = usesTerritory;
    }
    if (roleScopeRegion) {
        roleScopeRegion.disabled = !usesRegion;
        roleScopeRegion.required = scope === 'region';
    }
    if (roleScopeChurch) {
        roleScopeChurch.disabled = !usesChurch;
        roleScopeChurch.required = usesChurch;
    }
    if (roleScopeCampus) {
        roleScopeCampus.disabled = !usesCampus;
        roleScopeCampus.required = usesCampus;
    }
}

async function openRoleScopeModal(userId) {
    if (currentUserRole !== 'superadmin' || !currentToken || !roleScopeModal) return;
    const user = allUsers.find((item) => item.user_id === userId);
    if (!user) return;
    roleScopeUserId = userId;
    const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Usuario';
    if (roleScopeUser) roleScopeUser.textContent = `${name} · ${user.email || ''}`;
    setRoleScopeFeedback();
    if (roleScopeSave) roleScopeSave.disabled = true;
    showAccessibleDialog(roleScopeModal, roleScopeRole);

    try {
        await ensureScopeCatalogs(currentToken);
        const roleExists = roleScopeRole
            ? [...roleScopeRole.options].some((option) => option.value === user.role)
            : false;
        if (roleScopeRole) roleScopeRole.value = roleExists ? user.role : 'user';
        populateCountrySelect(roleScopeCountry, user.country || '');
        populateRoleScopeOptions(
            user.region_id || '',
            user.church_id || user.portal_church_id || '',
        );
        if (roleScopeCampus) roleScopeCampus.value = user.campus_missionary_slug || '';
        updateRoleScopeFields();
        if (roleScopeSave) roleScopeSave.disabled = false;
    } catch (error) {
        console.error(error);
        setRoleScopeFeedback('No se pudieron cargar los países, regiones e iglesias.', 'error');
    }
}

function closeRoleScopeModal() {
    roleScopeUserId = '';
    roleScopeForm?.reset();
    setRoleScopeFeedback();
    hideAccessibleDialog(roleScopeModal, btnOpen);
}

function setupRoleScopeModal() {
    roleScopeClose?.addEventListener('click', closeRoleScopeModal);
    roleScopeCancel?.addEventListener('click', closeRoleScopeModal);
    roleScopeModal?.addEventListener('click', (event) => {
        if (event.target === roleScopeModal) roleScopeClose?.focus();
    });
    roleScopeRole?.addEventListener('change', updateRoleScopeFields);
    roleScopeCountry?.addEventListener('change', () => populateRoleScopeOptions('', ''));
    roleScopeRegion?.addEventListener('change', () => populateRoleScopeOptions(roleScopeRegion.value, ''));
    document.addEventListener('keydown', (event) => {
        handleAccessibleDialogKeydown(event, roleScopeModal, roleScopeClose);
    });

    roleScopeForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!roleScopeUserId || !currentToken || !roleScopeRole) return;
        const targetUser = allUsers.find((item) => item.user_id === roleScopeUserId);
        if (!targetUser) return;
        const definition = getPortalRoleDefinition(roleScopeRole.value);
        if (!definition) return;
        const confirmed = window.confirm(
            `¿Guardar el rol principal de ${targetUser.email || 'esta cuenta'} como ${definition.label}?`,
        );
        if (!confirmed) return;

        const payload = {
            userId: roleScopeUserId,
            role: definition.role,
            country: roleScopeCountry?.value || null,
            regionId: roleScopeRegion?.value || null,
            churchId: roleScopeChurch?.value || null,
            campusMissionarySlug: roleScopeCampus?.value || null,
        };
        const originalText = roleScopeSave?.textContent || 'Guardar rol y alcance';
        if (roleScopeSave) {
            roleScopeSave.textContent = 'Guardando…';
            roleScopeSave.disabled = true;
        }
        setRoleScopeFeedback();
        try {
            const { res, data } = await fetchJsonWithTimeout('/api/portal/admin/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
                credentials: 'include',
                body: JSON.stringify(payload),
            }, 20000);
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar el rol.');
            setRoleScopeFeedback('Rol y alcance actualizados correctamente.', 'success');
            await loadUsers(currentToken);
            window.setTimeout(closeRoleScopeModal, 600);
        } catch (error) {
            console.error(error);
            setRoleScopeFeedback(error?.message || 'No se pudo actualizar el rol.', 'error');
        } finally {
            if (roleScopeSave) {
                roleScopeSave.textContent = originalText;
                roleScopeSave.disabled = false;
            }
        }
    });
}

function setFinanceAssignmentFeedback(message = '', type = 'info') {
    if (!financeAssignmentFeedback) return;
    if (!message) {
        financeAssignmentFeedback.textContent = '';
        financeAssignmentFeedback.className = 'hidden rounded-xl px-4 py-4 text-sm';
        return;
    }
    const styles = type === 'error'
        ? 'border border-red-200 bg-red-50 text-red-800'
        : type === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border border-sky-200 bg-sky-50 text-sky-800';
    financeAssignmentFeedback.className = `rounded-xl px-4 py-4 text-sm ${styles}`;
    financeAssignmentFeedback.textContent = message;
}

function setFinanceAssignmentFormDisabled(disabled) {
    const controls = [
        financeAssignmentScope,
        financeAssignmentCountry,
        financeAssignmentRegion,
        financeAssignmentChurch,
        financeAssignmentSave,
    ];
    controls.forEach((control) => {
        if (control) control.disabled = disabled;
    });
    if (!disabled) updateFinanceAssignmentFields();
}

function populateFinanceAssignmentOptions() {
    populateCountrySelect(financeAssignmentCountry, financeAssignmentCountry?.value || '');
    const country = financeAssignmentCountry?.value || '';
    const selectedRegion = financeAssignmentRegion?.value || '';
    if (financeAssignmentRegion) {
        financeAssignmentRegion.innerHTML = '<option value="">Selecciona una región</option>'
            + filterPortalRegions(regionsCatalog, { country })
                .filter((region) => region?.id)
                .map((region) => {
                const label = [region.code, region.name, getCanonicalCountryLabel(region.country)].filter(Boolean).join(' · ');
                    return `<option value="${escapeAttr(region.id)}">${escapeHtml(label || 'Región')}</option>`;
                })
                .join('');
        if ([...financeAssignmentRegion.options].some((option) => option.value === selectedRegion)) {
            financeAssignmentRegion.value = selectedRegion;
        }
    }
    if (financeAssignmentChurch) {
        financeAssignmentChurch.innerHTML = '<option value="">Selecciona una iglesia</option>'
            + filterPortalChurches(churchesCatalog, {
                country,
                regionId: financeAssignmentRegion?.value || '',
            })
                .filter((church) => church?.id)
                .map((church) => {
                const label = [church.name, church.city, getCanonicalCountryLabel(church.country)].filter(Boolean).join(' · ');
                    return `<option value="${escapeAttr(church.id)}">${escapeHtml(label || 'Iglesia')}</option>`;
                })
                .join('');
    }
}

function updateFinanceAssignmentFields() {
    const scopeType = financeAssignmentScope?.value || 'church';
    const needsCountry = scopeType !== 'global';
    const needsRegion = scopeType === 'region';
    const usesRegionFilter = scopeType === 'church';
    const needsChurch = scopeType === 'church';

    financeAssignmentCountryWrapper?.classList.toggle('hidden', !needsCountry);
    financeAssignmentRegionWrapper?.classList.toggle('hidden', !(needsRegion || usesRegionFilter));
    financeAssignmentChurchWrapper?.classList.toggle('hidden', !needsChurch);

    if (financeAssignmentCountry) financeAssignmentCountry.disabled = financeHierarchyMigrationRequired || !needsCountry;
    if (financeAssignmentRegion) financeAssignmentRegion.disabled = financeHierarchyMigrationRequired || !(needsRegion || usesRegionFilter);
    if (financeAssignmentChurch) financeAssignmentChurch.disabled = financeHierarchyMigrationRequired || !needsChurch;
    if (financeAssignmentScope) financeAssignmentScope.disabled = financeHierarchyMigrationRequired;
    if (financeAssignmentSave) financeAssignmentSave.disabled = financeHierarchyMigrationRequired;
}

function renderFinanceAssignments() {
    if (financeAssignmentCount) {
        const count = activeFinanceAssignments.length;
        financeAssignmentCount.textContent = `${count} ${count === 1 ? 'asignación' : 'asignaciones'}`;
    }
    if (!financeAssignmentList) return;
    if (financeHierarchyMigrationRequired) {
        financeAssignmentList.innerHTML = '<p class="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-4 py-4 text-center text-sm text-amber-800">La pantalla quedará habilitada cuando ejecutes la migración financiera.</p>';
        return;
    }
    if (!activeFinanceAssignments.length) {
        financeAssignmentList.innerHTML = '<p class="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-sm text-slate-500">Este usuario todavía no tiene acceso a Finanzas.</p>';
        return;
    }
    financeAssignmentList.innerHTML = activeFinanceAssignments.map((assignment) => `
        <div class="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <p class="text-sm font-bold text-[#293C74]">${escapeHtml(assignment.scope_label || 'Alcance financiero')}</p>
                <p class="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Permiso financiero secundario</p>
            </div>
            <button type="button" data-finance-action="remove" data-assignment-id="${escapeAttr(assignment.id || '')}" class="min-h-11 rounded-md border border-rose-200 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Retirar</button>
        </div>
    `).join('');
}

function syncFinanceAssignmentsToUser(assignments) {
    const user = allUsers.find((item) => item.user_id === financeAssignmentUserId);
    if (!user) return;
    user.finance_assignments = (assignments || []).map((assignment) => ({
        id: assignment.id,
        scope_type: assignment.scope_type,
        scope_id: assignment.scope_id,
        scope_key: assignment.scope_key,
    }));
    user.finance_assignment_count = user.finance_assignments.length;
    applyFilters({ resetPage: false });
}

async function openFinanceAssignmentModal(userId) {
    if (currentUserRole !== 'superadmin' || !currentToken || !financeAssignmentModal) return;
    const user = allUsers.find((item) => item.user_id === userId);
    if (!user) return;

    financeAssignmentUserId = userId;
    activeFinanceAssignments = [];
    financeHierarchyMigrationRequired = false;
    const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Usuario';
    if (financeAssignmentUser) financeAssignmentUser.textContent = `${name} · ${user.email || ''}`;
    financeAssignmentMigration?.classList.add('hidden');
    if (financeAssignmentList) {
        financeAssignmentList.innerHTML = '<p class="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-sm text-slate-400">Cargando asignaciones…</p>';
    }
    setFinanceAssignmentFeedback();
    showAccessibleDialog(financeAssignmentModal, financeAssignmentClose);
    setFinanceAssignmentFormDisabled(true);

    try {
        await ensureScopeCatalogs(currentToken);
        populateFinanceAssignmentOptions();
        const { res, data } = await fetchJsonWithTimeout(
            `/api/portal/admin/finance-assignments?user_id=${encodeURIComponent(userId)}`,
            { headers: { Authorization: `Bearer ${currentToken}` }, credentials: 'include' },
            20000,
        );
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los alcances financieros.');
        financeHierarchyMigrationRequired = Boolean(data.migration_required);
        activeFinanceAssignments = Array.isArray(data.assignments) ? data.assignments : [];
        syncFinanceAssignmentsToUser(activeFinanceAssignments);
        financeAssignmentMigration?.classList.toggle('hidden', !financeHierarchyMigrationRequired);
        renderFinanceAssignments();
        setFinanceAssignmentFormDisabled(financeHierarchyMigrationRequired);
        updateFinanceAssignmentFields();
    } catch (error) {
        console.error(error);
        activeFinanceAssignments = [];
        renderFinanceAssignments();
        setFinanceAssignmentFeedback(error?.message || 'No se pudieron cargar los alcances financieros.', 'error');
        setFinanceAssignmentFormDisabled(true);
    }
}

function closeFinanceAssignmentModal() {
    financeAssignmentUserId = '';
    activeFinanceAssignments = [];
    financeHierarchyMigrationRequired = false;
    financeAssignmentForm?.reset();
    setFinanceAssignmentFeedback();
    updateFinanceAssignmentFields();
    hideAccessibleDialog(financeAssignmentModal, btnOpen);
}

function setupFinanceAssignmentModal() {
    financeAssignmentClose?.addEventListener('click', closeFinanceAssignmentModal);
    financeAssignmentCancel?.addEventListener('click', closeFinanceAssignmentModal);
    financeAssignmentModal?.addEventListener('click', (event) => {
        if (event.target === financeAssignmentModal) financeAssignmentClose?.focus();
    });
    financeAssignmentScope?.addEventListener('change', () => {
        updateFinanceAssignmentFields();
        populateFinanceAssignmentOptions();
    });
    financeAssignmentCountry?.addEventListener('change', populateFinanceAssignmentOptions);
    financeAssignmentRegion?.addEventListener('change', populateFinanceAssignmentOptions);
    document.addEventListener('keydown', (event) => {
        handleAccessibleDialogKeydown(event, financeAssignmentModal, financeAssignmentClose);
    });

    financeAssignmentForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!financeAssignmentUserId || financeHierarchyMigrationRequired || !currentToken) return;
        const scopeType = financeAssignmentScope?.value || 'church';
        const payload = {
            userId: financeAssignmentUserId,
            scopeType,
            scopeKey: scopeType === 'country' ? financeAssignmentCountry?.value || '' : null,
            scopeId: scopeType === 'region'
                ? financeAssignmentRegion?.value || ''
                : scopeType === 'church'
                    ? financeAssignmentChurch?.value || ''
                    : null,
        };
        const originalText = financeAssignmentSave?.textContent || 'Agregar alcance';
        if (financeAssignmentSave) {
            financeAssignmentSave.textContent = 'Guardando…';
            financeAssignmentSave.disabled = true;
        }
        setFinanceAssignmentFeedback();
        try {
            const { res, data } = await fetchJsonWithTimeout('/api/portal/admin/finance-assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
                credentials: 'include',
                body: JSON.stringify(payload),
            }, 20000);
            if (!res.ok || !data.ok) {
                if (data.migration_required) {
                    financeHierarchyMigrationRequired = true;
                    financeAssignmentMigration?.classList.remove('hidden');
                    setFinanceAssignmentFormDisabled(true);
                }
                throw new Error(data.error || 'No se pudo guardar el alcance financiero.');
            }
            activeFinanceAssignments = Array.isArray(data.assignments) ? data.assignments : [];
            syncFinanceAssignmentsToUser(activeFinanceAssignments);
            renderFinanceAssignments();
            setFinanceAssignmentFeedback('Acceso financiero asignado correctamente. La cuenta conserva su rol principal.', 'success');
        } catch (error) {
            console.error(error);
            setFinanceAssignmentFeedback(error?.message || 'No se pudo guardar el alcance financiero.', 'error');
        } finally {
            if (financeAssignmentSave) {
                financeAssignmentSave.textContent = originalText;
                financeAssignmentSave.disabled = financeHierarchyMigrationRequired;
            }
        }
    });

    financeAssignmentList?.addEventListener('click', async (event) => {
        const source = event.target;
        const button = source instanceof Element ? source.closest('[data-finance-action="remove"]') : null;
        if (!button || !financeAssignmentUserId || !currentToken) return;
        const assignmentId = button.dataset.assignmentId;
        if (!assignmentId) return;
        const assignment = activeFinanceAssignments.find((item) => item.id === assignmentId);
        const confirmed = window.confirm(`¿Retirar ${assignment?.scope_label || 'este alcance financiero'}?`);
        if (!confirmed) return;
        const originalText = button.textContent;
        button.textContent = 'Retirando…';
        button.setAttribute('disabled', 'disabled');
        setFinanceAssignmentFeedback();
        try {
            const { res, data } = await fetchJsonWithTimeout('/api/portal/admin/finance-assignments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
                credentials: 'include',
                body: JSON.stringify({ userId: financeAssignmentUserId, assignmentId }),
            }, 20000);
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo retirar el alcance financiero.');
            activeFinanceAssignments = Array.isArray(data.assignments) ? data.assignments : [];
            syncFinanceAssignmentsToUser(activeFinanceAssignments);
            renderFinanceAssignments();
            setFinanceAssignmentFeedback('Alcance financiero retirado.', 'success');
        } catch (error) {
            console.error(error);
            button.textContent = originalText;
            button.removeAttribute('disabled');
            setFinanceAssignmentFeedback(error?.message || 'No se pudo retirar el alcance financiero.', 'error');
        }
    });
}

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

function setCreateUserFeedback(message = '', type = 'info') {
    if (!createUserFeedback) return;
    if (!message) {
        createUserFeedback.textContent = '';
        createUserFeedback.className = 'hidden rounded-xl px-4 py-4 text-sm';
        return;
    }
    const styles = type === 'error'
        ? 'border border-red-200 bg-red-50 text-red-800'
        : type === 'success'
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border border-sky-200 bg-sky-50 text-sky-800';
    createUserFeedback.className = `rounded-xl px-4 py-4 text-sm ${styles}`;
    createUserFeedback.textContent = message;
}

function closeCreateUserModal({ reset = true } = {}) {
    if (reset) {
        form?.reset();
        updateScopeFields(roleSelect?.value || 'user');
    }
    createUserDirty = false;
    setCreateUserFeedback();
    hideAccessibleDialog(modal, btnOpen);
}

function requestCloseCreateUserModal() {
    if (createUserDirty && !window.confirm('Hay datos de usuario sin guardar. ¿Quieres descartarlos?')) return;
    closeCreateUserModal();
}

function setupModal(token) {
    btnOpen?.addEventListener('click', () => {
        if (!currentCreatableRoles.length) {
            alert('No tienes permisos para crear usuarios.');
            return;
        }

        // Populate Roles dynamically
        if (roleSelect) {
            roleSelect.innerHTML = '<option value="" disabled selected>Selecciona un rol</option>';
            const allowedRoles = roleOrder.filter((role) => (
                currentCreatableRoles.includes(role)
                && (role !== 'finance' || currentUserRole === 'superadmin')
            ));

            allowedRoles.forEach((role) => {
                const opt = document.createElement('option');
                opt.value = role;
                opt.textContent = roleTranslations[role] || role;
                roleSelect.appendChild(opt);
            });

            if (!allowedRoles.length) {
                alert('No tienes permisos para crear usuarios.');
                return;
            }
            attachScopeListener();
            populateScopeOptions();
            populateRegionOptions();
            updateScopeFields('');
            void ensureScopeCatalogs(token).then(() => {
                populateScopeOptions();
                populateRegionOptions();
                updateScopeFields(roleSelect.value || '');
            });
        }
        createUserDirty = false;
        setCreateUserFeedback();
        showAccessibleDialog(modal, document.getElementById('create-user-first-name'));
    });

    form?.addEventListener('input', () => {
        createUserDirty = true;
    });
    form?.addEventListener('change', () => {
        createUserDirty = true;
    });
    createUserClose?.addEventListener('click', requestCloseCreateUserModal);
    btnCancel?.addEventListener('click', requestCloseCreateUserModal);
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) createUserClose?.focus();
    });
    document.addEventListener('keydown', (event) => {
        handleAccessibleDialogKeydown(event, modal, createUserClose);
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        setCreateUserFeedback();
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
            if (data.financeAssignmentCreated) {
                successMessage = `${successMessage} Acceso financiero: ${data.financeScopeLabel || 'alcance limitado'}.`;
            } else if (data.financeAssignmentError) {
                successMessage = `${successMessage} ${data.financeAssignmentError} Abre “Finanzas” en la fila de esta persona para completarlo.`;
            }
            alert(successMessage);
            createUserDirty = false;
            closeCreateUserModal();
            loadUsers(token); // Reload list

        } catch (err) {
            console.error(err);
            const message = err?.name === 'AbortError'
                ? 'La creación tardó demasiado y se canceló. Revisa si el usuario se creó antes de intentarlo otra vez.'
                : err?.message || 'No se pudo crear el usuario.';
            setCreateUserFeedback(message, 'error');
            alert(`Error: ${message}`);
        } finally {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
    });
}

window.addEventListener('beforeunload', (event) => {
    if (!createUserDirty || modal?.getAttribute('aria-hidden') !== 'false') return;
    event.preventDefault();
    event.returnValue = '';
});

init().catch((error) => {
    console.error('[portal-users] init error', error);
    showGate(error?.message || 'No se pudieron validar permisos.');
});
