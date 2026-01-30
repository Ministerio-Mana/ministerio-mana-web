import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';
import { gsap } from 'gsap';

const loadingEl = document.getElementById('account-loading');
console.log('Portal Script Started. Loading El:', loadingEl); // DEBUG
const errorEl = document.getElementById('account-error');
const contentEl = document.getElementById('account-content');
const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');
const profileRole = document.getElementById('profile-role');
const profilePhone = document.getElementById('profile-phone');
const profileCity = document.getElementById('profile-city');
const profileCountry = document.getElementById('profile-country');
const profileAffiliation = document.getElementById('profile-affiliation');
const profileChurchWrapper = document.getElementById('profile-church-wrapper');
const profileChurchName = document.getElementById('profile-church-name');
const profileStatus = document.getElementById('profile-status');
const welcomeName = document.getElementById('welcome-name');

// Stats
const statTotalPaid = document.getElementById('stat-total-paid');
const statNextDue = document.getElementById('stat-next-due');
const planHighlight = document.getElementById('plan-highlight');
const highlightAmount = document.getElementById('highlight-amount');
const highlightDate = document.getElementById('highlight-date');

const bookingsList = document.getElementById('bookings-list');
const bookingsEmpty = document.getElementById('bookings-empty');
const plansList = document.getElementById('plans-list');
const plansEmpty = document.getElementById('plans-empty');
const installmentsList = document.getElementById('installments-list');
const installmentsEmpty = document.getElementById('installments-empty');
const paymentsTable = document.getElementById('payments-table');
const paymentsEmpty = document.getElementById('payments-empty');
const churchMembershipsEmpty = document.getElementById('church-memberships-empty');
const churchMembershipsList = document.getElementById('church-memberships-list');
const churchForm = document.getElementById('church-manual-form');
const churchFormToggle = document.getElementById('church-form-toggle');
const churchNameInput = document.getElementById('church-name');
const churchFormStatus = document.getElementById('church-form-status');
const churchBookingsEmpty = document.getElementById('church-bookings-empty');
const churchBookingsList = document.getElementById('church-bookings-list');
const churchBookingsSearch = document.getElementById('church-bookings-search');
const churchBookingsStatus = document.getElementById('church-bookings-status');
const churchPaymentsEmpty = document.getElementById('church-payments-empty');
const churchPaymentsList = document.getElementById('church-payments-list');
const churchPaymentsSearch = document.getElementById('church-payments-search');
const churchPaymentsStatus = document.getElementById('church-payments-status');
const churchPaymentsProvider = document.getElementById('church-payments-provider');
const churchPaymentsFrom = document.getElementById('church-payments-from');
const churchPaymentsTo = document.getElementById('church-payments-to');
const churchExportBtn = document.getElementById('church-export-btn');
const churchExportStatus = document.getElementById('church-export-status');
const churchInstallmentsEmpty = document.getElementById('church-installments-empty');
const churchInstallmentsList = document.getElementById('church-installments-list');
const churchInstallmentsSearch = document.getElementById('church-installments-search');
const churchInstallmentsStatusFilter = document.getElementById('church-installments-status');
const churchInstallmentsStatusMsg = document.getElementById('church-installments-status-msg');
const participantsList = document.getElementById('participants-list');
const addParticipantBtn = document.getElementById('btn-add-participant');
const inviteCard = document.getElementById('church-invite-card');
const inviteEmail = document.getElementById('church-invite-email');
const inviteRole = document.getElementById('church-invite-role');
const inviteStatus = document.getElementById('church-invite-status');
const inviteBtn = document.getElementById('church-invite-btn');
const inviteChurchWrapper = document.getElementById('church-invite-church-wrapper');
const inviteChurchInput = document.getElementById('church-invite-church');
const iglesiaNavLabel = document.getElementById('nav-iglesia-label');
const iglesiaTitle = document.getElementById('iglesia-title');
const iglesiaSubtitle = document.getElementById('iglesia-subtitle');
const churchMembersEmpty = document.getElementById('church-members-empty');
const churchMembersList = document.getElementById('church-members-list');
const churchMembersSearch = document.getElementById('church-members-search');
const churchMembersRole = document.getElementById('church-members-role');
const churchSelector = document.getElementById('church-selector');
const churchSelectorInput = document.getElementById('church-selector-input');
const churchSelectorStatus = document.getElementById('church-selector-status');
const adminUsersCard = document.getElementById('admin-users-card');
const adminInviteEmail = document.getElementById('admin-invite-email');
const adminInviteName = document.getElementById('admin-invite-name');
const adminInviteRole = document.getElementById('admin-invite-role');
const adminInviteChurchRole = document.getElementById('admin-invite-church-role');
const adminInviteChurch = document.getElementById('admin-invite-church');
const adminInviteStatus = document.getElementById('admin-invite-status');
const adminInviteBtn = document.getElementById('admin-invite-btn');
const adminUsersEmpty = document.getElementById('admin-users-empty');
const adminUsersList = document.getElementById('admin-users-list');

// UI Helpers
const navLinks = document.querySelectorAll('.nav-link');
const tabContents = document.querySelectorAll('.tab-content');
const logoutBtn = document.getElementById('btn-logout');
const saveProfileBtn = document.getElementById('btn-save-profile');
const onboardingModal = document.getElementById('onboarding-modal');
const onboardingForm = document.getElementById('onboarding-form');
const onboardingStatus = document.getElementById('onboarding-status');
const onboardName = document.getElementById('onboard-name');
const onboardPhone = document.getElementById('onboard-phone');
const onboardCity = document.getElementById('onboard-city');
const onboardCountry = document.getElementById('onboard-country');
const onboardAffiliation = document.getElementById('onboard-affiliation');
const onboardChurchWrapper = document.getElementById('onboard-church-wrapper');
const onboardChurchName = document.getElementById('onboard-church-name');

let supabase = null;
try {
  supabase = getSupabaseBrowserClient();
} catch (err) {
  console.error('Supabase client not available:', err);
  if (loadingEl) loadingEl.classList.add('hidden');
  if (errorEl) errorEl.classList.remove('hidden');
}
let portalProfile = null;
let portalMemberships = [];
let authMode = 'supabase';
let churchParticipantsCount = 0;
let portalAuthHeaders = {};
let portalIsAdmin = false;
let portalIsSuperadmin = false;
let portalSelectedChurchId = null;
let portalChurchesCatalog = [];
let portalIsCustomChurch = false;
let churchBookingsData = [];
let churchMembersData = [];
let churchPaymentsData = [];
let churchInstallmentsData = [];

function formatCurrency(value, currency) {
  if (!currency) return value;
  if (currency === 'COP') {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getAuthRedirectState() {
  const url = new URL(window.location.href);
  const hasHashToken = Boolean(window.location.hash && window.location.hash.includes('access_token'));
  const hasCode = url.searchParams.has('code');
  const hasError = url.searchParams.has('error');
  const hasType = url.searchParams.has('type');
  return {
    url,
    hasHashToken,
    hasCode,
    hasError,
    hasType,
    isAuthRedirect: hasHashToken || hasCode || hasError || hasType,
  };
}

function cleanupAuthRedirect() {
  const url = new URL(window.location.href);
  if (url.hash && url.hash.includes('access_token')) {
    url.hash = '';
  }
  ['code', 'type', 'error', 'error_description', 'access_token', 'refresh_token', 'expires_in', 'token_type'].forEach((param) => {
    url.searchParams.delete(param);
  });
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

// Tabs Navigation
navLinks.forEach(link => {
  link.addEventListener('click', () => {
    const targetTab = link.dataset.tab;
    switchTab(targetTab);
  });
});

document.querySelectorAll('[data-tab-trigger]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tabTrigger);
  });
});

function switchTab(tabId) {
  // Update links
  navLinks.forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  // Update contents with GSAP
  tabContents.forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.remove('hidden');
      gsap.fromTo(content, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power2.out' });
    } else {
      content.classList.add('hidden');
    }
  });
}

// Core Dashboard Logic - Reactive Auth
async function fetchDashboardData(session) {
  console.log('fetchDashboardData called', session);
  try {
    const token = session?.access_token;
    if (!token) throw new Error('No access token');

    let headers = { Authorization: `Bearer ${token}` };
    portalAuthHeaders = headers;

    // 2. Parallelized Initial Data Fetching
    if (!supabase) throw new Error('Supabase no configurado');

    const [sessionRes, resumenRes, { data: userData }] = await Promise.all([
      fetch('/api/portal/session', { headers }),
      // Fetch resumen immediately with the token we already have
      fetch('/api/cuenta/resumen', { headers }),
      supabase.auth.getUser(),
    ]);



    const sessionPayload = await sessionRes.json();
    if (!sessionRes.ok || !sessionPayload.ok) throw new Error(sessionPayload.error || 'No se pudo cargar el perfil');

    let payload = { ok: true, user: {}, bookings: [], plans: [], payments: [] };
    const resData = await resumenRes.json();
    if (!resumenRes.ok || !resData.ok) {
      // Optional: Log error but continue with minimal profile?
      console.warn('Could not load resumen:', resData.error);
    } else {
      payload = resData;
    }

    authMode = sessionPayload.mode || 'supabase';
    portalProfile = sessionPayload.profile || {};
    portalMemberships = sessionPayload.memberships || [];
    portalIsAdmin = portalProfile?.role === 'admin' || portalProfile?.role === 'superadmin';
    portalIsSuperadmin = portalProfile?.role === 'superadmin';

    const hasChurchRole = (portalMemberships || []).some(
      (membership) => ['church_admin', 'church_member'].includes(membership?.role) && membership?.status !== 'pending',
    );
    const hasChurchAccess = portalIsAdmin || hasChurchRole;
    const membershipChurch = portalMemberships.find((item) => item?.church?.id)?.church || null;

    if (!portalSelectedChurchId && membershipChurch?.id) {
      portalSelectedChurchId = membershipChurch.id;
    }
    if (churchNameInput && membershipChurch?.name && !portalIsAdmin) {
      churchNameInput.value = membershipChurch.name;
      churchNameInput.setAttribute('readonly', 'readonly');
      churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
    }

    const user = userData?.user;

    const activeUser = payload.user || {};
    const name = activeUser.fullName || user?.user_metadata?.full_name || 'Usuario';
    profileName.value = name;
    welcomeName.textContent = name.split(' ')[0];
    profileEmail.value = activeUser.email || user?.email || '';
    if (profileRole) profileRole.value = portalProfile?.role || 'user';
    profilePhone.value = portalProfile.phone || '';
    profileCity.value = portalProfile.city || '';
    profileCountry.value = portalProfile.country || '';
    profileAffiliation.value = portalProfile.affiliation_type || '';
    profileChurchName.value = portalProfile.church_name || '';
    toggleChurchField(profileAffiliation.value);

    if (portalProfile?.role === 'admin' || portalProfile?.role === 'superadmin') {
      if (iglesiaNavLabel) iglesiaNavLabel.textContent = 'Eventos';
      if (iglesiaTitle) iglesiaTitle.textContent = 'Cumbre Mundial 2026';
      if (iglesiaSubtitle) iglesiaSubtitle.textContent = 'Panel general del evento para gestión de sedes y registros físicos.';
    }

    // Calculations for highlights
    let totalPaidAll = 0;
    payload.bookings?.forEach(b => totalPaidAll += (b.total_paid || 0));
    statTotalPaid.textContent = formatCurrency(totalPaidAll, payload.bookings?.[0]?.currency);

    const activePlan = payload.plans?.find(p => p.status === 'ACTIVE');
    if (activePlan) {
      statNextDue.textContent = formatDate(activePlan.next_due_date);
      planHighlight.classList.remove('hidden');
      highlightAmount.textContent = formatCurrency(activePlan.installment_amount, activePlan.currency);
      highlightDate.textContent = formatDate(activePlan.next_due_date);
    }

    renderBookings(payload.bookings || []);
    renderPlans(payload.plans || [], payload.bookings || []);
    renderInstallments(payload.installments || [], payload.plans || [], payload.bookings || []);
    renderPayments(payload.payments || []);
    renderMemberships(portalMemberships);
    setupInviteAccess();
    initAdminInvite();
    // 5. Reveal Dashboard (Eager Loading)
    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');
    gsap.from(contentEl, { opacity: 0, y: 30, duration: 1, ease: 'expo.out' });

    // 6. Background Initialization (Parallelized)
    const backgroundTasks = [];
    if (hasChurchAccess) {
      backgroundTasks.push(loadChurchSelector(headers));
      backgroundTasks.push(loadChurchBookings(headers));
      backgroundTasks.push(loadChurchPayments(headers));
      backgroundTasks.push(loadChurchInstallments(headers));
      backgroundTasks.push(loadChurchMembers(headers));
    }
    backgroundTasks.push(loadAdminUsers(headers));
    backgroundTasks.push(loadChurchDraft());

    await Promise.all(backgroundTasks);

    if (authMode === 'password') {
      if (onboardingModal) onboardingModal.classList.add('hidden');
      if (saveProfileBtn) {
        saveProfileBtn.disabled = true;
        saveProfileBtn.classList.add('opacity-40', 'cursor-not-allowed');
      }
    } else if (!portalProfile?.full_name || !portalProfile?.affiliation_type) {
      showOnboarding();
    }
  } catch (err) {
    console.error(err);
    if (!loadingEl.classList.contains('hidden')) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
    }
  }
}

function setupInviteAccess() {
  if (!inviteCard) return;
  const profileRole = portalProfile?.role || 'user';
  const membershipRoles = (portalMemberships || []).map((m) => m?.role);
  const canInvite = profileRole === 'admin' || profileRole === 'superadmin' || membershipRoles.includes('church_admin');
  if (!canInvite) {
    inviteCard.classList.add('hidden');
    return;
  }
  inviteCard.classList.remove('hidden');
  if (profileRole === 'admin' || profileRole === 'superadmin') {
    inviteChurchWrapper?.classList.remove('hidden');
  } else {
    inviteChurchWrapper?.classList.add('hidden');
    if (inviteRole) {
      inviteRole.value = 'church_member';
      inviteRole.querySelector('option[value="church_admin"]')?.setAttribute('disabled', 'disabled');
    }
  }
}

function buildParticipantRow(data = {}) {
  churchParticipantsCount += 1;
  const row = document.createElement('div');
  row.className = 'rounded-2xl border border-slate-200 bg-white p-4 space-y-3';
  row.innerHTML = `
    <div class="flex items-center justify-between">
      <p class="text-xs font-bold text-[#293C74]">Persona ${churchParticipantsCount}</p>
      <button type="button" class="text-xs font-bold text-red-500 hover:underline" data-action="remove">Quitar</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input type="text" data-field="fullName" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Nombre completo" value="${data.fullName || ''}">
      <input type="number" min="0" data-field="age" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Edad" value="${data.age || ''}">
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <select data-field="lodging" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
        <option value="yes">Con alojamiento</option>
        <option value="no">Sin alojamiento</option>
      </select>
      <select data-field="menuType" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
        <option value="">Tipo de menú</option>
        <option value="TRADICIONAL">Menú tradicional</option>
        <option value="VEGETARIANO">Menú vegetariano</option>
      </select>
      <input type="text" data-field="relationship" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Relación (ej: Hijo/a)" value="${data.relationship || ''}">
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="grid grid-cols-[110px_1fr] gap-2">
        <select data-field="documentType" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
          <option value="CC">CC</option>
          <option value="TI">TI</option>
          <option value="CE">CE</option>
          <option value="PASSPORT">Pasaporte</option>
        </select>
        <input type="text" data-field="documentNumber" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Documento" value="${data.documentNumber || ''}">
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="date" data-field="birthdate" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" value="${data.birthdate || ''}">
        <select data-field="gender" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
          <option value="">Género</option>
          <option value="M">Masculino</option>
          <option value="F">Femenino</option>
        </select>
      </div>
    </div>
  `;
  const removeBtn = row.querySelector('[data-action="remove"]');
  removeBtn.addEventListener('click', () => {
    row.remove();
  });
  return row;
}

function collectParticipants() {
  const participants = [];
  const rows = participantsList?.querySelectorAll('[data-field]') ? participantsList.querySelectorAll('.rounded-2xl') : [];
  rows.forEach((row) => {
    const getValue = (field) => row.querySelector(`[data-field="${field}"]`)?.value?.toString().trim() || '';
    const ageValue = Number(getValue('age') || 0);
    participants.push({
      fullName: getValue('fullName'),
      age: ageValue,
      lodging: getValue('lodging'),
      menuType: getValue('menuType'),
      relationship: getValue('relationship'),
      documentType: getValue('documentType'),
      documentNumber: getValue('documentNumber'),
      birthdate: getValue('birthdate'),
      gender: getValue('gender'),
    });
  });
  return participants.filter((p) => p.fullName);
}

async function loadChurchSelector(headers = {}) {
  if (!churchSelector || !churchSelectorInput) return;
  churchSelectorStatus.textContent = 'Cargando iglesias...';
  try {
    const res = await fetch('/api/portal/iglesia/selection', { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar iglesias');

    const churches = payload.churches || [];
    portalChurchesCatalog = churches;
    const isAdmin = Boolean(payload.isAdmin);
    churchSelectorInput.innerHTML = '<option value="">Selecciona una iglesia</option>';
    churches.forEach((church) => {
      const option = document.createElement('option');
      option.value = church.id;
      const label = church?.code
        ? `${church.code} · ${church.name}${church.city ? ` · ${church.city}` : ''}`
        : `${church.name}${church.city ? ` · ${church.city}` : ''}`;
      option.textContent = label;
      churchSelectorInput.appendChild(option);
    });

    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = 'Otra iglesia (manual)';
    churchSelectorInput.appendChild(customOption);

    portalSelectedChurchId = payload.selectedChurchId || '';
    portalIsCustomChurch = false;
    if (portalSelectedChurchId) {
      churchSelectorInput.value = portalSelectedChurchId;
    } else if (churches.length === 1) {
      portalSelectedChurchId = churches[0].id;
      churchSelectorInput.value = portalSelectedChurchId;
      await saveChurchSelection(portalSelectedChurchId, headers);
    }

    if (portalSelectedChurchId && churchNameInput) {
      const selected = portalChurchesCatalog.find((item) => item.id === portalSelectedChurchId);
      if (selected) {
        churchNameInput.value = selected.name;
        churchNameInput.setAttribute('readonly', 'readonly');
        churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
      }
    }

    if (isAdmin) {
      churchSelector.classList.remove('hidden');
    } else {
      churchSelector.classList.add('hidden');
    }

    churchSelectorStatus.textContent = churches.length ? 'Selecciona una iglesia para ver los registros.' : 'No hay iglesias disponibles.';
  } catch (err) {
    console.error(err);
    churchSelectorStatus.textContent = 'No se pudo cargar iglesias.';
  }
}

async function saveChurchSelection(churchId, headers = {}) {
  if (!churchSelectorStatus) return;
  churchSelectorStatus.textContent = 'Guardando selección...';
  try {
    const res = await fetch('/api/portal/iglesia/selection', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ churchId }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar');
    portalSelectedChurchId = payload.churchId || '';
    churchSelectorStatus.textContent = 'Iglesia seleccionada.';

    if (churchNameInput) {
      if (portalSelectedChurchId) {
        const selected = portalChurchesCatalog.find((item) => item.id === portalSelectedChurchId);
        if (selected) {
          churchNameInput.value = selected.name;
          churchNameInput.setAttribute('readonly', 'readonly');
          churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
        }
      } else {
        churchNameInput.removeAttribute('readonly');
        churchNameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
      }
    }
  } catch (err) {
    console.error(err);
    churchSelectorStatus.textContent = err?.message || 'Error guardando selección.';
  }
}

function filterChurchBookings(list) {
  const query = churchBookingsSearch?.value?.trim().toLowerCase() || '';
  const status = churchBookingsStatus?.value || '';
  return (list || []).filter((item) => {
    const searchable = [
      item.contact_name,
      item.contact_email,
      item.contact_church,
      item.reference,
      item.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (status && item.status !== status) return false;
    return true;
  });
}

function renderChurchBookings(list) {
  if (!churchBookingsList || !churchBookingsEmpty) return;
  churchBookingsList.innerHTML = '';
  if (!list.length) {
    churchBookingsEmpty.classList.remove('hidden');
    churchBookingsList.classList.add('hidden');
    return;
  }
  churchBookingsEmpty.classList.add('hidden');
  churchBookingsList.classList.remove('hidden');
  list.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-slate-50/70 p-4';
    const churchLabel = item.contact_church ? `<p class="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">${item.contact_church}</p>` : '';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Reserva</p>
          ${churchLabel}
          <p class="text-sm font-bold text-[#293C74]">#${(item.reference || item.id)?.slice(0, 8).toUpperCase()}</p>
          <p class="text-xs text-slate-500">${item.contact_name || item.contact_email || ''}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pagado</p>
          <p class="text-sm font-bold text-[#293C74]">${formatCurrency(item.total_paid, item.currency)}</p>
          <p class="text-xs text-slate-500">Total ${formatCurrency(item.total_amount, item.currency)}</p>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>${item.participant_count || 0} participantes</span>
        <span>${item.status || 'PENDING'}</span>
      </div>
    `;
    churchBookingsList.appendChild(card);
  });
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterChurchPayments(list) {
  const query = churchPaymentsSearch?.value?.trim().toLowerCase() || '';
  const status = churchPaymentsStatus?.value || '';
  const provider = churchPaymentsProvider?.value || '';
  const from = parseDateInput(churchPaymentsFrom?.value);
  const toRaw = churchPaymentsTo?.value;
  const to = toRaw ? new Date(`${toRaw}T23:59:59`) : null;

  return (list || []).filter((payment) => {
    const booking = payment.booking || {};
    const searchable = [
      booking.contact_name,
      booking.contact_email,
      booking.contact_phone,
      booking.contact_church,
      payment.reference,
      payment.provider_tx_id,
      payment.booking_id,
      payment.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (status && payment.status !== status) return false;
    if (provider && payment.provider !== provider) return false;
    if (from || to) {
      const created = payment.created_at ? new Date(payment.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return false;
      if (from && created < from) return false;
      if (to && created > to) return false;
    }
    return true;
  });
}

function renderChurchPayments(list) {
  if (!churchPaymentsList || !churchPaymentsEmpty) return;
  churchPaymentsList.innerHTML = '';
  if (!list.length) {
    churchPaymentsEmpty.classList.remove('hidden');
    churchPaymentsList.classList.add('hidden');
    return;
  }
  churchPaymentsEmpty.classList.add('hidden');
  churchPaymentsList.classList.remove('hidden');

  list.forEach((payment) => {
    const booking = payment.booking || {};
    const providerLabel = payment.provider ? payment.provider.toUpperCase() : '—';
    const statusLabel = payment.status || 'PENDING';
    const methodLabel = payment.method || '—';
    const referenceLabel = (payment.reference || payment.id || '').toString();
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-4 py-4';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pago</p>
          <p class="text-sm font-bold text-[#293C74]">${formatCurrency(payment.amount, payment.currency)}</p>
          <p class="text-xs text-slate-500">${providerLabel} · ${statusLabel}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Referencia</p>
          <p class="text-xs font-bold text-[#293C74]">#${referenceLabel.slice(0, 10).toUpperCase()}</p>
          <p class="text-xs text-slate-500">${formatDate(payment.created_at)}</p>
        </div>
      </div>
      <div class="mt-2 text-xs text-slate-500">
        ${booking.contact_name || booking.contact_email || 'Sin nombre'}
        ${booking.contact_email ? ` · ${booking.contact_email}` : ''}
      </div>
      <div class="mt-2 text-[11px] text-slate-400">Método: ${methodLabel}</div>
    `;
    churchPaymentsList.appendChild(card);
  });
}

function filterChurchInstallments(list) {
  const query = churchInstallmentsSearch?.value?.trim().toLowerCase() || '';
  const status = churchInstallmentsStatusFilter?.value || '';
  return (list || []).filter((item) => {
    const booking = item.booking || {};
    const searchable = [
      booking.contact_name,
      booking.contact_email,
      booking.contact_phone,
      booking.contact_church,
      item.provider_reference,
      item.booking_id,
      item.id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (status && item.status !== status) return false;
    return true;
  });
}

function renderChurchInstallments(list) {
  if (!churchInstallmentsList || !churchInstallmentsEmpty) return;
  churchInstallmentsList.innerHTML = '';
  if (!list.length) {
    churchInstallmentsEmpty.classList.remove('hidden');
    churchInstallmentsList.classList.add('hidden');
    return;
  }
  churchInstallmentsEmpty.classList.add('hidden');
  churchInstallmentsList.classList.remove('hidden');

  list.forEach((item) => {
    const booking = item.booking || {};
    const plan = item.plan || {};
    const statusLabel = item.status || 'PENDING';
    const statusClass = statusLabel === 'PAID'
      ? 'bg-green-100 text-green-700'
      : statusLabel === 'FAILED'
        ? 'bg-red-100 text-red-700'
        : 'bg-yellow-100 text-yellow-700';
    const amountLabel = formatCurrency(item.amount, item.currency || plan.currency);
    const dueLabel = formatDate(item.due_date);
    const reminderLabel = item.last_reminder?.sent_at ? formatDateTime(item.last_reminder.sent_at) : '—';
    const linkLabel = item.last_link?.created_at ? formatDateTime(item.last_link.created_at) : '—';
    const isAuto = (plan.provider === 'wompi' && plan.provider_payment_method_id)
      || (plan.provider === 'stripe' && plan.provider_subscription_id);
    const chargeLabel = isAuto ? 'Auto' : 'Manual';
    const chargeClass = isAuto ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
    const actionsHtml = isAuto
      ? '<div class="text-xs font-semibold text-emerald-700">Cobro automático activo</div>'
      : `
        <button class="church-installment-action px-3 py-2 rounded-xl bg-[#293C74] text-white text-xs font-bold hover:shadow-md transition" data-action="copy-link" data-installment="${item.id}">
          Copiar link
        </button>
        <button class="church-installment-action px-3 py-2 rounded-xl bg-white border border-slate-200 text-[#293C74] text-xs font-bold hover:bg-slate-50 transition" data-action="send-reminder" data-installment="${item.id}">
          Enviar recordatorio
        </button>
      `;

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-4 py-4';
    card.innerHTML = `
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cuota</p>
          <p class="text-sm font-bold text-[#293C74]">${amountLabel}</p>
          <p class="text-xs text-slate-500">Vence: ${dueLabel}</p>
          <p class="text-xs text-slate-500">${booking.contact_name || booking.contact_email || 'Sin nombre'}</p>
          <p class="text-[11px] text-slate-400">Ref: ${(item.provider_reference || item.id).toString().slice(0, 12).toUpperCase()}</p>
        </div>
        <div class="text-right space-y-2">
          <span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass}">${statusLabel}</span>
          <span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${chargeClass}">Cobro ${chargeLabel}</span>
          <div class="text-[11px] text-slate-400">Último link: ${linkLabel}</div>
          <div class="text-[11px] text-slate-400">Último recordatorio: ${reminderLabel}</div>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        ${actionsHtml}
      </div>
    `;
    churchInstallmentsList.appendChild(card);
  });
}

async function loadChurchBookings(headers = {}) {
  if (!churchBookingsList || !churchBookingsEmpty) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchBookingsEmpty.textContent = 'Selecciona una iglesia para ver los registros.';
    churchBookingsEmpty.classList.remove('hidden');
    churchBookingsList.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/bookings', window.location.origin);
    if (portalSelectedChurchId) {
      url.searchParams.set('churchId', portalSelectedChurchId);
    }
    const res = await fetch(url.toString(), { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchBookingsData = payload.bookings || [];
    const filtered = filterChurchBookings(churchBookingsData);
    renderChurchBookings(filtered);
  } catch (err) {
    console.error(err);
  }
}

async function loadChurchInstallments(headers = {}) {
  if (!churchInstallmentsList || !churchInstallmentsEmpty) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchInstallmentsEmpty.textContent = 'Selecciona una iglesia para ver las cuotas.';
    churchInstallmentsEmpty.classList.remove('hidden');
    churchInstallmentsList.classList.add('hidden');
    return;
  }
  try {
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = 'Cargando cuotas...';
    }
    const url = new URL('/api/portal/iglesia/installments', window.location.origin);
    if (portalSelectedChurchId) {
      url.searchParams.set('churchId', portalSelectedChurchId);
    }
    const res = await fetch(url.toString(), { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchInstallmentsData = payload.installments || [];
    renderChurchInstallments(filterChurchInstallments(churchInstallmentsData));
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = '';
    }
  } catch (err) {
    console.error(err);
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = err?.message || 'No se pudo cargar.';
    }
  }
}

async function loadChurchPayments(headers = {}) {
  if (!churchPaymentsList || !churchPaymentsEmpty) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchPaymentsEmpty.textContent = 'Selecciona una iglesia para ver los pagos.';
    churchPaymentsEmpty.classList.remove('hidden');
    churchPaymentsList.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/payments', window.location.origin);
    if (portalSelectedChurchId) {
      url.searchParams.set('churchId', portalSelectedChurchId);
    }
    const res = await fetch(url.toString(), { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchPaymentsData = payload.payments || [];
    const filtered = filterChurchPayments(churchPaymentsData);
    renderChurchPayments(filtered);
  } catch (err) {
    console.error(err);
  }
}

function filterChurchMembers(list) {
  const query = churchMembersSearch?.value?.trim().toLowerCase() || '';
  const role = churchMembersRole?.value || '';
  return (list || []).filter((member) => {
    const profile = member.profile || {};
    const searchable = [profile.full_name, profile.email].filter(Boolean).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (role && member.role !== role) return false;
    return true;
  });
}

function renderChurchMembers(list) {
  if (!churchMembersList || !churchMembersEmpty) return;
  if (!list.length) {
    churchMembersEmpty.classList.remove('hidden');
    churchMembersList.classList.add('hidden');
    return;
  }
  churchMembersEmpty.classList.add('hidden');
  churchMembersList.classList.remove('hidden');
  churchMembersList.innerHTML = '';
  list.forEach((member) => {
    const card = document.createElement('div');
    const profile = member.profile || {};
    card.className = 'rounded-2xl border border-slate-200 bg-white px-4 py-3';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-bold text-[#293C74]">${profile.full_name || profile.email || 'Usuario'}</p>
          <p class="text-xs text-slate-500">${profile.email || ''}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] uppercase tracking-widest text-slate-400 font-bold">${member.role}</p>
          <p class="text-[10px] text-slate-400">${member.status}</p>
        </div>
      </div>
    `;
    churchMembersList.appendChild(card);
  });
}

async function loadChurchMembers(headers = {}) {
  if (!churchMembersList || !churchMembersEmpty) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchMembersEmpty.textContent = 'Selecciona una iglesia para ver el equipo.';
    churchMembersEmpty.classList.remove('hidden');
    churchMembersList.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/members', window.location.origin);
    if (portalSelectedChurchId) {
      url.searchParams.set('churchId', portalSelectedChurchId);
    }
    const res = await fetch(url.toString(), { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchMembersData = payload.members || [];
    const filtered = filterChurchMembers(churchMembersData);
    renderChurchMembers(filtered);
  } catch (err) {
    console.error(err);
  }
}

async function exportChurchBookings() {
  if (!churchExportBtn || !churchExportStatus) return;
  if (!portalSelectedChurchId) {
    churchExportStatus.textContent = 'Selecciona una iglesia antes de exportar.';
    return;
  }
  churchExportStatus.textContent = 'Preparando export...';
  try {
    const url = new URL('/api/portal/iglesia/export', window.location.origin);
    url.searchParams.set('churchId', portalSelectedChurchId);
    const res = await fetch(url.toString(), { headers: portalAuthHeaders });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo exportar');
    }
    const blob = await res.blob();
    const filename = res.headers.get('content-disposition')?.split('filename=')?.[1]?.replace(/"/g, '') || 'portal-iglesia.csv';
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    churchExportStatus.textContent = 'Export listo.';
  } catch (err) {
    console.error(err);
    churchExportStatus.textContent = err?.message || 'No se pudo exportar.';
  }
}

async function loadAdminUsers(headers = {}) {
  if (!adminUsersCard) return;
  if (!portalIsAdmin) {
    adminUsersCard.classList.add('hidden');
    return;
  }
  adminUsersCard.classList.remove('hidden');

  try {
    const res = await fetch('/api/portal/admin/users', { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    renderAdminUsers(payload.users || []);
  } catch (err) {
    console.error(err);
    if (adminUsersEmpty) adminUsersEmpty.classList.remove('hidden');
  }
}

function renderAdminUsers(users) {
  if (!adminUsersList || !adminUsersEmpty) return;
  adminUsersList.innerHTML = '';
  if (!users.length) {
    adminUsersEmpty.classList.remove('hidden');
    adminUsersList.classList.add('hidden');
    return;
  }
  adminUsersEmpty.classList.add('hidden');
  adminUsersList.classList.remove('hidden');

  users.forEach((user) => {
    const rolesLabel = (user.memberships || [])
      .map((m) => `${m.role}${m.church?.name ? ` · ${m.church.name}` : ''}`)
      .join(' | ');
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3';
    const roleSelect = portalIsSuperadmin
      ? `<select data-action="role" data-user="${user.user_id}" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-[#293C74]">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuario</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option>
        </select>`
      : `<span class="text-xs font-bold text-[#293C74]">${user.role}</span>`;
    card.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p class="text-sm font-bold text-[#293C74]">${user.full_name || user.email}</p>
          <p class="text-xs text-slate-500">${user.email}</p>
          <p class="text-[10px] text-slate-400 mt-1">${rolesLabel || 'Sin rol de iglesia'}</p>
        </div>
        <div class="flex items-center gap-2">
          ${roleSelect}
          <button data-action="reset" data-email="${user.email}" class="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold text-[#293C74] hover:bg-slate-100">
            Reset contraseña
          </button>
        </div>
      </div>
    `;
    adminUsersList.appendChild(card);
  });
}

function initAdminInvite() {
  if (!adminInviteBtn || !adminInviteEmail || !adminInviteRole) return;
  if (!portalIsAdmin) return;

  if (!portalIsSuperadmin && adminInviteRole) {
    adminInviteRole.querySelector('option[value="admin"]')?.setAttribute('disabled', 'disabled');
    adminInviteRole.querySelector('option[value="superadmin"]')?.setAttribute('disabled', 'disabled');
  }

  adminInviteBtn.addEventListener('click', async () => {
    if (!adminInviteStatus) return;
    adminInviteStatus.textContent = 'Enviando...';
    try {
      const payload = {
        email: adminInviteEmail.value.trim(),
        fullName: adminInviteName?.value?.trim() || '',
        role: adminInviteRole.value,
        churchRole: adminInviteChurchRole?.value || '',
        church: adminInviteChurch?.value?.trim() || '',
      };
      const res = await fetch('/api/portal/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo invitar');
      adminInviteStatus.textContent = 'Invitación enviada.';
      adminInviteEmail.value = '';
      if (adminInviteName) adminInviteName.value = '';
      if (adminInviteChurch) adminInviteChurch.value = '';
      await loadAdminUsers(portalAuthHeaders);
    } catch (err) {
      console.error(err);
      adminInviteStatus.textContent = err.message || 'Error al invitar';
    }
  });
}

async function loadChurchDraft() {
  if (!churchForm) return;
  try {
    const res = await fetch('/api/portal/iglesia/draft', { headers: portalAuthHeaders });
    const payload = await res.json();
    if (!res.ok || !payload.ok || !payload.draft) return;
    const draft = payload.draft;
    document.getElementById('church-contact-name').value = draft.contactName || '';
    document.getElementById('church-contact-email').value = draft.email || '';
    document.getElementById('church-contact-phone').value = draft.phone || '';
    document.getElementById('church-document-type').value = draft.documentType || 'CC';
    document.getElementById('church-document-number').value = draft.documentNumber || '';
    document.getElementById('church-country-group').value = draft.countryGroup || 'CO';
    document.getElementById('church-country').value = draft.country || '';
    document.getElementById('church-city').value = draft.city || '';
    document.getElementById('church-name').value = draft.church || '';
    if (draft.churchId) {
      portalSelectedChurchId = draft.churchId;
      if (churchSelectorInput) {
        churchSelectorInput.value = draft.churchId;
      }
    }
    document.getElementById('church-payment-option').value = draft.paymentOption || 'FULL';
    document.getElementById('church-payment-amount').value = draft.paymentAmount || '';
    document.getElementById('church-payment-frequency').value = draft.frequency || 'MONTHLY';
    document.getElementById('church-payment-method').value = draft.paymentMethod || '';
    document.getElementById('church-notes').value = draft.notes || '';
    participantsList.innerHTML = '';
    (draft.participants || []).forEach((item) => {
      participantsList.appendChild(buildParticipantRow(item));
    });
    if (!participantsList.children.length) {
      participantsList.appendChild(buildParticipantRow());
    }
  } catch (err) {
    console.error(err);
  }
}

let draftTimer;
function scheduleDraftSave() {
  if (!churchForm || authMode === 'password') return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    saveChurchDraft();
  }, 900);
}

async function saveChurchDraft() {
  if (!churchForm) return;
  const payload = {
    contactName: document.getElementById('church-contact-name')?.value || '',
    email: document.getElementById('church-contact-email')?.value || '',
    phone: document.getElementById('church-contact-phone')?.value || '',
    documentType: document.getElementById('church-document-type')?.value || '',
    documentNumber: document.getElementById('church-document-number')?.value || '',
    countryGroup: document.getElementById('church-country-group')?.value || 'CO',
    country: document.getElementById('church-country')?.value || '',
    city: document.getElementById('church-city')?.value || '',
    church: document.getElementById('church-name')?.value || '',
    churchId: portalSelectedChurchId || '',
    paymentOption: document.getElementById('church-payment-option')?.value || 'FULL',
    paymentAmount: document.getElementById('church-payment-amount')?.value || '',
    frequency: document.getElementById('church-payment-frequency')?.value || 'MONTHLY',
    paymentMethod: document.getElementById('church-payment-method')?.value || '',
    notes: document.getElementById('church-notes')?.value || '',
    participants: collectParticipants(),
  };
  try {
    await fetch('/api/portal/iglesia/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(err);
  }
}

function initChurchManualForm() {
  if (!churchForm || !participantsList || !addParticipantBtn) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    if (churchFormStatus) {
      churchFormStatus.textContent = 'Selecciona una iglesia en el panel superior antes de registrar.';
    }
    churchForm.classList.add('hidden');
    if (churchFormToggle) {
      churchFormToggle.textContent = 'Abrir formulario';
    }
  }
  if (!participantsList.children.length) {
    participantsList.appendChild(buildParticipantRow());
  }

  addParticipantBtn.addEventListener('click', () => {
    participantsList.appendChild(buildParticipantRow());
    scheduleDraftSave();
  });

  churchForm.querySelectorAll('input, select, textarea').forEach((input) => {
    input.addEventListener('input', scheduleDraftSave);
  });

  churchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!churchFormStatus) return;
    if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
      churchFormStatus.textContent = 'Selecciona una iglesia en el panel superior.';
      return;
    }
    if (portalIsAdmin && portalIsCustomChurch && !churchNameInput?.value?.trim()) {
      churchFormStatus.textContent = 'Escribe el nombre de la iglesia.';
      return;
    }
    churchFormStatus.textContent = 'Guardando...';
    const payload = {
      contactName: document.getElementById('church-contact-name')?.value || '',
      email: document.getElementById('church-contact-email')?.value || '',
      phone: document.getElementById('church-contact-phone')?.value || '',
      documentType: document.getElementById('church-document-type')?.value || '',
      documentNumber: document.getElementById('church-document-number')?.value || '',
      countryGroup: document.getElementById('church-country-group')?.value || 'CO',
      country: document.getElementById('church-country')?.value || '',
      city: document.getElementById('church-city')?.value || '',
      church: document.getElementById('church-name')?.value || '',
      churchId: portalSelectedChurchId || '',
      paymentOption: document.getElementById('church-payment-option')?.value || 'FULL',
      paymentAmount: Number(document.getElementById('church-payment-amount')?.value || 0),
      frequency: document.getElementById('church-payment-frequency')?.value || 'MONTHLY',
      paymentMethod: document.getElementById('church-payment-method')?.value || '',
      notes: document.getElementById('church-notes')?.value || '',
      participants: collectParticipants(),
    };

    try {
      const res = await fetch('/api/portal/iglesia/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo guardar');
      churchFormStatus.textContent = 'Inscripción registrada.';
      await loadChurchBookings();
      await loadChurchPayments();
      churchForm.reset();
      participantsList.innerHTML = '';
      participantsList.appendChild(buildParticipantRow());
      await fetch('/api/portal/iglesia/draft', { method: 'DELETE', headers: portalAuthHeaders });
    } catch (error) {
      console.error(error);
      churchFormStatus.textContent = error.message || 'Error guardando';
    }
  });
}

function initInviteForm() {
  if (!inviteBtn || !inviteEmail || !inviteRole) return;
  inviteBtn.addEventListener('click', async () => {
    if (!inviteStatus) return;
    inviteStatus.textContent = 'Enviando invitación...';
    try {
      const payload = {
        email: inviteEmail.value.trim(),
        role: inviteRole.value,
        church: inviteChurchInput?.value?.trim() || '',
      };
      const res = await fetch('/api/portal/iglesia/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo invitar');
      inviteStatus.textContent = 'Invitación enviada.';
      inviteEmail.value = '';
    } catch (err) {
      console.error(err);
      inviteStatus.textContent = err.message || 'No se pudo invitar';
    }
  });
}

function renderBookings(bookings) {
  bookingsList.innerHTML = '';
  if (!bookings.length) {
    bookingsEmpty.classList.remove('hidden');
    return;
  }
  bookingsEmpty.classList.add('hidden');
  bookings.forEach((booking) => {
    const card = document.createElement('div');
    card.className = 'bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4 hover:bg-white/[0.07] transition-all group';
    const colorClass = booking.status === 'PAID' ? 'text-green-400' : 'text-brand-teal';
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <p class="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Reserva identificada</p>
          <h3 class="font-bold text-lg text-white">#${booking.id.slice(0, 8).toUpperCase()}</h3>
        </div>
        <span class="px-3 py-1 rounded-full bg-white/5 text-[10px] font-black uppercase tracking-widest border border-white/10 ${colorClass}">${booking.status}</span>
      </div>
      <div class="space-y-3 pt-2">
        <div class="flex justify-between text-xs">
          <span class="text-white/40">Progreso de abono</span>
          <span class="text-white/80">${Math.round((booking.total_paid / booking.total_amount) * 100)}%</span>
        </div>
        <div class="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div class="h-full bg-brand-teal transition-all duration-1000" style="width: ${(booking.total_paid / booking.total_amount) * 100}%"></div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
             <p class="text-[10px] text-white/30 uppercase tracking-widest mb-1">Aportado</p>
             <p class="text-sm font-bold">${formatCurrency(booking.total_paid, booking.currency)}</p>
          </div>
          <div class="text-right">
             <p class="text-[10px] text-white/30 uppercase tracking-widest mb-1">Monto Total</p>
             <p class="text-sm font-bold text-white/60">${formatCurrency(booking.total_amount, booking.currency)}</p>
          </div>
        </div>
      </div>
    `;
    bookingsList.appendChild(card);
  });
}

function renderPlans(plans, bookings) {
  plansList.innerHTML = '';
  if (!plans.length) {
    plansEmpty.classList.remove('hidden');
    return;
  }
  plansEmpty.classList.add('hidden');
  plans.forEach((plan) => {
    const booking = bookings.find((item) => item.id === plan.booking_id);
    const card = document.createElement('div');
    card.className = 'bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-5';
    const statusLabel = plan.status === 'PAUSED' ? 'Pausado' : plan.status === 'COMPLETED' ? 'Completado' : 'Activo';
    const actionLabel = plan.status === 'PAUSED' ? 'Reactivar abonos' : 'Pausar abonos';
    const actionClass = plan.status === 'PAUSED' ? 'bg-brand-teal text-white' : 'bg-white/5 text-white/60 hover:bg-white/10';

    card.innerHTML = `
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-3">
           <div class="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
           </div>
           <div>
             <p class="text-[10px] font-bold text-white/30 uppercase tracking-widest">Recurrencia</p>
             <p class="text-sm font-bold text-white">${plan.frequency === 'BIWEEKLY' ? 'Quincenal' : 'Mensual'}</p>
           </div>
        </div>
        <span class="text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/5 text-white/40 uppercase">${statusLabel}</span>
      </div>
      
      <div class="p-4 bg-white/[0.03] rounded-2xl border border-white/5 text-center">
         <p class="text-[10px] text-white/30 uppercase tracking-widest mb-1">Monto de la Cuota</p>
         <p class="text-2xl font-display font-bold text-white">${formatCurrency(plan.installment_amount, plan.currency)}</p>
      </div>

      <div class="flex items-center justify-between text-xs text-white/40 border-t border-white/5 pt-4">
         <span>Próximo abono: ${formatDate(plan.next_due_date)}</span>
         <button class="plan-action px-4 py-2 rounded-lg text-xs font-bold transition-all ${actionClass}" data-plan="${plan.id}" data-action="${plan.status === 'PAUSED' ? 'resume' : 'pause'}">
          ${actionLabel}
         </button>
      </div>
    `;
    plansList.appendChild(card);
  });
}

function renderInstallments(installments, plans, bookings) {
  if (!installmentsList || !installmentsEmpty) return;
  const pending = (installments || []).filter((item) => ['PENDING', 'FAILED'].includes(item.status));
  installmentsList.innerHTML = '';
  if (!pending.length) {
    installmentsEmpty.classList.remove('hidden');
    return;
  }
  installmentsEmpty.classList.add('hidden');
  pending.forEach((installment) => {
    const plan = plans.find((item) => item.id === installment.plan_id) || {};
    const booking = bookings.find((item) => item.id === installment.booking_id) || {};
    const statusLabel = installment.status === 'FAILED' ? 'Fallido' : 'Pendiente';
    const statusClass = installment.status === 'FAILED' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700';
    const installmentLabel = plan.installment_count
      ? `Cuota ${installment.installment_index}/${plan.installment_count}`
      : `Cuota ${installment.installment_index}`;
    const currency = plan.currency || installment.currency;
    const amountLabel = formatCurrency(installment.amount, currency);
    const dueLabel = formatDate(installment.due_date);

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between';
    card.innerHTML = `
      <div>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">${installmentLabel}</p>
        <p class="text-sm font-bold text-[#293C74]">${amountLabel}</p>
        <p class="text-xs text-slate-500">Vence: ${dueLabel}</p>
        <p class="text-[11px] text-slate-400 mt-1">${booking.contact_name || booking.contact_email || ''}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass}">${statusLabel}</span>
        <button class="installment-pay px-4 py-2 rounded-xl bg-[#293C74] text-white text-xs font-bold hover:shadow-md transition" data-installment="${installment.id}">
          Pagar ahora
        </button>
      </div>
    `;
    installmentsList.appendChild(card);
  });
}

function renderPayments(payments) {
  paymentsTable.innerHTML = '';
  if (!payments.length) {
    paymentsEmpty.classList.remove('hidden');
    return;
  }
  paymentsEmpty.classList.add('hidden');
  payments.forEach((payment) => {
    const row = document.createElement('tr');
    row.className = 'group hover:bg-white/[0.02] transition-colors';
    const statusClass = payment.status === 'APPROVED' ? 'bg-green-400/10 text-green-400' : 'bg-brand-gold/10 text-brand-gold';
    row.innerHTML = `
      <td class="py-6 px-8 text-white/80">${formatDate(payment.created_at)}</td>
      <td class="py-6 px-8 font-mono text-xs text-white/40">${payment.reference || '-'}</td>
      <td class="py-6 px-8 text-white/60">${payment.provider?.toUpperCase() || '-'} · Aporte</td>
      <td class="py-6 px-8 text-right font-bold text-white">${formatCurrency(payment.amount, payment.currency)}</td>
      <td class="py-6 px-8 text-center">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusClass}">
          ${payment.status || 'PENDING'}
        </span>
      </td>
    `;
    paymentsTable.appendChild(row);
  });
}

function toggleChurchField(value) {
  if (value === 'local') {
    profileChurchWrapper?.classList.remove('hidden');
  } else {
    profileChurchWrapper?.classList.add('hidden');
  }
}

function toggleOnboardingChurch(value) {
  if (value === 'local') {
    onboardChurchWrapper?.classList.remove('hidden');
  } else {
    onboardChurchWrapper?.classList.add('hidden');
  }
}

function showOnboarding() {
  if (!onboardingModal) return;
  onboardingModal.classList.remove('hidden');
  onboardingModal.classList.add('flex');

  if (portalProfile) {
    onboardName.value = portalProfile.full_name || profileName.value || '';
    onboardPhone.value = portalProfile.phone || '';
    onboardCity.value = portalProfile.city || '';
    onboardCountry.value = portalProfile.country || '';
    onboardAffiliation.value = portalProfile.affiliation_type || '';
    onboardChurchName.value = portalProfile.church_name || '';
    toggleOnboardingChurch(onboardAffiliation.value);
  }
}

function renderMemberships(memberships) {
  if (!churchMembershipsList || !churchMembershipsEmpty) return;
  churchMembershipsList.innerHTML = '';
  if (!memberships.length) {
    churchMembershipsEmpty.classList.remove('hidden');
    churchMembershipsList.classList.add('hidden');
    return;
  }
  churchMembershipsEmpty.classList.add('hidden');
  churchMembershipsList.classList.remove('hidden');
  memberships.forEach((membership) => {
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-100 bg-slate-50/80 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3';
    const statusLabel = membership.status === 'approved' ? 'Aprobado' : membership.status === 'rejected' ? 'Rechazado' : 'Pendiente';
    card.innerHTML = `
      <div>
        <p class="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Sede</p>
        <p class="text-lg font-bold text-[#293C74]">${membership.church?.name || 'Iglesia sin nombre'}</p>
        <p class="text-xs text-slate-500">${membership.church?.city || ''} ${membership.church?.country ? `· ${membership.church.country}` : ''}</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border border-slate-200 text-slate-500">${membership.role}</span>
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${membership.status === 'approved' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'}">${statusLabel}</span>
      </div>
    `;
    churchMembershipsList.appendChild(card);
  });
}

async function updateProfile() {
  profileStatus.textContent = 'Guardando...';
  profileStatus.className = 'text-sm font-medium text-white/40';
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch('/api/portal/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fullName: profileName.value.trim(),
        phone: profilePhone.value.trim(),
        city: profileCity.value.trim(),
        country: profileCountry.value.trim(),
        affiliationType: profileAffiliation.value,
        churchName: profileChurchName.value.trim(),
      }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo actualizar');

    profileStatus.textContent = '¡Cambios guardados con éxito!';
    profileStatus.className = 'text-sm font-medium text-green-400';
    welcomeName.textContent = profileName.value.trim().split(' ')[0];

    setTimeout(() => { profileStatus.textContent = ''; }, 3000);
  } catch (err) {
    console.error(err);
    profileStatus.textContent = err?.message || 'Error al actualizar el perfil.';
    profileStatus.className = 'text-sm font-medium text-red-400';
  }
}

async function handlePlanAction(event) {
  const target = event.target.closest('.plan-action');
  if (!target) return;
  const planId = target.dataset.plan;
  const action = target.dataset.action;
  const endpoint = action === 'resume' ? '/api/cuenta/planes/resume' : '/api/cuenta/planes/pause';

  const originalText = target.textContent;
  target.textContent = '...';
  target.disabled = true;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ planId }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo actualizar');
    await loadAccount();
  } catch (err) {
    console.error(err);
    alert('No pudimos actualizar tu plan. Intenta nuevamente.');
    target.textContent = originalText;
    target.disabled = false;
  }
}

async function handleInstallmentPay(event) {
  const target = event.target.closest('.installment-pay');
  if (!target) return;
  const installmentId = target.dataset.installment;
  if (!installmentId) return;

  const originalText = target.textContent;
  target.textContent = 'Generando...';
  target.disabled = true;

  try {
    const res = await fetch('/api/cuenta/installments/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      body: JSON.stringify({ installmentId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el link');
    if (data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
    target.textContent = 'Link generado';
  } catch (err) {
    console.error(err);
    target.textContent = originalText;
    alert(err.message || 'No se pudo generar el link.');
  } finally {
    setTimeout(() => {
      target.disabled = false;
      target.textContent = originalText;
    }, 2500);
  }
}

adminUsersList?.addEventListener('change', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.dataset.action !== 'role') return;
  const userId = target.dataset.user;
  const role = target.value;
  if (!userId) return;
  try {
    const res = await fetch('/api/portal/admin/role', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      body: JSON.stringify({ userId, role }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');
  } catch (err) {
    console.error(err);
    alert(err.message || 'No se pudo actualizar el rol.');
  }
});

adminUsersList?.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action="reset"]');
  if (!target) return;
  const email = target.dataset.email;
  if (!email) return;
  target.textContent = 'Enviando...';
  target.setAttribute('disabled', 'disabled');
  try {
    const res = await fetch('/api/portal/admin/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo enviar');
    target.textContent = 'Enviado';
  } catch (err) {
    console.error(err);
    target.textContent = 'Reset contraseña';
    target.removeAttribute('disabled');
    alert(err.message || 'No se pudo enviar.');
  }
});

churchInstallmentsList?.addEventListener('click', async (event) => {
  const target = event.target.closest('.church-installment-action');
  if (!target) return;
  const action = target.dataset.action;
  const installmentId = target.dataset.installment;
  if (!action || !installmentId) return;

  const original = target.textContent;
  target.textContent = '...';
  target.setAttribute('disabled', 'disabled');

  try {
    if (action === 'copy-link') {
      const res = await fetch('/api/portal/iglesia/installments/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ installmentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el link');
      if (data.url) {
        try {
          await navigator.clipboard.writeText(data.url);
        } catch (err) {
          window.prompt('Copia el link de pago:', data.url);
        }
      }
      target.textContent = 'Link copiado';
    } else if (action === 'send-reminder') {
      const res = await fetch('/api/portal/iglesia/installments/remind', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ installmentId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo enviar');
      target.textContent = 'Recordatorio enviado';
      await loadChurchInstallments(portalAuthHeaders);
    }
  } catch (err) {
    console.error(err);
    target.textContent = original;
    alert(err.message || 'No se pudo completar la acción.');
  } finally {
    setTimeout(() => {
      target.removeAttribute('disabled');
      target.textContent = original;
    }, 2500);
  }
});

churchSelectorInput?.addEventListener('change', async (event) => {
  const value = event.target.value || '';
  if (value === '__custom__') {
    portalIsCustomChurch = true;
    portalSelectedChurchId = null;
    if (churchSelectorStatus) {
      churchSelectorStatus.textContent = 'Modo manual activo. Escribe el nombre de la iglesia.';
    }
    if (churchNameInput) {
      churchNameInput.removeAttribute('readonly');
      churchNameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
      churchNameInput.focus();
    }
    return;
  }
  portalIsCustomChurch = false;
  await saveChurchSelection(value, portalAuthHeaders);
  await loadChurchBookings(portalAuthHeaders);
  await loadChurchPayments(portalAuthHeaders);
  await loadChurchInstallments(portalAuthHeaders);
  await loadChurchMembers(portalAuthHeaders);
});

churchBookingsSearch?.addEventListener('input', () => {
  renderChurchBookings(filterChurchBookings(churchBookingsData));
});
churchBookingsStatus?.addEventListener('change', () => {
  renderChurchBookings(filterChurchBookings(churchBookingsData));
});
churchPaymentsSearch?.addEventListener('input', () => {
  renderChurchPayments(filterChurchPayments(churchPaymentsData));
});
churchPaymentsStatus?.addEventListener('change', () => {
  renderChurchPayments(filterChurchPayments(churchPaymentsData));
});
churchPaymentsProvider?.addEventListener('change', () => {
  renderChurchPayments(filterChurchPayments(churchPaymentsData));
});
churchPaymentsFrom?.addEventListener('change', () => {
  renderChurchPayments(filterChurchPayments(churchPaymentsData));
});
churchPaymentsTo?.addEventListener('change', () => {
  renderChurchPayments(filterChurchPayments(churchPaymentsData));
});
churchInstallmentsSearch?.addEventListener('input', () => {
  renderChurchInstallments(filterChurchInstallments(churchInstallmentsData));
});
churchInstallmentsStatusFilter?.addEventListener('change', () => {
  renderChurchInstallments(filterChurchInstallments(churchInstallmentsData));
});
churchMembersSearch?.addEventListener('input', () => {
  renderChurchMembers(filterChurchMembers(churchMembersData));
});
churchMembersRole?.addEventListener('change', () => {
  renderChurchMembers(filterChurchMembers(churchMembersData));
});
churchExportBtn?.addEventListener('click', () => {
  void exportChurchBookings();
});


const churchFormContainer = document.getElementById('church-manual-form-container');
const churchFormCloseBtn = document.getElementById('church-form-close');
const inviteToggleBtn = document.getElementById('btn-toggle-invite');

churchFormToggle?.addEventListener('click', () => {
  if (!churchFormContainer) return;
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    if (churchFormStatus) {
      churchFormStatus.textContent = 'Selecciona una iglesia en el panel superior.';
    }
    return;
  }

  churchFormContainer.classList.remove('hidden');
  churchForm?.classList.remove('hidden');
  // Scroll to form
  churchFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

churchFormCloseBtn?.addEventListener('click', () => {
  if (!churchFormContainer) return;
  churchFormContainer.classList.add('hidden');
});

inviteToggleBtn?.addEventListener('click', () => {
  if (!inviteCard) return;
  const isHidden = inviteCard.classList.contains('hidden');
  if (isHidden) {
    inviteCard.classList.remove('hidden');
    inviteToggleBtn.textContent = 'Cerrar Gestión';
  } else {
    inviteCard.classList.add('hidden');
    inviteToggleBtn.textContent = 'Gestionar Equipo';
  }
});

installmentsList?.addEventListener('click', (event) => {
  void handleInstallmentPay(event);
});

logoutBtn?.addEventListener('click', async () => {
  logoutBtn.disabled = true;
  logoutBtn.textContent = 'Saliendo...';
  try {
    // Always clear any local Supabase session (even in password fallback).
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.warn('No se pudo cerrar sesión Supabase en el cliente.', err);
  }
  if (authMode === 'password') {
    await fetch('/api/portal/password-logout', { method: 'POST' });
  }
  window.location.href = '/portal/ingresar';
});

saveProfileBtn?.addEventListener('click', updateProfile);
profileAffiliation?.addEventListener('change', (event) => {
  toggleChurchField(event.target.value);
});
onboardAffiliation?.addEventListener('change', (event) => {
  toggleOnboardingChurch(event.target.value);
});
onboardingForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  onboardingStatus.textContent = 'Guardando...';
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch('/api/portal/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fullName: onboardName.value.trim(),
        phone: onboardPhone.value.trim(),
        city: onboardCity.value.trim(),
        country: onboardCountry.value.trim(),
        affiliationType: onboardAffiliation.value,
        churchName: onboardChurchName.value.trim(),
      }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar');

    portalProfile = payload.profile || portalProfile;
    profileName.value = portalProfile.full_name || profileName.value;
    profilePhone.value = portalProfile.phone || '';
    profileCity.value = portalProfile.city || '';
    profileCountry.value = portalProfile.country || '';
    profileAffiliation.value = portalProfile.affiliation_type || '';
    profileChurchName.value = portalProfile.church_name || '';
    toggleChurchField(profileAffiliation.value);

    onboardingModal.classList.add('hidden');
    onboardingModal.classList.remove('flex');
  } catch (err) {
    console.error(err);
    onboardingStatus.textContent = err?.message || 'No pudimos guardar tu perfil. Intenta de nuevo.';
  }
});
plansList?.addEventListener('click', handlePlanAction);


const updatePasswordBtn = document.getElementById('btn-update-password');
const newPasswordInput = document.getElementById('security-new-password');
const securityStatus = document.getElementById('security-status');

updatePasswordBtn?.addEventListener('click', async () => {
  if (!newPasswordInput || !securityStatus) return;
  const password = newPasswordInput.value.trim();
  if (password.length < 6) {
    securityStatus.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    securityStatus.className = 'text-sm font-medium text-red-500';
    return;
  }

  securityStatus.textContent = 'Actualizando contraseña...';
  securityStatus.className = 'text-sm font-medium text-slate-500';
  updatePasswordBtn.disabled = true;
  updatePasswordBtn.classList.add('opacity-50', 'cursor-not-allowed');
  const originalText = updatePasswordBtn.textContent;
  updatePasswordBtn.textContent = 'Guardando...';

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;

    securityStatus.textContent = '¡Contraseña actualizada correctamente!';
    securityStatus.className = 'text-sm font-medium text-green-500';
    newPasswordInput.value = '';
  } catch (err) {
    console.error(err);
    securityStatus.textContent = err.message || 'No se pudo actualizar la contraseña.';
    securityStatus.className = 'text-sm font-medium text-red-500';
  } finally {
    updatePasswordBtn.disabled = false;
    updatePasswordBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    updatePasswordBtn.textContent = originalText;
    setTimeout(() => {
      if (securityStatus.textContent.includes('correctamente')) {
        securityStatus.textContent = '';
      }
    }, 3000);
  }
});


const registerPasskeyBtn = document.getElementById('btn-register-passkey');
const passkeyStatus = document.getElementById('passkey-status');

registerPasskeyBtn?.addEventListener('click', async () => {
  if (!passkeyStatus) return;
  passkeyStatus.textContent = 'Iniciando registro de Passkey...';
  passkeyStatus.className = 'text-xs text-center mt-2 font-medium text-slate-500';
  registerPasskeyBtn.disabled = true;
  registerPasskeyBtn.classList.add('opacity-50');

  try {
    // 1. Initialize enrollment
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'webauthn',
    });

    if (error) throw error;

    // 2. Challenge and Verify (Triggers Browser Prompt)
    const { data: verifyData, error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: data.id,
    });

    if (verifyError) throw verifyError;

    passkeyStatus.textContent = '¡Dispositivo vinculado correctamente!';
    passkeyStatus.className = 'text-xs text-center mt-2 font-bold text-green-500';
    registerPasskeyBtn.innerHTML = `
       <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
       Vinculado
    `;

  } catch (err) {
    console.error(err);
    passkeyStatus.textContent = err.message || 'Error al vincular. Verifica que tu dispositivo soporte Passkeys.';
    passkeyStatus.className = 'text-xs text-center mt-2 font-medium text-red-500';
    registerPasskeyBtn.disabled = false;
    registerPasskeyBtn.classList.remove('opacity-50');
  }
});

// Init Dashboard with Reactive Auth
// Init Dashboard with Reactive Auth
function initDashboard() {
  let dashboardLoaded = false;

  // 0. Fix Malformed Hash (if present)
  // Supabase expects #access_token=... but sometimes we get #/access_token=...
  if (window.location.hash && window.location.hash.startsWith('#/')) {
    console.log('Fixing malformed hash:', window.location.hash);
    const cleanHash = window.location.hash.replace('#/', '#');
    window.history.replaceState(null, '', window.location.pathname + cleanHash);
    console.log('Cleaned hash:', window.location.hash);
  }

  // 1. Reactive Listener (Primary Driver for Async Events)
  if (!supabase) return;

  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      if (session && !dashboardLoaded) {
        console.log('Auth Event:', event);
        dashboardLoaded = true;

        cleanupAuthRedirect();

        await fetchDashboardData(session);
      }
    }
  });

  // 2. Immediate State Check (Handle Pre-processed Sessions)
  // Supabase might have already processed the hash before this script ran.
  // We check getSession() immediately.
  supabase.auth.getSession().then(({ data }) => {
    console.log('getSession result:', data); // DEBUG
    if (data?.session && !dashboardLoaded) {
      console.log('Session found immediately via getSession');
      dashboardLoaded = true;

      cleanupAuthRedirect();

      fetchDashboardData(data.session);
    } else if (!data?.session) {
      const authState = getAuthRedirectState();
      console.log('No session from getSession. Auth state:', authState); // DEBUG
      // No session found immediately.

      if (!authState.isAuthRedirect) {
        // No hash, no session -> Redirect after grace period
        setTimeout(() => {
          if (!dashboardLoaded) window.location.href = '/portal/ingresar';
        }, 2000);
      } else {
        // Auth redirect, show waiting feedback
        if (loadingEl) {
          const p = loadingEl.querySelector('p');
          if (p) {
            if (authState.hasError) {
              const description = authState.url.searchParams.get('error_description');
              p.textContent = description ? decodeURIComponent(description.replace(/\+/g, ' ')) : 'El enlace no es válido.';
            } else {
              p.textContent = 'Verificando enlace...';
            }
          }
        }

        if (authState.hasError) {
          setTimeout(() => window.location.href = '/portal/ingresar', 2500);
          return;
        }

        // Active Polling Fallback (in case listener misses)
        const pollInterval = setInterval(async () => {
          if (dashboardLoaded) {
            clearInterval(pollInterval);
            return;
          }
          console.log('Polling for session...');
          const { data: pollData } = await supabase.auth.getSession();
          if (pollData?.session) {
            console.log('Session found via Polling!');
            clearInterval(pollInterval);
            dashboardLoaded = true;
            if (window.location.hash && window.location.hash.includes('access_token')) {
              cleanupAuthRedirect();
            }
            fetchDashboardData(pollData.session);
          }
        }, 500);

        // Timeout Safety
        setTimeout(() => {
          clearInterval(pollInterval);
          if (!dashboardLoaded) {
            if (loadingEl) {
              const p = loadingEl.querySelector('p');
              if (p) {
                p.textContent = 'El enlace no es válido o expiró. Redirigiendo...';
              }
            }
            setTimeout(() => window.location.href = '/portal/ingresar', 2000);
          }
        }, 12000);
      }
    }
  });
}

initDashboard();
initChurchManualForm();
initInviteForm();
