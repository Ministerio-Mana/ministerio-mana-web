import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const tableEl = document.getElementById('users-table');
const tbody = tableEl?.querySelector('tbody');
const loadingEl = document.getElementById('users-loading');
const emptyEl = document.getElementById('users-empty');
const searchInput = document.getElementById('users-search');
const roleFilter = document.getElementById('users-role-filter');
const statusFilter = document.getElementById('users-status-filter');
const countEl = document.getElementById('users-count');

// Modal Elements
const modal = document.getElementById('create-user-modal');
const btnOpen = document.getElementById('btn-open-create-user');
const btnCancel = document.getElementById('btn-cancel-create');
const form = document.getElementById('create-user-form');
const btnSubmit = document.getElementById('btn-submit-create');
const roleSelect = document.getElementById('user-role-select');
const passwordInput = document.getElementById('user-password-input');
const togglePasswordBtn = document.getElementById('toggle-password-user');
const scopeCountryWrapper = document.getElementById('user-scope-country');
const scopeCountryInput = document.getElementById('user-country-input');
const scopeCountryList = document.getElementById('user-country-list');
const scopeChurchWrapper = document.getElementById('user-scope-church');
const scopeChurchSelect = document.getElementById('user-church-select');
const navLinkEvents = document.getElementById('nav-link-events');
const navLinkUsers = document.getElementById('nav-link-users');
const navLinkCampus = document.getElementById('nav-link-campus');
const navLinkFinances = document.getElementById('nav-link-finances');

let currentUserRole = 'user';
let currentUserCountry = '';
let currentUserChurchId = '';
let currentToken = '';
let currentMemberships = [];
let allUsers = [];
let churchesCatalog = [];
let scopeListenerAttached = false;

const roleTranslations = {
    'superadmin': 'Super Admin',
    'admin': 'Admin',
    'national_pastor': 'Pastor Nacional',
    'campus_missionary': 'Misionero Campus',
    'pastor': 'Pastor Local',
    'local_collaborator': 'Colaborador Local',
    'leader': 'Líder (Legacy)',
    'user': 'Usuario (Asistente)'
};

const roleOrder = [
    'superadmin',
    'admin',
    'national_pastor',
    'campus_missionary',
    'pastor',
    'local_collaborator',
    'leader',
    'user',
];

const accessStatusTranslations = {
    active: 'Activo',
    invited: 'Invitado',
    confirmed: 'Confirmado',
    pending: 'Pendiente',
    blocked: 'Bloqueado',
    unknown: 'Sin diagnóstico',
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

function applySidebarPermissions(role, memberships = []) {
    const membershipRoles = (memberships || []).map((m) => m?.role).filter(Boolean);
    let effectiveRole = role || 'user';
    if (effectiveRole === 'user') {
        if (membershipRoles.includes('church_admin')) {
            effectiveRole = 'pastor';
        } else if (membershipRoles.includes('church_member')) {
            effectiveRole = 'local_collaborator';
        }
    }

    const eventManagementRoles = ['superadmin', 'admin', 'national_pastor', 'pastor'];
    const userManagementRoles = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'];
    const campusRoles = ['superadmin', 'admin', 'campus_missionary'];
    const financeRoles = ['superadmin', 'admin'];

    if (navLinkEvents) navLinkEvents.style.display = eventManagementRoles.includes(effectiveRole) ? 'flex' : 'none';
    if (navLinkUsers) navLinkUsers.style.display = userManagementRoles.includes(effectiveRole) ? 'flex' : 'none';
    if (navLinkCampus) navLinkCampus.style.display = campusRoles.includes(effectiveRole) ? 'flex' : 'none';
    if (navLinkFinances) navLinkFinances.style.display = financeRoles.includes(effectiveRole) ? 'flex' : 'none';
    return effectiveRole;
}

// Password Toggle
togglePasswordBtn?.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
});

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/portal/ingresar';
        return;
    }

    const token = session.access_token;
    currentToken = token;

    // 1. Get My Profile to set UI permissions
    try {
        const res = await fetch('/api/portal/session', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const payload = await res.json();
            if (payload?.ok) {
                const profile = payload.profile || {};
                const memberships = payload.memberships || [];
                currentMemberships = memberships;
                currentUserRole = profile.role || 'user';
                currentUserCountry = profile.country || '';
                currentUserChurchId = profile.church_id
                    || memberships.find((m) => m?.church?.id)?.church?.id
                    || '';

                currentUserRole = applySidebarPermissions(currentUserRole, memberships);

                // Hide Create Button for Roles that cannot create users
                if (currentUserRole === 'campus_missionary' || currentUserRole === 'user') {
                    if (btnOpen) btnOpen.style.display = 'none';
                }

                if (currentUserRole === 'admin' || currentUserRole === 'superadmin') {
                    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
                }
            }
        }
    } catch (e) { console.error(e); }

    await loadChurches();

    // 2. Load Users
    loadUsers(token);

    // 3. Setup Events
    setupModal(token);

    searchInput?.addEventListener('input', () => applyFilters());
    roleFilter?.addEventListener('change', () => applyFilters());
    statusFilter?.addEventListener('change', () => applyFilters());
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

function populateScopeOptions() {
    if (!scopeChurchSelect || !scopeCountryList) return;
    const countryFiltered = (currentUserRole === 'national_pastor' && currentUserCountry)
        ? churchesCatalog.filter(c => c.country === currentUserCountry)
        : churchesCatalog;
    scopeChurchSelect.innerHTML = '<option value="">Selecciona una iglesia</option>' +
        countryFiltered
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

function updateScopeFields(role) {
    const needsCountry = role === 'national_pastor';
    const needsChurch = role === 'pastor' || role === 'local_collaborator';

    if (scopeCountryWrapper && scopeCountryInput) {
        scopeCountryWrapper.classList.toggle('hidden', !needsCountry);
        scopeCountryInput.disabled = !needsCountry || (needsCountry && currentUserRole === 'national_pastor');
        if (!needsCountry) {
            scopeCountryInput.value = '';
        } else if (currentUserRole === 'national_pastor' && currentUserCountry) {
            scopeCountryInput.value = currentUserCountry;
        }
    }

    if (scopeChurchWrapper && scopeChurchSelect) {
        scopeChurchWrapper.classList.toggle('hidden', !needsChurch);
        scopeChurchSelect.disabled = !needsChurch;
        if (!needsChurch) {
            scopeChurchSelect.value = '';
        } else if ((currentUserRole === 'pastor' || currentUserRole === 'local_collaborator') && currentUserChurchId) {
            scopeChurchSelect.value = currentUserChurchId;
            scopeChurchSelect.disabled = true;
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
            // alert('No tienes permiso para ver usuarios.');
            // window.location.href = '/portal';
            return;
        }

        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        allUsers = data.users || [];
        applyFilters();

    } catch (err) {
        console.error(err);
        if (loadingEl) loadingEl.textContent = 'Error al cargar usuarios.';
    }
}

function applyFilters() {
    const query = searchInput?.value?.trim().toLowerCase() || '';
    const roleValue = roleFilter?.value || '';
    const statusValue = statusFilter?.value || '';
    const filtered = (allUsers || []).filter((user) => {
        const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
        const searchable = `${name} ${user.email || ''}`.toLowerCase();
        if (query && !searchable.includes(query)) return false;
        if (roleValue && user.role !== roleValue) return false;
        if (statusValue && user.access_status !== statusValue) return false;
        return true;
    });
    renderTable(filtered);
}

function roleBadgeClass(role) {
    if (role === 'admin' || role === 'superadmin') return 'bg-purple-100 text-purple-700';
    if (role === 'pastor' || role === 'national_pastor') return 'bg-blue-100 text-blue-700';
    if (role === 'local_collaborator') return 'bg-teal-100 text-teal-700';
    return 'bg-slate-100 text-slate-600';
}

function statusBadgeClass(status) {
    if (status === 'active') return 'bg-emerald-100 text-emerald-700';
    if (status === 'invited') return 'bg-amber-100 text-amber-700';
    if (status === 'confirmed') return 'bg-cyan-100 text-cyan-700';
    if (status === 'blocked') return 'bg-rose-100 text-rose-700';
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

function renderRoleCell(user) {
    if (currentUserRole === 'superadmin') {
        const options = roleOrder.map((role) => {
            const label = escapeHtml(roleTranslations[role] || role);
            const safeRole = escapeAttr(role);
            const selected = user.role === role ? 'selected' : '';
            return `<option value="${safeRole}" ${selected}>${label}</option>`;
        }).join('');
        return `
            <select data-action="role" data-user-id="${escapeAttr(user.user_id || '')}" class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-[#293C74]">
                ${options}
            </select>
        `;
    }

    const label = escapeHtml(roleTranslations[user.role] || user.role || 'Usuario');
    const badgeClass = roleBadgeClass(user.role);
    return `
        <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
            ${label}
        </span>
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
            const resetLabel = accessStatus === 'invited' || accessStatus === 'pending' ? 'Reenviar acceso' : 'Reset contraseña';
            const canSendAccessLink = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'].includes(currentUserRole);
            const resetButton = canSendAccessLink
                ? `<button data-action="reset" data-email="${safeEmailAttr}" class="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-[#293C74] hover:bg-slate-100">${escapeHtml(resetLabel)}</button>`
                : '';
            return `
                <tr class="group hover:bg-slate-50 transition-colors">
                    <td class="py-3 pl-2 font-medium text-[#293C74]">${safeFullName}</td>
                    <td class="py-3 text-slate-500">${safeEmail}</td>
                    <td class="py-3">
                        ${renderRoleCell(u)}
                    </td>
                    <td class="py-3">
                        <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${accessStatusClass}">
                            ${safeStatusLabel}
                        </span>
                    </td>
                    <td class="py-3 text-slate-400 text-xs">${safeLastSignIn}</td>
                    <td class="py-3 text-right pr-2">
                        ${resetButton || '<span class="text-[10px] text-slate-400 uppercase tracking-widest">-</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }
}

tbody?.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.action !== 'role') return;
    const userId = target.dataset.userId;
    const role = target.value;
    if (!userId || !currentToken) return;

    try {
        const res = await fetch('/api/portal/admin/role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ userId, role })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar el rol');
        const idx = allUsers.findIndex((user) => user.user_id === userId);
        if (idx !== -1) {
            allUsers[idx].role = role;
            applyFilters();
        }
    } catch (err) {
        console.error(err);
        alert(err.message || 'No se pudo actualizar el rol.');
    }
});

tbody?.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action="reset"]');
    if (!target || !currentToken) return;
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

function setupModal(token) {
    btnOpen?.addEventListener('click', () => {
        // Validation: Campus Missionaries cannot create
        if (currentUserRole === 'campus_missionary' || currentUserRole === 'user') {
            alert('No tienes permisos para crear usuarios.');
            return;
        }

        modal?.classList.remove('hidden');

        // Populate Roles dynamically
        if (roleSelect) {
            roleSelect.innerHTML = '';
            let allowedRoles = [];

            if (currentUserRole === 'superadmin') {
                allowedRoles = ['admin', 'national_pastor', 'campus_missionary', 'pastor', 'local_collaborator', 'user'];
            } else if (currentUserRole === 'admin') {
                allowedRoles = ['national_pastor', 'campus_missionary', 'pastor', 'local_collaborator', 'user'];
            } else if (currentUserRole === 'national_pastor') {
                allowedRoles = ['campus_missionary', 'pastor', 'local_collaborator', 'user'];
            } else if (currentUserRole === 'pastor') { // Local Pastor
                allowedRoles = ['local_collaborator', 'user'];
            } else if (currentUserRole === 'local_collaborator') {
                allowedRoles = ['user'];
            }

            // Always allow creating 'user' as fallback if list is empty? No, logic above covers it.

            allowedRoles.forEach(role => {
                const opt = document.createElement('option');
                opt.value = role;
                opt.textContent = roleTranslations[role] || role;
                roleSelect.appendChild(opt);
            });
            attachScopeListener();
            populateScopeOptions();
            updateScopeFields(roleSelect.value);
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
            const res = await fetch('/api/portal/admin/users/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.error || 'Error al crear');

            alert('Usuario creado exitosamente.');
            modal?.classList.add('hidden');
            form.reset();
            loadUsers(token); // Reload list

        } catch (err) {
            console.error(err);
            alert(`Error: ${err.message}`);
        } finally {
            btnSubmit.textContent = originalText;
            btnSubmit.disabled = false;
        }
    });
}

init();
