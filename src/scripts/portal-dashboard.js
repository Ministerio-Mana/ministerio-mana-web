import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';
import { compareSpanishLabels, normalizeChurchContinent, normalizeChurchCountry } from '@lib/churchGeo';

const DEBUG = import.meta.env?.DEV === true;
const dlog = (...args) => { if (DEBUG) console.log(...args); };
const dwarn = (...args) => { if (DEBUG) console.warn(...args); };

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const escapeAttr = (value) => escapeHtml(value).replace(/`/g, '&#96;');

const safeText = (value, fallback = '') => escapeHtml(value ?? fallback);
const safeAttr = (value, fallback = '') => escapeAttr(value ?? fallback);

function animateIn(element, { x = 0, y = 0, duration = 300 } = {}) {
  if (!element?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  element.animate([
    { opacity: 0, transform: `translate(${x}px, ${y}px)` },
    { opacity: 1, transform: 'translate(0, 0)' },
  ], {
    duration,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  });
}

function isApprovedChurchMembershipStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'approved' || normalized === 'active';
}

async function clearStaleServiceWorkersOnce() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (sessionStorage.getItem('portal_sw_cleared') === '1') return false;

  const registrations = await navigator.serviceWorker.getRegistrations();
  if (!registrations.length) return false;

  sessionStorage.setItem('portal_sw_cleared', '1');
  await Promise.all(registrations.map((reg) => reg.unregister()));

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  return true;
}

const loadingEl = document.getElementById('account-loading');
dlog('Portal Script Started. Loading El:', loadingEl);
const errorEl = document.getElementById('account-error');
const contentEl = document.getElementById('account-content');
const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');
const profileRole = document.getElementById('profile-role');
const profilePhone = document.getElementById('profile-phone');
const profileCity = document.getElementById('profile-city');
const profileCountry = document.getElementById('profile-country');
const profileDocumentType = document.getElementById('profile-document-type');
const profileDocumentNumber = document.getElementById('profile-document-number');
const profileAffiliation = document.getElementById('profile-affiliation');
const profileChurchWrapper = document.getElementById('profile-church-wrapper');
const profileChurchName = document.getElementById('profile-church-name');
const profileStatus = document.getElementById('profile-status');
const deleteAccountCard = document.getElementById('delete-account-card');
const deleteAccountReasonInput = document.getElementById('delete-account-reason');
const deleteAccountConfirmInput = document.getElementById('delete-account-confirm');
const deleteAccountBtn = document.getElementById('btn-delete-account');
const deleteAccountStatus = document.getElementById('delete-account-status');
const welcomeName = document.getElementById('welcome-name');

// Stats
const statTotalPaid = document.getElementById('stat-total-paid');
const statNextDue = document.getElementById('stat-next-due');
const statNextNote = document.getElementById('stat-next-note');
const planHighlight = document.getElementById('plan-highlight');
const highlightAmount = document.getElementById('highlight-amount');
const highlightDate = document.getElementById('highlight-date');
const summaryEventsList = document.getElementById('summary-events-list');
const summaryEventsEmpty = document.getElementById('summary-events-empty');
const givingList = document.getElementById('giving-list');
const givingEmpty = document.getElementById('giving-empty');
const givingCta = document.getElementById('giving-cta');
const campusGivingList = document.getElementById('campus-list');
const campusGivingEmpty = document.getElementById('campus-empty');
const campusGivingCta = document.getElementById('campus-cta');
const localEventsList = document.getElementById('local-events-list');
const localEventsEmpty = document.getElementById('local-events-empty');

const generateIdempotencyKey = () => {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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
let churchFormIdempotencyKey = null;
let churchFormSignature = null;
const churchBookingsEmpty = document.getElementById('church-bookings-empty');
const churchBookingsList = document.getElementById('church-bookings-list');
const churchBookingsSearch = document.getElementById('church-bookings-search');
const churchBookingsStatus = document.getElementById('church-bookings-status');
const churchBookingsSort = document.getElementById('church-bookings-sort');
const churchBookingsPageSize = document.getElementById('church-bookings-page-size');
const churchBookingsCount = document.getElementById('church-bookings-count');
const churchBookingsPagination = document.getElementById('church-bookings-pagination');
const churchParticipantsSearch = document.getElementById('church-participants-search');
const churchParticipantsViewToggle = document.getElementById('church-participants-view-toggle');
const churchParticipantsSort = document.getElementById('church-participants-sort');
const churchParticipantsPayment = document.getElementById('church-participants-payment');
const churchParticipantsLodging = document.getElementById('church-participants-lodging');
const churchParticipantsMenu = document.getElementById('church-participants-menu');
const churchParticipantsAlert = document.getElementById('church-participants-alert');
const churchParticipantsPageSize = document.getElementById('church-participants-page-size');
const churchParticipantsResultCount = document.getElementById('church-participants-count');
const churchParticipantsEmpty = document.getElementById('church-participants-empty');
const churchParticipantsTableWrap = document.getElementById('church-participants-table-wrap');
const churchParticipantsTable = document.getElementById('church-participants-table');
const churchParticipantsPagination = document.getElementById('church-participants-pagination');
const churchPaymentsEmpty = document.getElementById('church-payments-empty');
const churchPaymentsList = document.getElementById('church-payments-list');
const churchPaymentsSearch = document.getElementById('church-payments-search');
const churchPaymentsStatus = document.getElementById('church-payments-status');
const churchPaymentsProvider = document.getElementById('church-payments-provider');
const churchPaymentsFrom = document.getElementById('church-payments-from');
const churchPaymentsTo = document.getElementById('church-payments-to');
const churchPaymentsSort = document.getElementById('church-payments-sort');
const churchPaymentsPageSize = document.getElementById('church-payments-page-size');
const churchPaymentsCount = document.getElementById('church-payments-count');
const churchPaymentsPagination = document.getElementById('church-payments-pagination');
const churchExportBtn = document.getElementById('church-export-btn');
const churchAuditBtn = document.getElementById('church-audit-btn');
const churchExportStatus = document.getElementById('church-export-status');
const churchInstallmentsEmpty = document.getElementById('church-installments-empty');
const churchInstallmentsList = document.getElementById('church-installments-list');
const churchInstallmentsSearch = document.getElementById('church-installments-search');
const churchInstallmentsStatusFilter = document.getElementById('church-installments-status');
const churchInstallmentsChargeFilter = document.getElementById('church-installments-charge');
const churchInstallmentsPageSize = document.getElementById('church-installments-page-size');
const churchInstallmentsCount = document.getElementById('church-installments-count');
const churchInstallmentsPagination = document.getElementById('church-installments-pagination');
const churchInstallmentsStatusMsg = document.getElementById('church-installments-status-msg');
const churchInstallmentsRemindVisibleBtn = document.getElementById('church-installments-remind-visible');
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
const eventOperationsControls = document.getElementById('event-operations-controls');
const eventOperationsSelector = document.getElementById('event-operations-selector');
const eventOperationsConfigure = document.getElementById('event-operations-configure');
const eventOperationState = document.getElementById('event-operation-state');
const eventOperationDate = document.getElementById('event-operation-date');
const eventOperationScope = document.getElementById('event-operation-scope');
const eventOperationLocation = document.getElementById('event-operation-location');
const eventOperationEconomy = document.getElementById('event-operation-economy');
const eventClosedBanner = document.getElementById('event-closed-banner');
const eventPublicPageLink = document.getElementById('event-public-page-link');
const eventGenericDashboard = document.getElementById('event-generic-dashboard');
const eventGenericPublicLink = document.getElementById('event-generic-public-link');
const eventGenericConfigure = document.getElementById('event-generic-configure');
const eventGenericHeading = document.getElementById('event-generic-heading');
const eventGenericDescription = document.getElementById('event-generic-description');
const eventGenericRegistration = document.getElementById('event-generic-registration');
const eventGenericPrice = document.getElementById('event-generic-price');
const eventGenericPayment = document.getElementById('event-generic-payment');
const churchDashboardManagement = document.getElementById('church-dashboard-management');
const eventPersonalDashboard = document.getElementById('church-dashboard-user');
const eventPaymentApproved = document.getElementById('event-payment-approved');
const eventPaymentPending = document.getElementById('event-payment-pending');
const eventPaymentManual = document.getElementById('event-payment-manual');
const churchMembersEmpty = document.getElementById('church-members-empty');
const churchMembersList = document.getElementById('church-members-list');
const churchMembersSearch = document.getElementById('church-members-search');
const churchMembersRole = document.getElementById('church-members-role');
const churchSelector = document.getElementById('church-selector');
const churchSelectorContinent = document.getElementById('church-selector-continent');
const churchSelectorCountry = document.getElementById('church-selector-country');
const churchSelectorSearch = document.getElementById('church-selector-search');
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
const adminFollowupsCard = document.getElementById('admin-followups-card');
const adminFollowupsCount = document.getElementById('admin-followups-count');
const adminFollowupsStatus = document.getElementById('admin-followups-status');
const adminFollowupsEmpty = document.getElementById('admin-followups-empty');
const adminFollowupsList = document.getElementById('admin-followups-list');
const adminFollowupsFilters = document.getElementById('admin-followups-filters');
const adminFollowupsSearch = document.getElementById('admin-followups-search');
const adminFollowupsSort = document.getElementById('admin-followups-sort');
const adminFollowupsPageSize = document.getElementById('admin-followups-page-size');
const adminFollowupsVisibleCount = document.getElementById('admin-followups-visible-count');
const adminFollowupsPagination = document.getElementById('admin-followups-pagination');

// UI Helpers
const navLinks = document.querySelectorAll('.nav-link');
const tabContents = document.querySelectorAll('.tab-content');
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
const portalAlertModal = document.getElementById('portal-alert-modal');
const portalAlertTitle = document.getElementById('portal-alert-title');
const portalAlertMessage = document.getElementById('portal-alert-message');
const portalAlertClose = document.getElementById('portal-alert-close');
const portalAlertOk = document.getElementById('portal-alert-ok');
const portalConfirmModal = document.getElementById('portal-confirm-modal');
const portalConfirmTitle = document.getElementById('portal-confirm-title');
const portalConfirmMessage = document.getElementById('portal-confirm-message');
const portalConfirmClose = document.getElementById('portal-confirm-close');
const portalConfirmCancel = document.getElementById('portal-confirm-cancel');
const portalConfirmOk = document.getElementById('portal-confirm-ok');
const bookingInspectorModal = document.getElementById('booking-inspector-modal');
const bookingInspectorTitle = document.getElementById('booking-inspector-title');
const bookingInspectorSubtitle = document.getElementById('booking-inspector-subtitle');
const bookingInspectorClose = document.getElementById('booking-inspector-close');
const bookingInspectorSearch = document.getElementById('booking-inspector-search');
const bookingInspectorBody = document.getElementById('booking-inspector-body');
let portalConfirmResolver = null;
let bookingInspectorPayload = null;
let bookingInspectorQuery = '';
const portalModalReturnFocus = new WeakMap();
const portalModals = [onboardingModal, portalAlertModal, portalConfirmModal, bookingInspectorModal].filter(Boolean);

function getPortalModalFocusables(modal) {
  if (!modal) return [];
  return Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.closest('[hidden]') && element.getClientRects().length > 0);
}

function openPortalModal(modal, preferredFocus) {
  if (!modal) return;
  if (document.activeElement instanceof HTMLElement) {
    portalModalReturnFocus.set(modal, document.activeElement);
  }
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  window.requestAnimationFrame(() => {
    const target = preferredFocus || getPortalModalFocusables(modal)[0] || modal.querySelector('[tabindex="-1"]');
    target?.focus();
  });
}

function closePortalModal(modal) {
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  const returnFocus = portalModalReturnFocus.get(modal);
  portalModalReturnFocus.delete(modal);
  returnFocus?.focus();
}

function getOpenPortalModal() {
  return [...portalModals].reverse().find((modal) => modal.getAttribute('aria-hidden') === 'false') || null;
}

function hidePortalAlert() {
  closePortalModal(portalAlertModal);
}

function showPortalAlert(message, options = {}) {
  if (!portalAlertModal || !portalAlertMessage || !portalAlertTitle) {
    window.alert(message);
    return;
  }
  portalAlertMessage.textContent = message;
  portalAlertTitle.textContent = options.title || 'Atención';
  openPortalModal(portalAlertModal, portalAlertOk);
}

portalAlertClose?.addEventListener('click', hidePortalAlert);
portalAlertOk?.addEventListener('click', hidePortalAlert);
portalAlertModal?.addEventListener('click', (event) => {
  if (event.target === portalAlertModal) hidePortalAlert();
});

function hidePortalConfirm(result = false) {
  closePortalModal(portalConfirmModal);
  if (portalConfirmResolver) {
    portalConfirmResolver(result);
    portalConfirmResolver = null;
  }
}

function showPortalConfirm(message, options = {}) {
  if (!portalConfirmModal || !portalConfirmMessage || !portalConfirmTitle || !portalConfirmOk) {
    return Promise.resolve(window.confirm(message));
  }
  portalConfirmMessage.textContent = message;
  portalConfirmTitle.textContent = options.title || 'Confirmar';
  portalConfirmOk.textContent = options.confirmLabel || 'Confirmar';
  if (options.tone === 'primary') {
    portalConfirmOk.classList.remove('bg-[#E15554]', 'hover:bg-[#D94B4A]');
    portalConfirmOk.classList.add('bg-brand-teal', 'hover:bg-brand-teal/90');
  } else {
    portalConfirmOk.classList.remove('bg-brand-teal', 'hover:bg-brand-teal/90');
    portalConfirmOk.classList.add('bg-[#E15554]', 'hover:bg-[#D94B4A]');
  }
  openPortalModal(portalConfirmModal, portalConfirmCancel || portalConfirmOk);
  return new Promise((resolve) => {
    portalConfirmResolver = resolve;
  });
}

portalConfirmClose?.addEventListener('click', () => hidePortalConfirm(false));
portalConfirmCancel?.addEventListener('click', () => hidePortalConfirm(false));
portalConfirmOk?.addEventListener('click', () => hidePortalConfirm(true));
portalConfirmModal?.addEventListener('click', (event) => {
  if (event.target === portalConfirmModal) hidePortalConfirm(false);
});

function hideBookingInspector() {
  closePortalModal(bookingInspectorModal);
}

function showBookingInspectorLoading(bookingId) {
  if (!bookingInspectorModal || !bookingInspectorBody) return;
  bookingInspectorPayload = null;
  bookingInspectorQuery = '';
  if (bookingInspectorSearch) bookingInspectorSearch.value = '';
  if (bookingInspectorTitle) bookingInspectorTitle.textContent = `Detalle de reserva #${String(bookingId || '').slice(0, 8).toUpperCase()}`;
  if (bookingInspectorSubtitle) bookingInspectorSubtitle.textContent = 'Cargando información...';
  bookingInspectorBody.innerHTML = `
    <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-slate-500 text-sm">
      Cargando detalle de reserva...
    </div>
  `;
  openPortalModal(bookingInspectorModal, bookingInspectorClose);
}

function resolveBookingTypeLabel(booking, plan) {
  const source = String(booking?.source || '').toLowerCase();
  const method = String(booking?.payment_method || '').toLowerCase();
  const provider = String(plan?.provider || '').toLowerCase();
  const isManual = source === 'portal-iglesia'
    || source === 'cumbre-manual'
    || method === 'manual'
    || method === 'cash'
    || provider === 'manual'
    || provider === 'cash'
    || provider === 'physical';
  return isManual ? 'Manual / Físico' : 'Online';
}

function resolveChargeFlowLabel(plan) {
  const provider = String(plan?.provider || '').toLowerCase();
  if (!provider) return 'Sin plan';
  if (provider === 'wompi') {
    return plan?.provider_payment_method_id ? 'Wompi automático' : 'Wompi manual';
  }
  if (provider === 'stripe') {
    return plan?.provider_subscription_id ? 'Stripe automático' : 'Stripe manual';
  }
  if (provider === 'manual' || provider === 'cash' || provider === 'physical') {
    return 'Manual / efectivo';
  }
  return provider.toUpperCase();
}

function formatCompactDateTime(value) {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildStatusPill(status, kind = 'generic') {
  const value = String(status || '').toUpperCase();
  const genericMap = {
    PAID: 'bg-emerald-100 text-emerald-700',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    DEPOSIT_OK: 'bg-emerald-100 text-emerald-700',
    PENDING: 'bg-amber-100 text-amber-700',
    FAILED: 'bg-rose-100 text-rose-700',
    DECLINED: 'bg-rose-100 text-rose-700',
    CANCELLED: 'bg-slate-100 text-slate-700',
  };
  const installmentMap = {
    ...genericMap,
    OVERDUE: 'bg-rose-100 text-rose-700',
  };
  const classes = (kind === 'installment' ? installmentMap : genericMap)[value] || 'bg-slate-100 text-slate-700';
  return `<span class="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest ${classes}">${safeText(value || 'N/A')}</span>`;
}

function matchesInspectorQuery(values = [], query = '') {
  if (!query) return true;
  const searchable = values
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
  return searchable.includes(query);
}

function renderBookingInspector() {
  if (!bookingInspectorBody) return;
  const payload = bookingInspectorPayload;
  if (!payload?.booking) {
    bookingInspectorBody.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-slate-500 text-sm">
        No hay datos para esta reserva.
      </div>
    `;
    return;
  }

  const booking = payload.booking || {};
  const plan = payload.plan || null;
  const participants = Array.isArray(payload.participants) ? payload.participants : [];
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const installments = Array.isArray(payload.installments) ? payload.installments : [];
  const summary = payload.payment_summary || {};
  const query = (bookingInspectorQuery || '').trim().toLowerCase();

  const filteredParticipants = participants.filter((item) => matchesInspectorQuery([
    item.full_name,
    item.email,
    item.document_type,
    item.document_number,
    item.relationship,
    item.package_type,
    item.diet_type,
  ], query));

  const filteredPayments = payments.filter((item) => matchesInspectorQuery([
    item.reference,
    item.provider,
    item.status,
    item.provider_tx_id,
    item.amount,
    item.currency,
    item.installment_id,
  ], query));

  const pendingInstallments = installments
    .filter((item) => ['PENDING', 'FAILED'].includes(String(item.status || '').toUpperCase()))
    .sort((a, b) => {
      const aDate = toDate(a.due_date)?.getTime() || Number.POSITIVE_INFINITY;
      const bDate = toDate(b.due_date)?.getTime() || Number.POSITIVE_INFINITY;
      return aDate - bDate;
    });
  const nextInstallment = pendingInstallments[0] || null;
  const approvedPayments = payments.filter((item) => String(item.status || '').toUpperCase() === 'APPROVED');
  const lastApproved = approvedPayments[0] || null;
  const bookingType = resolveBookingTypeLabel(booking, plan);
  const chargeFlow = resolveChargeFlowLabel(plan);
  const bookingRef = String(booking.id || '').slice(0, 8).toUpperCase();
  const reservationType = participants.length > 1 ? 'Grupo' : 'Individual';
  const churchLabel = booking.contact_church || 'Sin iglesia / virtual';
  const totalAmount = Number(summary.total_amount ?? booking.total_amount ?? 0);
  const totalPaid = Number(summary.total_paid ?? booking.total_paid ?? 0);
  const remaining = Math.max(0, Number(summary.remaining_amount ?? (totalAmount - totalPaid)));

  if (bookingInspectorTitle) bookingInspectorTitle.textContent = `Detalle de reserva #${bookingRef}`;
  if (bookingInspectorSubtitle) {
    bookingInspectorSubtitle.textContent = `${safeText(booking.contact_name || booking.contact_email || 'Sin titular')} · ${safeText(churchLabel)}`;
  }

  const participantsRows = filteredParticipants.length
    ? filteredParticipants.map((participant) => `
        <tr class="border-b border-slate-100 last:border-b-0">
          <td class="py-2 pr-3 text-sm font-semibold text-[#293C74]">${safeText(participant.full_name || '-')}</td>
          <td class="py-2 pr-3 text-xs text-slate-600">${safeText(participant.relationship || '-')}</td>
          <td class="py-2 pr-3 text-xs text-slate-600">${safeText(participant.email || booking.contact_email || '-')}</td>
          <td class="py-2 pr-3 text-xs text-slate-500">${safeText([participant.document_type, participant.document_number].filter(Boolean).join(' ') || '-')}</td>
          <td class="py-2 text-xs text-slate-500">${safeText(participant.package_type || '-')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" class="py-3 text-xs text-slate-500">No hay participantes para el filtro actual.</td></tr>`;

  const paymentsRows = filteredPayments.length
    ? filteredPayments.map((payment) => `
        <tr class="border-b border-slate-100 last:border-b-0">
          <td class="py-2 pr-3 text-xs text-slate-500">${safeText(formatCompactDateTime(payment.created_at))}</td>
          <td class="py-2 pr-3 text-xs text-slate-600">${safeText(payment.provider || '-')}</td>
          <td class="py-2 pr-3 text-xs font-semibold text-[#293C74]">${safeText(formatCurrency(payment.amount, payment.currency || booking.currency))}</td>
          <td class="py-2 pr-3">${buildStatusPill(payment.status, 'payment')}</td>
          <td class="py-2 text-xs text-slate-500">${safeText(payment.reference || '-')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" class="py-3 text-xs text-slate-500">No hay pagos para el filtro actual.</td></tr>`;

  const installmentsRows = installments.length
    ? installments.map((installment) => `
        <tr class="border-b border-slate-100 last:border-b-0">
          <td class="py-2 pr-3 text-xs font-semibold text-[#293C74]">Cuota ${safeText(installment.installment_index ?? '-')}</td>
          <td class="py-2 pr-3 text-xs text-slate-500">${safeText(formatDate(installment.due_date))}</td>
          <td class="py-2 pr-3 text-xs font-semibold text-[#293C74]">${safeText(formatCurrency(installment.amount, installment.currency || booking.currency))}</td>
          <td class="py-2">${buildStatusPill(installment.status, 'installment')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" class="py-3 text-xs text-slate-500">No hay cuotas registradas.</td></tr>`;

  bookingInspectorBody.innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <section class="xl:col-span-8 space-y-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <article class="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo booking</p>
            <p class="text-sm font-bold text-[#293C74] mt-1">${safeText(bookingType)}</p>
          </article>
          <article class="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Flujo de cobro</p>
            <p class="text-sm font-bold text-[#293C74] mt-1">${safeText(chargeFlow)}</p>
          </article>
          <article class="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo reserva</p>
            <p class="text-sm font-bold text-[#293C74] mt-1">${safeText(reservationType)} (${participants.length})</p>
          </article>
          <article class="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado</p>
            <div class="mt-1">${buildStatusPill(booking.status)}</div>
          </article>
        </div>

        <article class="rounded-2xl border border-slate-100 bg-white p-4">
          <h4 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Datos de reserva</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Titular:</span> ${safeText(booking.contact_name || '-')}</p>
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Correo:</span> ${safeText(booking.contact_email || '-')}</p>
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Teléfono:</span> ${safeText(booking.contact_phone || '-')}</p>
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Documento:</span> ${safeText([booking.contact_document_type, booking.contact_document_number].filter(Boolean).join(' ') || '-')}</p>
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Iglesia:</span> ${safeText(churchLabel)}</p>
            <p class="text-slate-600"><span class="font-semibold text-[#293C74]">Ciudad / País:</span> ${safeText([booking.contact_city, booking.contact_country].filter(Boolean).join(' · ') || '-')}</p>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-100 bg-white p-4">
          <h4 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Participantes (${filteredParticipants.length}/${participants.length})</h4>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[720px]">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Nombre</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Relación</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Email</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Documento</th>
                  <th class="py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Alojamiento</th>
                </tr>
              </thead>
              <tbody>${participantsRows}</tbody>
            </table>
          </div>
        </article>
      </section>

      <aside class="xl:col-span-4 space-y-6">
        <article class="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
          <h4 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Resumen financiero</h4>
          <div class="space-y-2 text-sm">
            <p class="flex items-center justify-between text-slate-600"><span>Total</span><span class="font-bold text-[#293C74]">${safeText(formatCurrency(totalAmount, booking.currency))}</span></p>
            <p class="flex items-center justify-between text-slate-600"><span>Pagado</span><span class="font-bold text-emerald-600">${safeText(formatCurrency(totalPaid, booking.currency))}</span></p>
            <p class="flex items-center justify-between text-slate-600"><span>Pendiente</span><span class="font-bold text-amber-600">${safeText(formatCurrency(remaining, booking.currency))}</span></p>
            <p class="flex items-center justify-between text-slate-600"><span>Último pago</span><span>${safeText(lastApproved ? formatCompactDateTime(lastApproved.created_at) : '—')}</span></p>
            <p class="flex items-center justify-between text-slate-600"><span>Próxima cuota</span><span>${safeText(nextInstallment ? formatDate(nextInstallment.due_date) : '—')}</span></p>
            <p class="flex items-center justify-between text-slate-600"><span>Cuotas pendientes</span><span>${safeText(pendingInstallments.length)}</span></p>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-100 bg-white p-4">
          <h4 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Pagos (${filteredPayments.length}/${payments.length})</h4>
          <div class="overflow-x-auto max-h-[250px]">
            <table class="w-full min-w-[640px]">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Fecha</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Proveedor</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Monto</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado</th>
                  <th class="py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Referencia</th>
                </tr>
              </thead>
              <tbody>${paymentsRows}</tbody>
            </table>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-100 bg-white p-4">
          <h4 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Plan de cuotas (${installments.length})</h4>
          <div class="overflow-x-auto max-h-[250px]">
            <table class="w-full min-w-[480px]">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Cuota</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Fecha</th>
                  <th class="py-2 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Monto</th>
                  <th class="py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Estado</th>
                </tr>
              </thead>
              <tbody>${installmentsRows}</tbody>
            </table>
          </div>
        </article>
      </aside>
    </div>
  `;
}

async function openBookingInspectorModal(bookingId) {
  if (!bookingInspectorModal) return;
  showBookingInspectorLoading(bookingId);
  try {
    const headers = typeof window.getPortalAuthHeaders === 'function'
      ? await window.getPortalAuthHeaders()
      : portalAuthHeaders;
    const res = await fetch(`/api/portal/iglesia/booking?bookingId=${encodeURIComponent(bookingId)}`, {
      headers,
      credentials: 'include',
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error || 'No se pudo cargar la reserva.');
    }
    bookingInspectorPayload = payload;
    bookingInspectorQuery = '';
    if (bookingInspectorSearch) bookingInspectorSearch.value = '';
    renderBookingInspector();
  } catch (err) {
    console.error(err);
    if (bookingInspectorBody) {
      bookingInspectorBody.innerHTML = `
        <div class="rounded-2xl border border-dashed border-rose-200 bg-rose-50/70 p-8 text-center text-rose-700 text-sm">
          ${safeText(err?.message || 'No se pudo cargar el detalle de la reserva.')}
        </div>
      `;
    }
    if (bookingInspectorSubtitle) {
      bookingInspectorSubtitle.textContent = 'Error cargando detalle';
    }
  }
}

bookingInspectorClose?.addEventListener('click', hideBookingInspector);
bookingInspectorModal?.addEventListener('click', (event) => {
  if (event.target === bookingInspectorModal) hideBookingInspector();
});
bookingInspectorSearch?.addEventListener('input', () => {
  bookingInspectorQuery = bookingInspectorSearch.value || '';
  renderBookingInspector();
});
document.addEventListener('keydown', (event) => {
  const modal = getOpenPortalModal();
  if (!modal) return;

  if (event.key === 'Escape') {
    if (modal === onboardingModal) return;
    event.preventDefault();
    if (modal === portalConfirmModal) hidePortalConfirm(false);
    else if (modal === portalAlertModal) hidePortalAlert();
    else if (modal === bookingInspectorModal) hideBookingInspector();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusables = getPortalModalFocusables(modal);
  if (!focusables.length) {
    event.preventDefault();
    modal.querySelector('[tabindex="-1"]')?.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function setDeleteAccountState(message = '', tone = 'neutral') {
  if (!deleteAccountStatus) return;
  deleteAccountStatus.textContent = message;
  deleteAccountStatus.classList.remove('text-slate-500', 'text-red-600', 'text-green-600');
  if (tone === 'error') {
    deleteAccountStatus.classList.add('text-red-600');
    return;
  }
  if (tone === 'success') {
    deleteAccountStatus.classList.add('text-green-600');
    return;
  }
  deleteAccountStatus.classList.add('text-slate-500');
}

function syncDeleteAccountAccess() {
  const role = String(portalProfile?.role || '').toLowerCase();
  const isPasswordMode = authMode === 'password';
  const isAdminRole = ['admin', 'superadmin'].includes(role);

  if (deleteAccountCard) {
    deleteAccountCard.classList.toggle('hidden', isPasswordMode);
  }

  if (!deleteAccountBtn || !deleteAccountConfirmInput || !deleteAccountReasonInput) return;

  if (isPasswordMode) {
    deleteAccountBtn.disabled = true;
    deleteAccountBtn.classList.add('opacity-50', 'cursor-not-allowed');
    deleteAccountConfirmInput.disabled = true;
    deleteAccountReasonInput.disabled = true;
    setDeleteAccountState('No disponible en modo de sesión operativa.', 'neutral');
    return;
  }

  if (isAdminRole) {
    deleteAccountBtn.disabled = true;
    deleteAccountBtn.classList.add('opacity-50', 'cursor-not-allowed');
    deleteAccountConfirmInput.disabled = true;
    deleteAccountReasonInput.disabled = true;
    setDeleteAccountState('Las cuentas administrativas se gestionan por soporte interno.', 'neutral');
    return;
  }

  deleteAccountBtn.disabled = false;
  deleteAccountBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  deleteAccountConfirmInput.disabled = false;
  deleteAccountReasonInput.disabled = false;
  setDeleteAccountState('', 'neutral');
}

let supabaseClientPromise = null;
async function getSupabaseClientForAction() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import('@lib/supabaseBrowser')
      .then(({ getSupabaseBrowserClient }) => getSupabaseBrowserClient())
      .catch((err) => {
        supabaseClientPromise = null;
        throw err;
      });
  }
  return supabaseClientPromise;
}

let portalProfile = null;
let portalAccountPayload = null;
let portalMemberships = [];
let portalPermissions = {};
let authMode = 'supabase';
let churchParticipantsCount = 0;
let portalAuthHeaders = {};
let portalIsAdmin = false;
let portalIsSuperadmin = false;
let portalIsCountryPastor = false;
let portalRole = 'user';
let portalCanManageEvents = false;
let portalCanViewEventOperations = false;
let portalHasChurchAccess = false;
let portalScope = 'church';
let portalCanSelectChurch = false;
let portalAllowAllChurches = false;
let portalAllowCustomChurch = false;
let portalSelectedChurchId = null;
let portalChurchesCatalog = [];
let portalIsCustomChurch = false;
let selectorContinentFilter = '';
let selectorCountryFilter = '';
let selectorSearchFilter = '';
let churchBookingsData = [];
let churchBookingsPage = 1;
let churchParticipantsData = [];
let churchParticipantsPage = 1;
let churchParticipantsViewMode = 'cards';
let churchMembersData = [];
let churchPaymentsData = [];
let churchPaymentsPage = 1;
let churchInstallmentsData = [];
let churchInstallmentsPage = 1;
let adminIssuesData = [];
let adminIssuesFilter = 'all';
let adminIssuesCounts = {};
let adminIssuesPage = 1;
let churchManualFormInitialized = false;
let inviteFormInitialized = false;
let eventOperationsData = [];
let selectedOperationsEventId = '';
const CUMBRE_EVENT_ID = '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202';
const CUMBRE_FALLBACK_EVENT = {
  id: CUMBRE_EVENT_ID,
  title: 'Cumbre Mundial 2026',
  description: 'Encuentro global de la familia Maná.',
  scope: 'GLOBAL',
  status: 'PUBLISHED',
  start_date: '2026-06-06T09:00:00-05:00',
  end_date: '2026-06-08T18:00:00-05:00',
  location_name: 'Rionegro, Colombia',
  city: 'Rionegro',
  country: 'Colombia',
};
const ALL_CHURCHES_VALUE = '__all__';
const CUSTOM_CHURCH_VALUE = '__custom__';
const PAID_PAYMENT_STATUSES = new Set(['APPROVED', 'PAID']);
const MAX_SELECTOR_OPTIONS_WITHOUT_COUNTRY = 28;
const DEFAULT_CHURCH_BOOKINGS_PAGE_SIZE = 20;
const DEFAULT_CHURCH_PARTICIPANTS_PAGE_SIZE = 10;
const DEFAULT_CHURCH_PAYMENTS_PAGE_SIZE = 10;
const DEFAULT_CHURCH_INSTALLMENTS_PAGE_SIZE = 10;
const DEFAULT_ADMIN_FOLLOWUPS_PAGE_SIZE = 12;
const MAX_BULK_INSTALLMENT_REMINDERS = 80;

const normalizeGeoToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

async function getPortalAuthHeaders() {
  try {
    const auth = await ensureAuthenticated();
    if (auth?.isAuthenticated && auth.token) {
      portalAuthHeaders = { Authorization: `Bearer ${auth.token}` };
    } else {
      portalAuthHeaders = {};
    }
  } catch (err) {
    console.warn('[portal] refresh auth headers failed', err);
    portalAuthHeaders = portalAuthHeaders || {};
  }
  window.portalAuthHeaders = portalAuthHeaders;
  return portalAuthHeaders;
}

window.getPortalAuthHeaders = getPortalAuthHeaders;

async function getActionAuthHeaders() {
  const headers = await getPortalAuthHeaders();
  if (!Object.keys(headers || {}).length && authMode !== 'password') {
    throw new Error('Sesion vencida. Recarga la pagina e inicia sesion de nuevo.');
  }
  return headers;
}

function resolveOperationsEventLifecycle(event, now = Date.now()) {
  const status = String(event?.status || 'DRAFT').toUpperCase();
  if (status === 'ARCHIVED') return 'archived';
  if (status === 'DRAFT') return 'draft';
  const start = toDate(event?.start_date)?.getTime();
  const end = toDate(event?.end_date || event?.start_date)?.getTime();
  if (Number.isFinite(end) && end < now) return 'completed';
  if (Number.isFinite(start) && start <= now && (!Number.isFinite(end) || end >= now)) return 'live';
  return 'upcoming';
}

function getOperationsEventPublicPath(event) {
  if (event?.id === CUMBRE_EVENT_ID) return '/eventos/cumbre-mundial-2026';
  const identifier = String(event?.slug || event?.id || '').trim();
  return identifier ? `/eventos/${encodeURIComponent(identifier)}` : '/eventos';
}

function formatOperationsEventDate(event) {
  const start = toDate(event?.start_date);
  if (!start) return 'Fecha por confirmar';
  const end = toDate(event?.end_date);
  const startLabel = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(start);
  if (!end || start.toDateString() === end.toDateString()) return startLabel;
  const endLabel = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(end);
  return `${startLabel} - ${endLabel}`;
}

function getOperationsEventEconomyLabel(event) {
  if (event?.id === CUMBRE_EVENT_ID) return 'COP / USD · Wompi, Stripe y manual';
  const price = Number(event?.price || 0);
  if (price <= 0) return 'Evento gratuito';
  return `${formatCurrency(price, event?.currency || 'COP')} · Evento pagado`;
}

function getOperationsRegistrationLabel(event) {
  const mode = String(event?.registration_mode || 'NONE').toUpperCase();
  if (event?.id === CUMBRE_EVENT_ID) return 'Inscripción cerrada';
  if (mode === 'EXTERNAL') return 'Enlace externo';
  if (mode === 'INTERNAL') return 'Inscripción en el portal';
  return 'Sin inscripción';
}

function getOperationsPaymentLabel(event) {
  if (event?.id === CUMBRE_EVENT_ID) return 'Histórico conciliable';
  const price = Number(event?.price || 0);
  if (price <= 0) return 'No requerido';
  const currency = String(event?.currency || 'COP').toUpperCase();
  if (currency === 'COP') return 'Wompi o pago manual';
  if (currency === 'USD') return 'Stripe o pago manual';
  return 'Proveedor por configurar';
}

function renderOperationsEvent(event) {
  if (!event) return;
  const lifecycle = resolveOperationsEventLifecycle(event);
  const lifecycleMeta = {
    upcoming: { label: 'Próximo', className: 'portal-chip bg-blue-50 text-blue-700' },
    live: { label: 'En curso', className: 'portal-chip bg-teal-50 text-teal-700' },
    completed: { label: 'Finalizado', className: 'portal-chip bg-slate-200 text-slate-700' },
    draft: { label: 'Borrador', className: 'portal-chip bg-amber-50 text-amber-700' },
    archived: { label: 'Archivado', className: 'portal-chip bg-slate-200 text-slate-600' },
  }[lifecycle];
  const isCumbre = event.id === CUMBRE_EVENT_ID;
  const isClosed = lifecycle === 'completed' || lifecycle === 'archived';
  const scopeLabels = { LOCAL: 'Local', REGIONAL: 'Regional', NATIONAL: 'Nacional', GLOBAL: 'Global' };
  const publicPath = getOperationsEventPublicPath(event);

  selectedOperationsEventId = String(event.id || '');
  if (eventOperationState) {
    eventOperationState.textContent = lifecycleMeta.label;
    eventOperationState.className = lifecycleMeta.className;
  }
  if (iglesiaTitle) iglesiaTitle.textContent = event.title || 'Evento';
  if (iglesiaSubtitle) {
    iglesiaSubtitle.textContent = isClosed
      ? 'Expediente histórico para consulta, conciliación y reportes.'
      : 'Gestión operativa de inscripciones, participantes y recaudo.';
  }
  if (eventOperationDate) eventOperationDate.textContent = formatOperationsEventDate(event);
  if (eventOperationScope) eventOperationScope.textContent = `Alcance ${String(scopeLabels[String(event.scope || '').toUpperCase()] || event.scope || 'sin definir').toLowerCase()}`;
  if (eventOperationLocation) {
    eventOperationLocation.textContent = [event.location_name, event.city, event.country].filter(Boolean).join(' · ') || 'Lugar por confirmar';
  }
  if (eventOperationEconomy) eventOperationEconomy.textContent = getOperationsEventEconomyLabel(event);
  if (eventPublicPageLink) eventPublicPageLink.href = publicPath;
  if (eventGenericPublicLink) eventGenericPublicLink.href = publicPath;
  eventClosedBanner?.classList.toggle('hidden', !isClosed);

  if (eventGenericRegistration) eventGenericRegistration.textContent = getOperationsRegistrationLabel(event);
  if (eventGenericPrice) eventGenericPrice.textContent = Number(event.price || 0) > 0 ? formatCurrency(event.price, event.currency || 'COP') : 'Gratuito';
  if (eventGenericPayment) eventGenericPayment.textContent = getOperationsPaymentLabel(event);
  if (eventGenericHeading) {
    eventGenericHeading.textContent = isClosed
      ? 'Expediente del evento'
      : portalCanManageEvents
        ? 'Configura inscripciones y recaudo'
        : 'Resumen financiero del evento';
  }
  if (eventGenericDescription) {
    eventGenericDescription.textContent = isClosed
      ? 'El evento terminó. Conserva aquí su configuración y, cuando se active la operación financiera genérica, sus registros, pagos, comprobantes y reportes.'
      : portalCanManageEvents
        ? 'Este evento ya tiene calendario y página pública. Define entradas, moneda y métodos de pago antes de abrir registros.'
        : 'Consulta la modalidad, el valor configurado y el estado operativo del evento.';
  }

  if (portalCanViewEventOperations) {
    const showGenericDashboard = !isCumbre || !portalHasChurchAccess;
    eventGenericDashboard?.classList.toggle('hidden', !showGenericDashboard);
    eventPersonalDashboard?.classList.add('hidden');
    churchDashboardManagement?.classList.toggle('hidden', !isCumbre || !portalHasChurchAccess);
  }
  eventOperationsConfigure?.classList.toggle('hidden', !portalCanManageEvents);
  eventGenericConfigure?.classList.toggle('hidden', !portalCanManageEvents);
  if (churchSelector) {
    const showChurchSelector = isCumbre && portalHasChurchAccess && portalCanSelectChurch;
    churchSelector.classList.toggle('hidden', !showChurchSelector);
  }
  document.getElementById('church-registration-action')?.classList.toggle('hidden', isClosed);
  const activeChurchFormToggle = document.getElementById('church-form-toggle');
  if (activeChurchFormToggle) {
    activeChurchFormToggle.disabled = isClosed;
    activeChurchFormToggle.classList.toggle('opacity-50', isClosed);
    activeChurchFormToggle.classList.toggle('cursor-not-allowed', isClosed);
  }
}

function sortOperationsEvents(events) {
  return [...events].sort((left, right) => {
    const leftLifecycle = resolveOperationsEventLifecycle(left);
    const rightLifecycle = resolveOperationsEventLifecycle(right);
    const order = { live: 0, upcoming: 1, draft: 2, completed: 3, archived: 4 };
    const lifecycleDiff = order[leftLifecycle] - order[rightLifecycle];
    if (lifecycleDiff !== 0) return lifecycleDiff;
    const leftDate = toDate(left.start_date)?.getTime() || 0;
    const rightDate = toDate(right.start_date)?.getTime() || 0;
    return leftLifecycle === 'completed' ? rightDate - leftDate : leftDate - rightDate;
  });
}

function populateOperationsEventSelector(events) {
  if (!eventOperationsSelector) return;
  eventOperationsSelector.innerHTML = '';
  events.forEach((event) => {
    const option = document.createElement('option');
    option.value = event.id;
    const lifecycle = resolveOperationsEventLifecycle(event);
    const suffix = lifecycle === 'completed' ? 'Finalizado' : lifecycle === 'live' ? 'En curso' : lifecycle === 'draft' ? 'Borrador' : 'Próximo';
    option.textContent = `${event.title || 'Evento'} · ${suffix}`;
    eventOperationsSelector.appendChild(option);
  });
  eventOperationsSelector.value = selectedOperationsEventId;
}

async function selectOperationsEvent(eventId, options = {}) {
  const selected = eventOperationsData.find((event) => event.id === eventId) || CUMBRE_FALLBACK_EVENT;
  renderOperationsEvent(selected);
  if (options.persist !== false && portalCanViewEventOperations) {
    try {
      window.localStorage.setItem('mana.portal.operationsEventId', selected.id);
    } catch {
      // Storage is optional.
    }
  }
  if (selected.id === CUMBRE_EVENT_ID && portalHasChurchAccess && options.reloadLegacyData) {
    await Promise.allSettled([
      loadChurchBookings(portalAuthHeaders),
      loadChurchParticipants(portalAuthHeaders),
      loadChurchPayments(portalAuthHeaders),
      loadChurchInstallments(portalAuthHeaders),
      loadChurchMembers(portalAuthHeaders),
    ]);
  }
}

async function loadOperationsEvents(headers = {}) {
  if (!portalCanViewEventOperations) {
    eventOperationsControls?.classList.add('hidden');
    eventOperationsControls?.classList.remove('flex');
    renderOperationsEvent(CUMBRE_FALLBACK_EVENT);
    return;
  }
  eventOperationsControls?.classList.remove('hidden');
  eventOperationsControls?.classList.add('flex');
  let events = [];
  try {
    const res = await fetch('/api/portal/events', { headers, credentials: 'include' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudieron cargar eventos');
    events = Array.isArray(payload.events) ? payload.events : [];
  } catch (error) {
    console.error('[portal.events.operations] load error', error);
  }
  if (!events.some((event) => event.id === CUMBRE_EVENT_ID)) events.push(CUMBRE_FALLBACK_EVENT);
  eventOperationsData = sortOperationsEvents(events);

  let savedEventId = '';
  const requestedEventId = new URLSearchParams(window.location.search).get('event') || '';
  try {
    savedEventId = window.localStorage.getItem('mana.portal.operationsEventId') || '';
  } catch {
    savedEventId = '';
  }
  const initialId = eventOperationsData.some((event) => event.id === requestedEventId)
    ? requestedEventId
    : eventOperationsData.some((event) => event.id === savedEventId)
      ? savedEventId
    : eventOperationsData.some((event) => event.id === CUMBRE_EVENT_ID)
      ? CUMBRE_EVENT_ID
      : eventOperationsData[0]?.id;
  selectedOperationsEventId = initialId || CUMBRE_EVENT_ID;
  populateOperationsEventSelector(eventOperationsData);
  await selectOperationsEvent(selectedOperationsEventId, { persist: false });
}

eventOperationsSelector?.addEventListener('change', () => {
  void selectOperationsEvent(eventOperationsSelector.value, { reloadLegacyData: true });
});

function isAllChurchesSelected() {
  return portalSelectedChurchId === ALL_CHURCHES_VALUE;
}

function resolveSelectedChurchId() {
  if (!portalSelectedChurchId || isAllChurchesSelected()) return '';
  return portalSelectedChurchId;
}

function ensureAllChurchesSelection() {
  if (portalIsCustomChurch) return;
  if (!portalSelectedChurchId && churchSelectorInput?.value === ALL_CHURCHES_VALUE) {
    portalSelectedChurchId = ALL_CHURCHES_VALUE;
    return;
  }
  if (!portalAllowAllChurches || portalSelectedChurchId) return;
  portalSelectedChurchId = ALL_CHURCHES_VALUE;
  if (churchSelectorInput) {
    churchSelectorInput.value = ALL_CHURCHES_VALUE;
  }
}

function requiresScopedChurchSelection() {
  return (portalIsAdmin || portalIsCountryPastor)
    && !resolveSelectedChurchId()
    && !portalIsCustomChurch;
}

function enrichChurchCatalog(churches = []) {
  return (churches || []).map((church) => {
    const country = normalizeChurchCountry(church);
    const continent = normalizeChurchContinent(church, country);
    const city = String(church?.city || '').trim();
    return {
      ...church,
      country,
      continent,
      city,
    };
  });
}

function getCountriesForSelector(continent = '') {
  const countries = new Set();
  (portalChurchesCatalog || []).forEach((church) => {
    if (!church?.country) return;
    if (continent && church.continent !== continent) return;
    countries.add(church.country);
  });
  return Array.from(countries).sort(compareSpanishLabels);
}

function getFilteredChurchesForSelector() {
  return (portalChurchesCatalog || [])
    .filter((church) => {
      if (selectorContinentFilter && church.continent !== selectorContinentFilter) return false;
      if (selectorCountryFilter && church.country !== selectorCountryFilter) return false;
      if (selectorSearchFilter) {
        const haystack = [
          church.name,
          church.city,
          church.country,
          church.continent,
          church.code,
        ].filter(Boolean).join(' ');
        if (!normalizeGeoToken(haystack).includes(selectorSearchFilter)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const continentCompare = compareSpanishLabels(a.continent, b.continent);
      if (continentCompare !== 0) return continentCompare;
      const countryCompare = compareSpanishLabels(a.country, b.country);
      if (countryCompare !== 0) return countryCompare;
      const cityCompare = compareSpanishLabels(a.city, b.city);
      if (cityCompare !== 0) return cityCompare;
      return compareSpanishLabels(a.name, b.name);
    });
}

function setSelectorOptions(selectNode, options, defaultLabel, selectedValue = '') {
  if (!selectNode) return;
  selectNode.innerHTML = `<option value=\"\">${defaultLabel}</option>${options
    .map((option) => `<option value=\"${safeAttr(option.value)}\">${safeText(option.label)}</option>`)
    .join('')}`;
  selectNode.value = selectedValue || '';
}

function syncSelectorFiltersToCurrentSelection() {
  const selectedId = resolveSelectedChurchId();
  if (!selectedId) return;
  const selectedChurch = (portalChurchesCatalog || []).find((church) => church.id === selectedId);
  if (!selectedChurch) return;
  selectorContinentFilter = selectedChurch.continent || selectorContinentFilter;
  selectorCountryFilter = selectedChurch.country || selectorCountryFilter;
}

function ensureDefaultSelectorFilters() {
  if (selectorCountryFilter || selectorContinentFilter) return;
  const catalog = portalChurchesCatalog || [];
  if (!catalog.length) return;

  const profileCountryRaw = portalProfile?.country;
  if (profileCountryRaw) {
    const profileCountryKey = normalizeGeoToken(profileCountryRaw);
    const matchingCountry = catalog.find((church) => normalizeGeoToken(church.country) === profileCountryKey);
    if (matchingCountry) {
      selectorCountryFilter = matchingCountry.country;
      selectorContinentFilter = matchingCountry.continent || '';
      return;
    }
  }

  if (portalScope === 'country') {
    const first = catalog[0];
    selectorCountryFilter = first?.country || '';
    selectorContinentFilter = first?.continent || '';
  }
}

function buildChurchSelectorLabel(church) {
  const baseName = String(church?.name || '').trim();
  const city = String(church?.city || '').trim();
  const country = String(church?.country || '').trim();
  const normalizedName = normalizeGeoToken(baseName);
  const parts = [];
  if (baseName) parts.push(baseName);
  if (city && !normalizedName.includes(normalizeGeoToken(city))) parts.push(city);
  if (country && !normalizedName.includes(normalizeGeoToken(country))) parts.push(country);
  return parts.filter(Boolean).join(' · ');
}

function renderChurchSelectorOptions({ allowAll = false, allowCustom = false, scope = 'church' } = {}) {
  if (!churchSelectorInput) return;

  const continents = Array.from(new Set((portalChurchesCatalog || []).map((church) => church.continent).filter(Boolean)))
    .sort(compareSpanishLabels);
  const continentOptions = continents.map((continent) => ({
    value: continent,
    label: continent,
  }));
  setSelectorOptions(churchSelectorContinent, continentOptions, 'Continente: todos', selectorContinentFilter);

  const countries = getCountriesForSelector(selectorContinentFilter);
  if (selectorCountryFilter && !countries.includes(selectorCountryFilter)) {
    selectorCountryFilter = '';
  }
  const countryOptions = countries.map((country) => ({
    value: country,
    label: country,
  }));
  setSelectorOptions(churchSelectorCountry, countryOptions, 'País: todos', selectorCountryFilter);

  const filtered = getFilteredChurchesForSelector();
  const hasCountryFilter = Boolean(selectorCountryFilter);
  const requiresCountryFirst = !hasCountryFilter && filtered.length > MAX_SELECTOR_OPTIONS_WITHOUT_COUNTRY;
  const selectedId = resolveSelectedChurchId();
  const selectedChurch = selectedId
    ? (portalChurchesCatalog || []).find((church) => church.id === selectedId)
    : null;
  if (selectedChurch && !filtered.some((church) => church.id === selectedChurch.id)) {
    filtered.unshift(selectedChurch);
  }

  churchSelectorInput.innerHTML = '';
  if (allowAll) {
    const allOption = document.createElement('option');
    allOption.value = ALL_CHURCHES_VALUE;
    allOption.textContent = scope === 'country' ? 'Todos (pais)' : 'Todos';
    churchSelectorInput.appendChild(allOption);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = requiresCountryFirst
      ? 'Primero selecciona un pais'
      : 'Selecciona una iglesia';
    churchSelectorInput.appendChild(placeholder);
  }

  const visibleChurches = requiresCountryFirst
    ? (selectedChurch ? [selectedChurch] : [])
    : filtered;
  visibleChurches.forEach((church) => {
    const option = document.createElement('option');
    option.value = church.id;
    option.textContent = buildChurchSelectorLabel(church);
    churchSelectorInput.appendChild(option);
  });

  if (allowCustom) {
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_CHURCH_VALUE;
    customOption.textContent = 'Otra iglesia (manual)';
    churchSelectorInput.appendChild(customOption);
  }

  const currentValue = portalIsCustomChurch
    ? CUSTOM_CHURCH_VALUE
    : (portalSelectedChurchId || (allowAll ? ALL_CHURCHES_VALUE : ''));
  const hasCurrentValue = Array.from(churchSelectorInput.options).some((option) => option.value === currentValue);
  if (hasCurrentValue) {
    churchSelectorInput.value = currentValue;
  } else if (allowAll) {
    churchSelectorInput.value = ALL_CHURCHES_VALUE;
  }

  const showFilterHint = requiresCountryFirst && !selectedChurch;
  churchSelectorInput.classList.toggle('ring-2', showFilterHint);
  churchSelectorInput.classList.toggle('ring-amber-300', showFilterHint);
  churchSelectorInput.classList.toggle('ring-offset-0', showFilterHint);
}

function formatCurrency(value, currency) {
  if (!currency) return value;
  const normalizedCurrency = String(currency).toUpperCase();
  try {
    return new Intl.NumberFormat(normalizedCurrency === 'COP' ? 'es-CO' : 'en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: normalizedCurrency === 'COP' ? 0 : 2,
    }).format(Number(value || 0));
  } catch {
    return `${normalizedCurrency} ${Number(value || 0).toLocaleString('es-CO')}`;
  }
}

function formatCurrencyBreakdown(totals) {
  const copValue = Number(totals?.COP || 0);
  const usdValue = Number(totals?.USD || 0);
  return `
    <span class="block">${formatCurrency(copValue, 'COP')}</span>
    <span class="block text-xl text-slate-400 font-semibold">${formatCurrency(usdValue, 'USD')}</span>
  `;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatLongDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidDateOnlyInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const CUMBRE_EVENT_START = new Date('2026-06-06T09:00:00-05:00');
const CUMBRE_EVENT_END = new Date('2026-06-08T18:00:00-05:00');
const CUMBRE_ABONO_DEADLINE = new Date('2026-05-15T23:59:59-05:00');
const DONATION_LABELS = {
  diezmos: 'Diezmo',
  ofrendas: 'Ofrenda',
  misiones: 'Misiones',
  campus: 'Campus',
  evento: 'Evento',
  peregrinaciones: 'Peregrinaciones',
  general: 'General',
};

function normalizeDonationType(value) {
  return (value || '').toString().trim().toLowerCase();
}

function resolveDonationLabel(value) {
  const key = normalizeDonationType(value);
  return DONATION_LABELS[key] || 'Aporte';
}

function isCampusDonation(item) {
  return normalizeDonationType(item?.donation_type) === 'campus';
}

function isEventDonation(item) {
  return normalizeDonationType(item?.donation_type) === 'evento';
}

function resolveEventDates(booking) {
  const eventStart = booking?.event_start_date ? toDate(booking.event_start_date) : null;
  const eventEnd = booking?.event_end_date ? toDate(booking.event_end_date) : null;
  const title = (booking?.event_name || '').toString().trim();
  const isCumbre = !title || title.toLowerCase().includes('cumbre');
  return {
    title: title || 'Cumbre Mundial 2026',
    start: eventStart || (isCumbre ? CUMBRE_EVENT_START : null),
    end: eventEnd || (isCumbre ? CUMBRE_EVENT_END : null),
    isCumbre,
  };
}

function getCountdownLabel(startDate, endDate) {
  if (!startDate) return 'Sin fecha';
  const now = new Date();
  const end = endDate || startDate;
  if (now > end) return 'Evento finalizado';
  if (now >= startDate && now <= end) return 'Evento en curso';
  const diffMs = startDate.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 1) return 'Falta 1 día';
  return `Faltan ${days} días`;
}

function formatCalendarDate(date) {
  if (!date) return '';
  const iso = date.toISOString().replace(/[-:]/g, '').split('.')[0];
  return `${iso}Z`;
}

function buildGoogleCalendarUrl({ title, start, end, location, details }) {
  if (!start) return '';
  const startStr = formatCalendarDate(start);
  const endStr = formatCalendarDate(end || start);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Evento Maná',
    dates: `${startStr}/${endStr}`,
    location: location || '',
    details: details || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildIcsContent({ title, start, end, location, details }) {
  const startStr = formatCalendarDate(start);
  const endStr = formatCalendarDate(end || start);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ministerio Mana//Portal//ES',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@ministeriomana.org`,
    `DTSTAMP:${formatCalendarDate(new Date())}`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:${(title || 'Evento Maná').replace(/\\n/g, ' ')}`,
    location ? `LOCATION:${location.replace(/\\n/g, ' ')}` : '',
    details ? `DESCRIPTION:${details.replace(/\\n/g, ' ')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\n');
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
  link.addEventListener('click', (e) => {
    const targetTab = link.dataset.tab;
    if (targetTab) {
      e.preventDefault();
      // Update URL
      const url = new URL(window.location);
      url.searchParams.set('tab', targetTab);
      history.pushState({}, '', url);
      switchTab(targetTab, { focusHeading: true });
    }
  });
});

document.querySelectorAll('[data-tab-trigger]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tabTrigger, { focusHeading: true });
  });
});

function switchTab(tabId, { focusHeading = false } = {}) {
  // Update links
  navLinks.forEach((link) => {
    link.classList.remove('active');
    if (link.dataset.tab) link.removeAttribute('aria-current');
  });
  const activeLink = document.querySelector(`[data-tab="${tabId}"]`);
  activeLink?.classList.add('active');
  activeLink?.setAttribute('aria-current', 'page');

  let activeContent = null;
  tabContents.forEach(content => {
    if (content.id === `tab-${tabId}`) {
      activeContent = content;
      content.classList.remove('hidden');
      content.setAttribute('aria-hidden', 'false');
      animateIn(content, { x: 20, duration: 260 });
    } else {
      content.classList.add('hidden');
      content.setAttribute('aria-hidden', 'true');
    }
  });

  if (focusHeading) {
    activeContent?.querySelector('[tabindex="-1"]')?.focus({ preventScroll: false });
  }
}

function getErrorMessage(err) {
  if (!err) return 'Unknown client error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Unknown error';
  return String(err);
}

async function reportPortalClientError(identifier, err, meta = {}) {
  try {
    const payload = {
      identifier,
      message: getErrorMessage(err),
      meta: {
        route: window.location.pathname,
        ...meta,
      },
    };
    await fetch('/api/portal/client-error', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // no-op: observability must never block UX
  }
}

function runSafe(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[portal.dashboard] ${label} failed`, err);
    void reportPortalClientError('portal.dashboard.run-safe', err, { label });
    return null;
  }
}

const ACCOUNT_SUMMARY_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}, timeoutMs = ACCOUNT_SUMMARY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function setAccountDataWarning(visible) {
  document.getElementById('account-data-warning')?.classList.toggle('hidden', !visible);
}

[document.getElementById('account-error-retry'), document.getElementById('account-data-retry')]
  .filter(Boolean)
  .forEach((button) => {
    button.addEventListener('click', () => window.location.reload());
  });

document.getElementById('focus-participant-search')?.addEventListener('click', () => {
  churchParticipantsSearch?.focus();
});

async function loadChurchCatalog(headers = {}) {
  try {
    const churchesRes = await fetch('/api/portal/churches', { headers, credentials: 'include' });
    if (!churchesRes?.ok) {
      dwarn('Could not load churches:', churchesRes ? `status ${churchesRes.status}` : 'request failed');
      return;
    }

    const churchesPayload = await churchesRes.json().catch((err) => {
      console.error('[portal.dashboard] churches payload parse error', err);
      return [];
    });
    portalChurchesCatalog = enrichChurchCatalog(Array.isArray(churchesPayload) ? churchesPayload : []);
    runSafe('populateChurchesUI', () => populateChurchesUI(portalChurchesCatalog));

    if (window.advancedChurchSelector && portalChurchesCatalog.length > 0) {
      runSafe('advancedChurchSelector.setChurches', () => window.advancedChurchSelector.setChurches(portalChurchesCatalog));
    }
  } catch (err) {
    console.error('[portal.dashboard] churches request failed', err);
  }
}

// Core Dashboard Logic - Reactive Auth
async function loadDashboardData(authResult) {
  dlog('[DEBUG] loadDashboardData called with mode:', authResult.mode);
  let sessionValidated = false;

  try {
    const token = authResult.token;
    const sessionUser = authResult.user;

    // Update global state
    authMode = authResult.mode;
    if (sessionUser) {
      portalProfile = sessionUser;
    }

    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    portalAuthHeaders = headers;
    window.portalAuthHeaders = headers;
    // 2. Parallelized Initial Data Fetching

    dlog('[DEBUG] Starting session and account requests...');

    const resumenPromise = fetchWithTimeout('/api/cuenta/resumen', {
      headers,
      credentials: 'include',
    }).catch((err) => {
      console.error('[portal.dashboard] resumen request failed', err);
      return null;
    });
    const sessionInfo = await getPortalSession({ auth: authResult });
    const sessionRes = sessionInfo.response;
    const userData = sessionUser || null;
    dlog('[DEBUG] Session request completed.');

    dlog('[DEBUG] sessionRes status:', sessionRes?.status);
    dlog('[DEBUG] userData:', userData);

    if (!sessionInfo.ok) {
      console.error('[DEBUG] /api/portal/session failed:', sessionRes?.status, sessionRes?.statusText);
      if (sessionRes?.status === 401 || sessionRes?.status === 403) {
        redirectToLogin();
        return;
      }
      throw new Error(`Session API error: ${sessionRes?.status || 'unknown'}`);
    }

    const sessionPayload = sessionInfo.data || { ok: false, error: 'Respuesta inválida de sesión' };
    dlog('[DEBUG] sessionPayload:', sessionPayload);
    if (!sessionInfo.ok || !sessionPayload.ok) throw new Error(sessionPayload.error || 'No se pudo cargar el perfil');
    sessionValidated = true;

    authMode = sessionPayload.mode || 'supabase';
    portalProfile = (sessionPayload.profile && typeof sessionPayload.profile === 'object') ? sessionPayload.profile : {};
    portalMemberships = Array.isArray(sessionPayload.memberships) ? sessionPayload.memberships : [];
    portalPermissions = (sessionPayload.permissions && typeof sessionPayload.permissions === 'object')
      ? sessionPayload.permissions
      : {};
    portalRole = portalProfile?.role || 'user';
    portalIsAdmin = portalRole === 'admin' || portalRole === 'superadmin';
    portalIsSuperadmin = portalRole === 'superadmin';
    portalIsCountryPastor = portalRole === 'national_pastor';
    churchAuditBtn?.classList.toggle('hidden', !portalIsAdmin);

    dlog('[DEBUG] Data loaded. Profile:', portalProfile);

    // --- Sidebar Role Visibility Logic ---
    const navLinkEventManagement = document.getElementById('nav-link-events'); // Gestión de Eventos
    const navLinkFinances = document.getElementById('nav-link-finances'); // Finanzas
    const navLinkUsers = document.getElementById('nav-link-users'); // Usuarios
    const navLinkCampus = document.getElementById('nav-link-campus'); // Campus
    const navLinkDonations = document.getElementById('nav-link-donations'); // Donaciones
    const navLinkRegions = document.getElementById('nav-link-regions'); // Regiones
    const navLinkPrayers = document.getElementById('nav-link-prayers'); // Peticiones
    const tabIglesia = document.getElementById('tab-iglesia'); // The actual tab content

    // Default: Hide ALL restricted links (regular users see none of these)
    if (navLinkEventManagement) navLinkEventManagement.style.display = 'none';
    if (navLinkFinances) navLinkFinances.style.display = 'none';
    if (navLinkUsers) navLinkUsers.style.display = 'none';
    if (navLinkCampus) navLinkCampus.style.display = 'none';
    if (navLinkDonations) navLinkDonations.style.display = 'none';
    if (navLinkRegions) navLinkRegions.style.display = 'none';
    if (navLinkPrayers) navLinkPrayers.style.display = 'none';

    const myRole = portalProfile?.role || 'user';
    const membershipRoles = portalMemberships.map((m) => m?.role).filter(Boolean);
    const hasChurchMembership = membershipRoles.some((role) => ['church_admin', 'church_member'].includes(role));
    const canRegisterPeople = Boolean(portalPermissions.can_register_people);

    // Tab Iglesia (Eventos) - Show to ALL users, but content varies by role
    const isManagementRole = portalIsAdmin || canRegisterPeople || hasChurchMembership;


    if (tabIglesia) {
      if (isManagementRole) {
        // Pastors/Admins: Show management view (church selector + booking list)
        const churchDashboardUser = document.getElementById('church-dashboard-user');
        if (churchDashboardUser) churchDashboardUser.classList.add('hidden');
      } else {
        // Regular users: Show personal event info (countdown, payment status, group)
        const churchDashboardManagement = document.getElementById('church-dashboard-management');
        if (churchDashboardManagement) churchDashboardManagement.classList.add('hidden');

        const churchDashboardUser = document.getElementById('church-dashboard-user');
        if (churchDashboardUser) churchDashboardUser.classList.remove('hidden');

        // Load user's own event data
        if (typeof loadMyEventInfo === 'function') {
          loadMyEventInfo(portalAuthHeaders);
        }
      }
    }

    const canManageEvents = Boolean(
      portalPermissions.can_manage_local_events
      || portalPermissions.can_manage_regional_events
      || portalPermissions.can_manage_national_events
      || portalPermissions.can_manage_global_events,
    );
    portalCanManageEvents = canManageEvents;
    portalCanViewEventOperations = canManageEvents || Boolean(portalPermissions.can_view_event_finances);
    const canManageUsers = Boolean(portalPermissions.can_manage_users);
    const canAccessCampus = Boolean(portalPermissions.can_access_campus);
    const canAccessFinances = Boolean(portalPermissions.can_access_finances);
    const canAccessPrayers = Boolean(portalPermissions.can_access_prayers);

    if (myRole) {
      if (canManageEvents && navLinkEventManagement) {
        navLinkEventManagement.style.display = 'flex';
      }

      if (canManageUsers && navLinkUsers) {
        navLinkUsers.style.display = 'flex';
      }

      if (canAccessCampus && navLinkCampus) {
        navLinkCampus.style.display = 'flex';
      }

      if (canAccessFinances && navLinkFinances) {
        navLinkFinances.style.display = 'flex';
      }

      if (canAccessFinances && navLinkDonations) {
        navLinkDonations.style.display = 'flex';
      }

      if (portalIsAdmin && navLinkRegions) {
        navLinkRegions.style.display = 'flex';
      }

      if (canAccessPrayers && navLinkPrayers) {
        navLinkPrayers.style.display = 'flex';
      }
    }

    // -------------------------------------

    const hasChurchRole = portalMemberships.some(
      (membership) => ['church_admin', 'church_member'].includes(membership?.role)
        && isApprovedChurchMembershipStatus(membership?.status),
    );
    const canUseChurchManagement = myRole !== 'campus_missionary';
    const hasChurchAccess = portalIsAdmin
      || (canUseChurchManagement && (
        hasChurchRole
        || canRegisterPeople
      ));
    portalHasChurchAccess = hasChurchAccess;
    renderOperationsEvent(CUMBRE_FALLBACK_EVENT);
    const membershipChurch = portalMemberships.find((item) => item?.church?.id)?.church || null;

    if (!portalSelectedChurchId && membershipChurch?.id && !portalIsAdmin) {
      portalSelectedChurchId = membershipChurch.id;
    }
    if (churchNameInput && membershipChurch?.name && !portalIsAdmin) {
      churchNameInput.value = membershipChurch.name;
      churchNameInput.setAttribute('readonly', 'readonly');
      churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
    }

    const shellName = String(
      portalProfile?.full_name
      || sessionUser?.user_metadata?.full_name
      || sessionUser?.email
      || 'Usuario',
    ).trim();
    if (welcomeName) welcomeName.textContent = shellName.split(' ')[0] || 'Usuario';
    loadingEl?.classList.add('hidden');
    contentEl?.classList.remove('hidden');
    animateIn(contentEl, { y: 20, duration: 260 });

    let payload = { ok: true, user: {}, bookings: [], plans: [], payments: [] };
    let resumenFailed = false;
    try {
      const resumenRes = await resumenPromise;
      if (resumenRes?.ok) {
        const resData = await resumenRes.json().catch((err) => {
          console.error('[portal.dashboard] resumen payload parse error', err);
          return { ok: false, error: 'Respuesta inválida de resumen' };
        });
        dlog('[DEBUG] resData (resumen):', resData);
        if (resData.ok) {
          payload = resData;
        } else {
          resumenFailed = true;
          dwarn('Could not load resumen:', resData.error);
        }
      } else {
        resumenFailed = true;
        dwarn('Could not load resumen:', `status ${resumenRes?.status || 'unknown'}`);
      }
    } catch (err) {
      resumenFailed = true;
      console.error('[portal.dashboard] resumen request failed', err);
    }
    portalAccountPayload = payload;
    contentEl?.setAttribute('aria-busy', 'false');
    setAccountDataWarning(resumenFailed);

    const user = userData;

    const bookings = Array.isArray(payload.bookings) ? payload.bookings.filter(Boolean) : [];
    const plans = Array.isArray(payload.plans) ? payload.plans.filter(Boolean) : [];
    const installments = Array.isArray(payload.installments) ? payload.installments.filter(Boolean) : [];
    const donations = Array.isArray(payload.donations) ? payload.donations.filter(Boolean) : [];
    const donationSubscriptions = Array.isArray(payload.donationSubscriptions) ? payload.donationSubscriptions.filter(Boolean) : [];
    const donationRecurringSubscriptions = Array.isArray(payload.donationRecurringSubscriptions)
      ? payload.donationRecurringSubscriptions.filter(Boolean)
      : [];
    const campusSubscriptions = Array.isArray(payload.campusSubscriptions)
      ? payload.campusSubscriptions.filter(Boolean)
      : [];
    const events = Array.isArray(payload.events) ? payload.events.filter(Boolean) : [];

    const activeUser = payload.user || {};
    const rawName = activeUser.fullName || user?.user_metadata?.full_name || 'Usuario';
    const name = String(rawName || 'Usuario').trim() || 'Usuario';
    if (profileName) profileName.value = name;
    if (welcomeName) welcomeName.textContent = name.split(' ')[0] || 'Usuario';
    if (profileEmail) profileEmail.value = activeUser.email || user?.email || '';
    if (profileRole) profileRole.value = portalProfile?.role || 'user';
    if (profilePhone) profilePhone.value = portalProfile.phone || '';
    if (profileCity) profileCity.value = portalProfile.city || '';
    if (profileCountry) profileCountry.value = portalProfile.country || '';
    if (profileDocumentType) profileDocumentType.value = portalProfile.document_type || '';
    if (profileDocumentNumber) profileDocumentNumber.value = portalProfile.document_number || '';
    if (profileAffiliation) profileAffiliation.value = portalProfile.affiliation_type || '';
    if (profileChurchName) profileChurchName.value = portalProfile.church_name || '';
    if (profileAffiliation) toggleChurchField(profileAffiliation.value);

    // Update Label for Superadmins if needed, though replaced by new static logic
    if (portalProfile?.role === 'admin' || portalProfile?.role === 'superadmin') {
      if (iglesiaTitle) iglesiaTitle.textContent = 'Cumbre Mundial 2026';
      if (iglesiaSubtitle) iglesiaSubtitle.textContent = 'Panel general del evento para gestión de sedes y registros físicos.';

      const adminUsersCard = document.getElementById('admin-users-card');
      const syncWrapper = document.getElementById('admin-sync-wrapper');
      // We might keep these hidden or visible depending on specific page logic, 
      // but Sidebar is now the primary navigation.
      // adminUsersCard?.classList.remove('hidden'); // Legacy logic?
      syncWrapper?.classList.remove('hidden');
    }

    runSafe('renderHeaderStats', () => {
      const totalPaidByCurrency = {};
      bookings.forEach((booking) => {
        const currency = (booking?.currency || 'COP').toString().toUpperCase();
        totalPaidByCurrency[currency] = (totalPaidByCurrency[currency] || 0) + (booking?.total_paid || 0);
      });
      if (statTotalPaid) {
        statTotalPaid.innerHTML = formatCurrencyBreakdown(totalPaidByCurrency);
      }

      const activePlans = plans.filter((plan) => plan?.status === 'ACTIVE');
      const nextPlanDate = activePlans
        .map((plan) => toDate(plan?.next_due_date))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
      const nextInstallmentDate = installments
        .filter((item) => ['PENDING', 'FAILED'].includes(item?.status))
        .map((item) => toDate(item?.due_date))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;

      const hasPendingBalance = bookings.some((b) => Number(b?.total_amount || 0) > Number(b?.total_paid || 0));
      const deadlineHintDate = activePlans
        .map((plan) => toDate(plan?.end_date))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime())[0] || (hasPendingBalance ? CUMBRE_ABONO_DEADLINE : null);

      const nextDueDate = nextPlanDate || nextInstallmentDate;
      if (statNextDue) {
        if (nextDueDate) {
          statNextDue.textContent = formatDate(nextDueDate);
          if (statNextNote) statNextNote.textContent = 'Plan de cuotas activo';
        } else if (hasPendingBalance) {
          statNextDue.textContent = 'Sin fecha';
          if (statNextNote) statNextNote.textContent = deadlineHintDate ? `Antes de ${formatLongDate(deadlineHintDate)}` : 'Plan de cuotas activo';
        } else {
          statNextDue.textContent = '-';
          if (statNextNote) statNextNote.textContent = 'Sin cuotas pendientes';
        }
      }

      const activePlan = activePlans[0];
      if (activePlan && planHighlight && highlightAmount && highlightDate) {
        const nextDueLabel = activePlan.next_due_date ? formatDate(activePlan.next_due_date) : 'Sin fecha';
        const nextDueHint = activePlan.end_date ? `Antes de ${formatLongDate(activePlan.end_date)}` : '';
        planHighlight.classList.remove('hidden');
        highlightAmount.textContent = formatCurrency(activePlan.installment_amount, activePlan.currency);
        highlightDate.textContent = nextDueHint || nextDueLabel;

        const highlightHeader = document.getElementById('highlight-header');
        const highlightContext = document.getElementById('highlight-context');
        const relatedBooking = bookings.find((b) => b?.id === activePlan.booking_id);
        let concept = relatedBooking?.event_name || 'Cumbre Mundial 2026';
        if (relatedBooking?.event_type === 'campus') {
          concept = 'Campus Maná';
        }
        const type = 'Abono auto.';
        if (highlightHeader) highlightHeader.textContent = `${type} - ${concept}`;
        if (highlightContext) highlightContext.textContent = concept;
      }
    });

    runSafe('renderBookings', () => renderBookings(bookings));
    runSafe('renderPlans', () => renderPlans(plans, bookings));
    runSafe('renderInstallments', () => renderInstallments(installments, plans, bookings));
    const paymentsForTable = buildPaymentsTableData(payload);
    runSafe('renderPayments', () => renderPayments(paymentsForTable));
    runSafe('renderSummaryEvents', () => renderSummaryEvents(bookings, plans, installments));
    runSafe('renderGivingSummary', () => renderGivingSummary(donations, donationSubscriptions, donationRecurringSubscriptions));
    runSafe('renderCampusSummary', () => renderCampusSummary(donations, donationSubscriptions, campusSubscriptions));
    runSafe('renderLocalEvents', () => renderLocalEvents(events));
    runSafe('renderMemberships', () => renderMemberships(portalMemberships));
    runSafe('setupInviteAccess', () => setupInviteAccess());
    runSafe('initAdminInvite', () => initAdminInvite());
    if (hasChurchAccess) {
      runSafe('initChurchManualForm', () => initChurchManualForm());
      runSafe('initInviteForm', () => initInviteForm());
      scheduleAdvancedComponentsInit();
    }

    // Inject Admin Filters if applicable
    if (portalProfile?.role === 'admin' || portalProfile?.role === 'superadmin') {
      runSafe('setupAdminFilters', () => setupAdminFilters(bookings));
    }

    // Role-based filtering for initial view
    let displayedBookings = bookings;
    if (portalProfile?.role === 'pastor' || portalProfile?.role === 'leader') {
      const myChurch = portalProfile.church_name;
      if (myChurch) {
        displayedBookings = displayedBookings.filter(b => b.church_name === myChurch);
      }
    }

    // Initial Render with (potentially) filtered data
    // Note: renderBookings will reuse portalGlobalBookings if we don't pass filtered, so let's update calling convention
    // But renderPlans/etc might also need filtering. For now, focus on Bookings list.
    runSafe('renderBookings(filtered)', () => renderBookings(displayedBookings));

    // 6. Background Initialization (Parallelized)
    const backgroundTasks = [];
    const operationsTask = loadOperationsEvents(headers);
    backgroundTasks.push(operationsTask);
    if (hasChurchAccess) {
      backgroundTasks.push(new Promise((resolve) => {
        setTimeout(() => {
          void (async () => {
            try {
              await loadChurchSelector(headers);
            } catch (err) {
              console.error('Error cargando selector de iglesias:', err);
            }

            await Promise.allSettled([
              loadChurchBookings(headers),
              loadChurchParticipants(headers),
              loadChurchPayments(headers),
              loadChurchInstallments(headers),
              loadChurchMembers(headers),
            ]);
          })().finally(resolve);
        }, 0);
      }));
    }
    if (portalIsSuperadmin) {
      backgroundTasks.push(loadAdminUsers(headers));
    }
    if (portalIsAdmin) {
      backgroundTasks.push(loadAdminFollowups(headers));
    }
    if (hasChurchAccess && churchForm) {
      backgroundTasks.push(loadChurchDraft());
    }

    void Promise.allSettled(backgroundTasks).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error('[portal.dashboard] background task failed', { index, reason: result.reason });
        }
      });
    });

    syncDeleteAccountAccess();

    if (authMode === 'password') {
      closePortalModal(onboardingModal);
      if (saveProfileBtn) {
        saveProfileBtn.disabled = true;
        saveProfileBtn.classList.add('opacity-40', 'cursor-not-allowed');
      }
    } else if (!portalProfile?.full_name || !portalProfile?.affiliation_type) {
      showOnboarding();
    }
  } catch (err) {
    console.error(err);
    void reportPortalClientError('portal.dashboard.load', err, {
      sessionValidated,
      authMode,
      role: portalRole || null,
    });
    if (loadingEl && !loadingEl.classList.contains('hidden')) {
      loadingEl.classList.add('hidden');
      if (sessionValidated) {
        contentEl?.classList.remove('hidden');
        errorEl?.classList.add('hidden');
      } else {
        errorEl?.classList.remove('hidden');
      }
    }
  }
}

function setupInviteAccess() {
  if (!inviteCard) return;
  const profileRole = portalProfile?.role || 'user';
  const membershipRoles = (portalMemberships || []).map((m) => m?.role);
  const canInvite = Boolean(portalPermissions.can_register_people)
    || ['admin', 'superadmin', 'national_pastor', 'pastor'].includes(profileRole)
    || membershipRoles.includes('church_admin');
  if (!canInvite) {
    inviteCard.classList.add('hidden');
    return;
  }
  inviteCard.classList.remove('hidden');
  const canInvitePastor = ['admin', 'superadmin', 'national_pastor'].includes(profileRole);
  if (canInvitePastor) {
    inviteChurchWrapper?.classList.remove('hidden');
    inviteRole?.querySelector('option[value="church_admin"]')?.removeAttribute('disabled');
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
  const fullNameValue = safeAttr(data.fullName || '');
  const ageValue = safeAttr(data.age || '');
  const relationshipValue = safeAttr(data.relationship || '');
  const documentNumberValue = safeAttr(data.documentNumber || '');
  const birthdateValue = safeAttr(data.birthdate || '');
  row.innerHTML = `
    <div class="flex items-center justify-between">
      <p class="text-xs font-bold text-[#293C74]">Persona ${churchParticipantsCount}</p>
      <button type="button" class="min-h-11 px-2 text-xs font-bold text-red-500 hover:underline" data-action="remove">Quitar</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input type="text" data-field="fullName" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Nombre completo" value="${fullNameValue}">
      <input type="number" min="0" data-field="age" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Edad" value="${ageValue}">
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <select data-field="lodging" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
        <option value="no">Sin alojamiento</option>
      </select>
      <select data-field="menuType" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
        <option value="">Tipo de menú</option>
        <option value="TRADICIONAL">Menú tradicional</option>
        <option value="VEGETARIANO">Menú vegetariano</option>
      </select>
      <input type="text" data-field="relationship" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Relación (ej: Hijo/a)" value="${relationshipValue}">
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="grid grid-cols-[110px_1fr] gap-2">
        <select data-field="documentType" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
          <option value="CC">CC</option>
          <option value="TI">TI</option>
          <option value="CE">CE</option>
          <option value="PASSPORT">Pasaporte</option>
        </select>
        <input type="text" data-field="documentNumber" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" placeholder="Documento" value="${documentNumberValue}">
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="date" data-field="birthdate" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium" value="${birthdateValue}">
        <select data-field="gender" class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-[#293C74] focus:border-[#293C74] focus:ring-1 focus:ring-[#293C74] outline-none transition-all font-medium">
          <option value="">Género</option>
          <option value="M">Masculino</option>
          <option value="F">Femenino</option>
        </select>
      </div>
    </div>
  `;
  const lodgingSelect = row.querySelector('[data-field="lodging"]');
  if (lodgingSelect) {
    lodgingSelect.value = data.packageType === 'lodging' || data.package_type === 'lodging' || data.lodging === 'yes'
      ? 'yes'
      : 'no';
  }
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
    const lodgingValue = getValue('lodging');
    participants.push({
      fullName: getValue('fullName'),
      age: ageValue,
      lodging: getValue('lodging') === 'yes' ? 'yes' : 'no',
      packageType: getValue('lodging') === 'yes' && ageValue > 10 ? 'lodging' : 'no_lodging',
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
    const res = await fetch('/api/portal/iglesia/selection', { headers, credentials: 'include' });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar iglesias');

    const churches = payload.churches || [];
    portalChurchesCatalog = enrichChurchCatalog(churches);

    // Update advanced church selector if it exists
    if (window.advancedChurchSelector && portalChurchesCatalog.length > 0) {
      window.advancedChurchSelector.setChurches(portalChurchesCatalog);
    }
    const canSelect = Boolean(payload.canSelect);
    const allowAll = Boolean(payload.allowAll);
    const allowCustom = Boolean(payload.allowCustom);
    const scope = payload.scope || 'church';
    portalScope = scope;
    portalCanSelectChurch = canSelect;
    portalAllowAllChurches = allowAll;
    portalAllowCustomChurch = allowCustom;
    portalSelectedChurchId = payload.selectedChurchId || '';
    portalIsCustomChurch = false;
    if (allowAll && !portalSelectedChurchId) {
      portalSelectedChurchId = ALL_CHURCHES_VALUE;
    }
    syncSelectorFiltersToCurrentSelection();
    ensureDefaultSelectorFilters();
    renderChurchSelectorOptions({ allowAll, allowCustom, scope });

    if (inviteChurchInput) {
      inviteChurchInput.innerHTML = '<option value="">Selecciona una iglesia</option>';
      portalChurchesCatalog.forEach((church) => {
        const option = document.createElement('option');
        option.value = church.id;
        option.textContent = buildChurchSelectorLabel(church);
        inviteChurchInput.appendChild(option);
      });
    }

    if (portalSelectedChurchId) {
      if (inviteChurchInput && resolveSelectedChurchId()) {
        inviteChurchInput.value = resolveSelectedChurchId();
      }
    } else if (portalChurchesCatalog.length === 1) {
      portalSelectedChurchId = portalChurchesCatalog[0].id;
      churchSelectorInput.value = portalSelectedChurchId;
      if (inviteChurchInput) inviteChurchInput.value = portalSelectedChurchId;
      await saveChurchSelection(portalSelectedChurchId, headers);
    }

    if (churchNameInput) {
      const resolvedId = resolveSelectedChurchId();
      if (resolvedId) {
        const selected = portalChurchesCatalog.find((item) => item.id === resolvedId);
        if (selected) {
          churchNameInput.value = selected.name;
          churchNameInput.setAttribute('readonly', 'readonly');
          churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
        }
      } else {
        churchNameInput.value = '';
        churchNameInput.removeAttribute('readonly');
        churchNameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
      }
    }

    if (canSelect && selectedOperationsEventId === CUMBRE_EVENT_ID) {
      churchSelector.classList.remove('hidden');
    } else {
      churchSelector.classList.add('hidden');
    }

    const emptyEl = document.getElementById('church-dashboard-empty');
    const contentEl = document.getElementById('church-dashboard-content');
    if (portalSelectedChurchId && portalSelectedChurchId !== CUSTOM_CHURCH_VALUE) {
      if (emptyEl) emptyEl.classList.add('hidden');
      if (contentEl) contentEl.removeAttribute('hidden');
    } else {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (contentEl) contentEl.setAttribute('hidden', '');
    }

    if (isAllChurchesSelected()) {
      churchSelectorStatus.textContent = scope === 'country'
        ? 'Mostrando todas las iglesias de tu país.'
        : 'Mostrando todos los registros (incluye sin iglesia / virtual).';
      if (!selectorCountryFilter && getFilteredChurchesForSelector().length > MAX_SELECTOR_OPTIONS_WITHOUT_COUNTRY) {
        churchSelectorStatus.textContent += ' Filtra por país para navegar más rápido.';
      }
    } else {
      churchSelectorStatus.textContent = churches.length ? 'Selecciona una iglesia para ver los registros.' : 'No hay iglesias disponibles.';
    }
  } catch (err) {
    console.error(err);
    churchSelectorStatus.textContent = 'No se pudo cargar iglesias.';
  }
}

// Church Selector: Change Event Listener
if (churchSelectorContinent) {
  churchSelectorContinent.addEventListener('change', () => {
    selectorContinentFilter = churchSelectorContinent.value || '';
    if (selectorCountryFilter) {
      const validCountries = getCountriesForSelector(selectorContinentFilter);
      if (!validCountries.includes(selectorCountryFilter)) {
        selectorCountryFilter = '';
      }
    }
    renderChurchSelectorOptions({
      allowAll: portalAllowAllChurches,
      allowCustom: portalAllowCustomChurch,
      scope: portalScope,
    });
  });
}

if (churchSelectorCountry) {
  churchSelectorCountry.addEventListener('change', () => {
    selectorCountryFilter = churchSelectorCountry.value || '';
    renderChurchSelectorOptions({
      allowAll: portalAllowAllChurches,
      allowCustom: portalAllowCustomChurch,
      scope: portalScope,
    });
  });
}

if (churchSelectorSearch) {
  churchSelectorSearch.addEventListener('input', () => {
    selectorSearchFilter = normalizeGeoToken(churchSelectorSearch.value || '');
    renderChurchSelectorOptions({
      allowAll: portalAllowAllChurches,
      allowCustom: portalAllowCustomChurch,
      scope: portalScope,
    });
  });
}

if (churchSelectorInput) {
  churchSelectorInput.addEventListener('change', async () => {
    const selectedChurchId = churchSelectorInput.value;

    if (selectedChurchId === CUSTOM_CHURCH_VALUE) {
      portalIsCustomChurch = true;
      portalSelectedChurchId = null;
      if (churchSelectorStatus) {
        churchSelectorStatus.textContent = 'Modo manual activo. Escribe el nombre de la iglesia.';
      }
      if (churchNameInput) {
        churchNameInput.removeAttribute('readonly');
        churchNameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
        churchNameInput.value = '';
        churchNameInput.focus();
      }
      return;
    }

    portalIsCustomChurch = false;
    if (selectedChurchId === ALL_CHURCHES_VALUE) {
      portalSelectedChurchId = ALL_CHURCHES_VALUE;
      await saveChurchSelection(null, portalAuthHeaders);
    } else if (selectedChurchId) {
      portalSelectedChurchId = selectedChurchId;
      const selected = portalChurchesCatalog.find((item) => item.id === selectedChurchId);
      if (selected) {
        selectorContinentFilter = selected.continent || selectorContinentFilter;
        selectorCountryFilter = selected.country || selectorCountryFilter;
      }
      await saveChurchSelection(selectedChurchId, portalAuthHeaders);
    } else {
      portalSelectedChurchId = null;
    }

    if (inviteChurchInput) {
      inviteChurchInput.value = resolveSelectedChurchId();
    }

    renderChurchSelectorOptions({
      allowAll: portalAllowAllChurches,
      allowCustom: portalAllowCustomChurch,
      scope: portalScope,
    });

    const emptyEl = document.getElementById('church-dashboard-empty');
    const contentEl = document.getElementById('church-dashboard-content');
    if (selectedChurchId === ALL_CHURCHES_VALUE || selectedChurchId) {
      if (emptyEl) emptyEl.classList.add('hidden');
      if (contentEl) contentEl.removeAttribute('hidden');

      await Promise.all([
        loadChurchBookings(portalAuthHeaders),
        loadChurchParticipants(portalAuthHeaders),
        loadChurchInstallments(portalAuthHeaders),
        loadChurchPayments(portalAuthHeaders),
        loadChurchMembers(portalAuthHeaders),
      ]).catch((err) => console.error('Error loading church data:', err));

      updateChurchStats();
    } else {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (contentEl) contentEl.setAttribute('hidden', '');
    }
  });
}

// Helper: Update Church Stats Cards
function updateChurchStats() {
  const totalParticipants = churchBookingsData.reduce((sum, booking) => {
    let count = Number(booking.participant_count || 0);
    if (!Number.isFinite(count) || count < 0) count = 0;
    return sum + count;
  }, 0);
  const totalPayments = (churchPaymentsData || []).length;
  const pendingInstallmentBookings = new Set(
    (churchInstallmentsData || [])
      .map((row) => row.booking_id || row.booking?.id)
      .filter(Boolean),
  );
  const pendingBalanceBookings = new Set();
  (churchBookingsData || []).forEach((booking) => {
    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    if (totalAmount > totalPaid) {
      pendingBalanceBookings.add(booking.id);
    }
  });
  const pendingBookings = new Set([...pendingInstallmentBookings, ...pendingBalanceBookings]);
  const pendingInstallments = pendingBookings.size;

  const totalEl = document.getElementById('stat-church-total');
  const paidEl = document.getElementById('stat-church-paid');
  const pendingEl = document.getElementById('stat-church-pending');

  if (totalEl) totalEl.textContent = totalParticipants;
  if (paidEl) paidEl.textContent = totalPayments;
  if (pendingEl) pendingEl.textContent = pendingInstallments;
}

async function saveChurchSelection(churchId, headers = {}) {
  if (!churchSelectorStatus) return;
  churchSelectorStatus.textContent = 'Guardando selección...';
  try {
    const res = await fetch('/api/portal/iglesia/selection', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ churchId }),
      credentials: 'include'
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar');
    portalSelectedChurchId = payload.churchId || '';
    if (!portalSelectedChurchId && portalAllowAllChurches && churchId === null) {
      portalSelectedChurchId = ALL_CHURCHES_VALUE;
    }
    churchSelectorStatus.textContent = isAllChurchesSelected()
      ? (portalScope === 'country' ? 'Mostrando todas las iglesias del país.' : 'Mostrando todas las iglesias.')
      : 'Iglesia seleccionada.';

    if (churchNameInput) {
      const resolvedId = resolveSelectedChurchId();
      if (resolvedId) {
        const selected = portalChurchesCatalog.find((item) => item.id === resolvedId);
        if (selected) {
          churchNameInput.value = selected.name;
          churchNameInput.setAttribute('readonly', 'readonly');
          churchNameInput.classList.add('bg-slate-100', 'cursor-not-allowed');
        }
      } else {
        churchNameInput.value = '';
        churchNameInput.removeAttribute('readonly');
        churchNameInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
      }
    }
  } catch (err) {
    console.error(err);
    churchSelectorStatus.textContent = err?.message || 'Error guardando selección.';
  }
}

function buildChurchBookingsMeta() {
  const lastPaymentByBooking = new Map();
  (churchPaymentsData || []).forEach((payment) => {
    if (!payment?.booking_id) return;
    const status = String(payment.status || '').toUpperCase();
    if (!PAID_PAYMENT_STATUSES.has(status)) return;
    const createdAt = toDate(payment.created_at);
    const existing = lastPaymentByBooking.get(payment.booking_id);
    if (!existing || (createdAt && existing._createdAt && createdAt > existing._createdAt) || (createdAt && !existing._createdAt)) {
      lastPaymentByBooking.set(payment.booking_id, { ...payment, _createdAt: createdAt });
    }
  });

  const nextInstallmentByBooking = new Map();
  (churchInstallmentsData || []).forEach((installment) => {
    const bookingId = installment.booking_id || installment.booking?.id;
    if (!bookingId) return;
    const dueDate = toDate(installment.due_date);
    const existing = nextInstallmentByBooking.get(bookingId);
    if (!existing) {
      nextInstallmentByBooking.set(bookingId, { ...installment, _dueDate: dueDate });
      return;
    }
    if (dueDate && (!existing._dueDate || dueDate < existing._dueDate)) {
      nextInstallmentByBooking.set(bookingId, { ...installment, _dueDate: dueDate });
    }
  });

  return { lastPaymentByBooking, nextInstallmentByBooking };
}

function filterChurchBookings(list, meta) {
  const query = churchBookingsSearch?.value?.trim().toLowerCase() || '';
  const rawStatus = churchBookingsStatus?.value || '';
  const status = rawStatus === 'all' ? '' : rawStatus;
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
    if (status) {
      if (status === 'paid') {
        if (!meta?.lastPaymentByBooking?.has(item.id)) return false;
      } else if (status === 'pending') {
        const totalAmount = Number(item.total_amount || 0);
        const totalPaid = Number(item.total_paid || 0);
        const hasPendingBalance = totalAmount > totalPaid;
        if (!meta?.nextInstallmentByBooking?.has(item.id) && !hasPendingBalance) return false;
      } else if (item.status !== status) {
        return false;
      }
    }
    return true;
  });
}

function getChurchBookingsSortOption(activeStatus = 'all') {
  const selected = churchBookingsSort?.value || '';
  if (selected) return selected;
  if (activeStatus === 'pending') return 'next_due_asc';
  if (activeStatus === 'paid') return 'recent_desc';
  return 'recent_desc';
}

function getChurchBookingsPageSize() {
  const raw = Number(churchBookingsPageSize?.value || DEFAULT_CHURCH_BOOKINGS_PAGE_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHURCH_BOOKINGS_PAGE_SIZE;
  return raw;
}

function sortChurchBookings(list, meta, status, sortOption) {
  const normalizedStatus = status || 'all';
  const normalizedSort = sortOption || getChurchBookingsSortOption(normalizedStatus);
  const items = [...(list || [])];
  items.sort((a, b) => {
    const lastPaymentA = meta?.lastPaymentByBooking?.get(a.id)?._createdAt || null;
    const lastPaymentB = meta?.lastPaymentByBooking?.get(b.id)?._createdAt || null;
    const nextDueA = meta?.nextInstallmentByBooking?.get(a.id)?._dueDate || null;
    const nextDueB = meta?.nextInstallmentByBooking?.get(b.id)?._dueDate || null;
    const createdA = toDate(a.created_at)?.getTime() || 0;
    const createdB = toDate(b.created_at)?.getTime() || 0;
    const totalPaidA = Number(a.total_paid || 0);
    const totalPaidB = Number(b.total_paid || 0);
    const totalAmountA = Number(a.total_amount || 0);
    const totalAmountB = Number(b.total_amount || 0);
    const pendingA = Math.max(0, totalAmountA - totalPaidA);
    const pendingB = Math.max(0, totalAmountB - totalPaidB);
    const nextDueTimeA = nextDueA ? nextDueA.getTime() : Number.POSITIVE_INFINITY;
    const nextDueTimeB = nextDueB ? nextDueB.getTime() : Number.POSITIVE_INFINITY;
    const lastPaymentTimeA = lastPaymentA ? lastPaymentA.getTime() : 0;
    const lastPaymentTimeB = lastPaymentB ? lastPaymentB.getTime() : 0;
    const recencyA = lastPaymentTimeA || createdA;
    const recencyB = lastPaymentTimeB || createdB;
    const activityA = Math.max(recencyA, nextDueA ? nextDueA.getTime() : 0);
    const activityB = Math.max(recencyB, nextDueB ? nextDueB.getTime() : 0);

    if (normalizedSort === 'recent_asc') return recencyA - recencyB;
    if (normalizedSort === 'paid_desc') return totalPaidB - totalPaidA;
    if (normalizedSort === 'total_desc') return totalAmountB - totalAmountA;
    if (normalizedSort === 'pending_desc') return pendingB - pendingA;
    if (normalizedSort === 'next_due_asc') return nextDueTimeA - nextDueTimeB;
    if (normalizedSort === 'recent_desc') return recencyB - recencyA;

    if (normalizedStatus === 'pending') {
      return nextDueTimeA - nextDueTimeB;
    }
    if (normalizedStatus === 'paid') {
      return lastPaymentTimeB - lastPaymentTimeA;
    }
    return activityB - activityA;
  });
  return items;
}

function paginateChurchBookings(list) {
  const safeList = list || [];
  const pageSize = getChurchBookingsPageSize();
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (churchBookingsPage > totalPages) churchBookingsPage = totalPages;
  if (churchBookingsPage < 1) churchBookingsPage = 1;
  const start = (churchBookingsPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: safeList.slice(start, end),
    total,
    pageSize,
    totalPages,
    page: churchBookingsPage,
    start,
    end,
  };
}

function renderChurchBookingsPagination(meta) {
  if (!churchBookingsPagination) return;
  if (!meta || meta.total <= 0) {
    churchBookingsPagination.innerHTML = '';
    churchBookingsPagination.classList.add('hidden');
    return;
  }

  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  const safeStart = meta.start + 1;
  const safeEnd = meta.end;
  churchBookingsPagination.innerHTML = `
    <span class="font-medium text-slate-500">Mostrando ${safeStart}-${safeEnd} de ${meta.total}</span>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button type="button" class="church-bookings-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page - 1}" ${canPrev ? '' : 'disabled'}>
        Anterior
      </button>
      <span class="whitespace-nowrap text-[11px] font-semibold text-slate-500">Página ${meta.page} / ${meta.totalPages}</span>
      <button type="button" class="church-bookings-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page + 1}" ${canNext ? '' : 'disabled'}>
        Siguiente
      </button>
    </div>
  `;
  churchBookingsPagination.classList.remove('hidden');

  churchBookingsPagination.querySelectorAll('.church-bookings-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.page || 0);
      if (!Number.isFinite(next) || next < 1 || next > meta.totalPages) return;
      churchBookingsPage = next;
      updateChurchBookingsView();
    });
  });
}

function renderChurchBookings(list, meta) {
  if (!churchBookingsList || !churchBookingsEmpty) return;
  churchBookingsList.innerHTML = '';
  if (churchBookingsCount) {
    churchBookingsCount.textContent = '0 resultados';
  }
  if (churchBookingsPagination) {
    churchBookingsPagination.innerHTML = '';
    churchBookingsPagination.classList.add('hidden');
  }
  if (!list.length) {
    churchBookingsEmpty.classList.remove('hidden');
    churchBookingsList.classList.add('hidden');
    return;
  }
  churchBookingsEmpty.classList.add('hidden');
  churchBookingsList.classList.remove('hidden');
  const activeFilter = churchBookingsStatus?.value || 'all';
  const sortOption = getChurchBookingsSortOption(activeFilter);
  const sortedList = sortChurchBookings(list, meta, activeFilter, sortOption);
  const paginated = paginateChurchBookings(sortedList);
  if (churchBookingsCount) {
    churchBookingsCount.textContent = `${paginated.total} resultado${paginated.total === 1 ? '' : 's'}`;
  }

  paginated.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md transition-shadow';
    const churchName = item.contact_church || (isAllChurchesSelected() ? 'Sin iglesia / virtual' : 'Sin iglesia');
    const safeChurchName = safeText(churchName);
    const churchLabel = `<p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1 truncate">${safeChurchName}</p>`;

    // Status Logic
    const isPaidFull = item.is_paid_full || item.status === 'PAID' || Number(item.total_paid || 0) >= Number(item.total_amount || 0);
    const paymentMethod = item.payment_type
      || ((item.payment_method === 'cash' || item.payment_method === 'manual') ? 'Físico' : 'Online');
    const lastPayment = meta?.lastPaymentByBooking?.get(item.id) || null;
    const nextInstallment = meta?.nextInstallmentByBooking?.get(item.id) || null;
    const pendingFallback = Math.max(0, Number(item.total_amount || 0) - Number(item.total_paid || 0));
    const pendingAmount = Number(nextInstallment?.amount || pendingFallback || 0);
    const pendingCurrency = nextInstallment?.currency || item.currency;

    // Badges
    const statusBadge = isPaidFull
      ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-wide border border-green-100">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
             Completo
           </span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-50 text-yellow-700 text-[10px] font-bold uppercase tracking-wide border border-yellow-100">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
             Abono
           </span>`;

    const methodBadge = paymentMethod === 'Físico'
      ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wide border border-slate-200">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
             Físico
           </span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 text-purple-700 text-[10px] font-bold uppercase tracking-wide border border-purple-100">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
             Online
           </span>`;

    const lastPaymentLabel = lastPayment
      ? `${formatCurrency(lastPayment.amount, lastPayment.currency || item.currency)} · ${formatDate(lastPayment.created_at)}`
      : '—';
    const nextInstallmentLabel = nextInstallment
      ? `${formatCurrency(nextInstallment.amount, nextInstallment.currency || item.currency)} · ${formatDate(nextInstallment.due_date)}`
      : (pendingAmount > 0 ? `${formatCurrency(pendingAmount, pendingCurrency)} · Sin fecha` : '—');
    const safeLastPaymentLabel = safeText(lastPaymentLabel);
    const safeNextInstallmentLabel = safeText(nextInstallmentLabel);

    let primaryLabel = 'Pagado';
    let primaryValue = formatCurrency(item.total_paid, item.currency);
    let secondaryLabel = 'Total';
    let secondaryValue = formatCurrency(item.total_amount, item.currency);

    if (activeFilter === 'paid' && lastPayment) {
      primaryLabel = 'Último abono';
      primaryValue = formatCurrency(lastPayment.amount, lastPayment.currency || item.currency);
    } else if (activeFilter === 'pending') {
      primaryLabel = 'Pendiente';
      primaryValue = formatCurrency(pendingAmount, pendingCurrency);
      secondaryLabel = 'Pagado';
      secondaryValue = formatCurrency(item.total_paid, item.currency);
    }
    const safePrimaryLabel = safeText(primaryLabel);
    const safePrimaryValue = safeText(primaryValue);
    const safeSecondaryLabel = safeText(secondaryLabel);
    const safeSecondaryValue = safeText(secondaryValue);

    const metaParts = [];
    if (lastPayment) {
      metaParts.push(`
        <span class="inline-flex items-center gap-2">
          <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Último abono</span>
          <span class="text-slate-600">${safeLastPaymentLabel}</span>
        </span>
      `);
    }
    if (nextInstallment || pendingAmount > 0) {
      metaParts.push(`
        <span class="inline-flex items-center gap-2">
          <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Próxima cuota</span>
          <span class="text-slate-600">${safeNextInstallmentLabel}</span>
        </span>
      `);
    }
    const metaHtml = metaParts.length ? `<div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">${metaParts.join('')}</div>` : '';
    const referenceLabel = (item.reference || item.id || '').toString().slice(0, 8).toUpperCase();
    const safeReferenceLabel = safeText(referenceLabel);
    const contactLabel = item.contact_name || item.contact_email || 'Participante';
    const safeContactLabel = safeText(contactLabel);
    const createdLabel = formatDateTime(item.created_at);
    const safeCreatedLabel = safeText(createdLabel);
    const safeItemId = safeAttr(item.id || '');
    const canEdit = Boolean(item.id);

    card.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex-1 min-w-0">
          ${churchLabel}
          <div class="flex items-center gap-2 mb-1">
             <p class="text-sm font-bold text-[#293C74]">#${safeReferenceLabel}</p>
             <span class="text-xs text-slate-400">•</span>
             <p class="text-xs font-semibold text-slate-700 truncate">${safeContactLabel}</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            ${statusBadge}
            ${methodBadge}
          </div>
        </div>
        
        <div class="flex items-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4 mt-2 md:mt-0 flex-wrap md:flex-nowrap">
            <div class="text-right">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">${safePrimaryLabel}</p>
              <p class="text-sm font-bold text-brand-teal">${safePrimaryValue}</p>
            </div>
            <div class="text-right">
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">${safeSecondaryLabel}</p>
              <p class="text-sm font-bold text-[#293C74]">${safeSecondaryValue}</p>
            </div>
        </div>
      </div>
      ${metaHtml}
      
      <div class="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-400">
         <span class="flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            ${item.participant_count || 0} inscritos
         </span>
         <span>Registro: ${safeCreatedLabel}</span>
      </div>
      ${canEdit ? `
        <div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
          <button type="button" class="btn-view-booking min-h-11 w-full sm:w-auto px-4 py-2 rounded-lg border border-slate-200 text-[#293C74] text-xs font-bold hover:bg-slate-50" data-booking-id="${safeItemId}">
            Ver detalle
          </button>
          <button type="button" class="btn-edit-booking min-h-11 w-full sm:w-auto px-4 py-2 rounded-lg border border-brand-teal text-brand-teal text-xs font-bold hover:bg-brand-teal/10" data-booking-id="${safeItemId}">
            Editar perfil
          </button>
        </div>
      ` : ''}
    `;
    churchBookingsList.appendChild(card);
  });

  churchBookingsList.querySelectorAll('.btn-view-booking').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bookingId = btn.dataset.bookingId;
      if (bookingId) {
        openBookingInspectorModal(bookingId);
      }
    });
  });

  churchBookingsList.querySelectorAll('.btn-edit-booking').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bookingId = btn.dataset.bookingId;
      if (bookingId) {
        openEditBookingModal(bookingId);
      }
    });
  });

  renderChurchBookingsPagination(paginated);

  // Update stats after rendering
  updateChurchStats();
}

function updateChurchBookingsView(options = {}) {
  const resetPage = Boolean(options.resetPage);
  if (resetPage) {
    churchBookingsPage = 1;
  }
  const meta = buildChurchBookingsMeta();
  const filtered = filterChurchBookings(churchBookingsData, meta);
  renderChurchBookings(filtered, meta);
}

function filterChurchParticipants(list) {
  const query = normalizeGeoToken(churchParticipantsSearch?.value || '');
  const payment = churchParticipantsPayment?.value || '';
  const lodging = churchParticipantsLodging?.value || '';
  const menu = churchParticipantsMenu?.value || '';
  const alert = churchParticipantsAlert?.value || '';

  return (list || []).filter((item) => {
    const searchable = [
      item.participant_name,
      item.titular_reserva,
      item.responsable_grupo,
      item.document_type,
      item.document_number,
      item.email,
      item.phone,
      item.nationality,
      item.city,
      item.church_final,
      item.church_catalog,
      item.church_input,
      item.booking_ref,
      item.booking_id,
      item.payment_type,
      item.booking_status,
      item.last_payment_at,
      item.next_due_date,
    ].filter(Boolean).map(normalizeGeoToken).join(' ');

    if (query && !searchable.includes(query)) return false;
    if (payment === 'full' && !item.is_paid_full) return false;
    if (payment === 'pending' && Number(item.pending_amount || 0) <= 0) return false;
    if (payment === 'recent' && !item.last_payment_at) return false;
    if (lodging && item.package_label !== lodging) return false;
    if (menu && item.diet_label !== menu) return false;
    if (alert === 'with' && !item.package_issue) return false;
    if (alert === 'corrected' && item.package_issue !== 'CORREGIDO_EN_EXPORT_POR_TOTAL') return false;
    if (alert === 'review' && (!item.package_issue || item.package_issue === 'CORREGIDO_EN_EXPORT_POR_TOTAL')) return false;
    return true;
  });
}

function getChurchParticipantsPageSize() {
  const raw = Number(churchParticipantsPageSize?.value || DEFAULT_CHURCH_PARTICIPANTS_PAGE_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHURCH_PARTICIPANTS_PAGE_SIZE;
  return raw;
}

function getChurchParticipantsViewMode() {
  return churchParticipantsViewMode === 'table' ? 'table' : 'cards';
}

function setChurchParticipantsViewMode(mode) {
  churchParticipantsViewMode = mode === 'table' ? 'table' : 'cards';
  churchParticipantsViewToggle?.querySelectorAll('.church-participants-view-btn').forEach((btn) => {
    const isActive = btn.dataset.view === churchParticipantsViewMode;
    btn.classList.toggle('bg-[#293C74]', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('shadow-sm', isActive);
    btn.classList.toggle('text-slate-500', !isActive);
  });
}

function getParticipantActivityTime(item) {
  const lastPayment = toDate(item?.last_payment_at)?.getTime() || 0;
  const created = toDate(item?.created_at)?.getTime() || 0;
  return lastPayment || created;
}

function getChurchParticipantsSortOption() {
  return churchParticipantsSort?.value || 'recent_payment_desc';
}

function sortChurchParticipants(list) {
  const items = [...(list || [])];
  const sortOption = getChurchParticipantsSortOption();
  items.sort((a, b) => {
    const activityA = getParticipantActivityTime(a);
    const activityB = getParticipantActivityTime(b);
    const createdA = toDate(a?.created_at)?.getTime() || 0;
    const createdB = toDate(b?.created_at)?.getTime() || 0;
    const paidA = Number(a?.total_paid || 0);
    const paidB = Number(b?.total_paid || 0);
    const pendingA = Number(a?.pending_amount || 0);
    const pendingB = Number(b?.pending_amount || 0);
    const nameA = String(a?.participant_name || '').localeCompare(String(b?.participant_name || ''), 'es');
    const lodgingA = String(a?.package_label || '').localeCompare(String(b?.package_label || ''), 'es');
    const menuA = String(a?.diet_label || '').localeCompare(String(b?.diet_label || ''), 'es');

    if (sortOption === 'name_asc') return nameA;
    if (sortOption === 'created_desc') return createdB - createdA || nameA;
    if (sortOption === 'lodging_asc') return lodgingA || nameA;
    if (sortOption === 'menu_asc') return menuA || nameA;
    if (sortOption === 'paid_desc') return paidB - paidA || activityB - activityA;
    if (sortOption === 'pending_desc') return pendingB - pendingA || activityB - activityA;
    return activityB - activityA || nameA;
  });
  return items;
}

function paginateChurchParticipants(list) {
  const safeList = list || [];
  const pageSize = getChurchParticipantsPageSize();
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (churchParticipantsPage > totalPages) churchParticipantsPage = totalPages;
  if (churchParticipantsPage < 1) churchParticipantsPage = 1;
  const start = (churchParticipantsPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: safeList.slice(start, end),
    total,
    pageSize,
    totalPages,
    page: churchParticipantsPage,
    start,
    end,
  };
}

function getParticipantPackageBadge(item) {
  const label = item?.package_label || '-';
  const className = label === 'Con alojamiento'
    ? 'bg-[#293C74]/10 text-[#293C74] border-[#293C74]/10'
    : label === 'Sin alojamiento'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : 'bg-sky-50 text-sky-700 border-sky-100';
  return `<span class="inline-flex px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${className}">${safeText(label)}</span>`;
}

function getParticipantAlertBadge(issue) {
  if (!issue) {
    return '<span class="text-[11px] text-slate-400">-</span>';
  }
  const isCorrected = issue === 'CORREGIDO_EN_EXPORT_POR_TOTAL';
  const className = isCorrected
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100';
  const label = isCorrected ? 'Corregido export' : 'Revisar';
  return `<span class="inline-flex px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${className}" title="${safeAttr(issue)}">${safeText(label)}</span>`;
}

function getParticipantPaymentBadge(item) {
  const isFull = Boolean(item?.is_paid_full);
  const className = isFull
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-amber-50 text-amber-700 border-amber-100';
  const label = isFull ? 'Completo' : 'Con saldo';
  return `<span class="inline-flex px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${className}">${safeText(label)}</span>`;
}

function getParticipantPaymentMethodBadge(item) {
  const label = item?.payment_type || 'Online';
  const isPhysical = normalizeGeoToken(label).includes('fisico');
  const className = isPhysical
    ? 'bg-slate-100 text-slate-600 border-slate-200'
    : 'bg-purple-50 text-purple-700 border-purple-100';
  const icon = isPhysical
    ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>';
  return `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${className}">${icon}${safeText(label)}</span>`;
}

function getParticipantMenuBadge(item) {
  const label = item?.diet_label || '-';
  return `<span class="inline-flex px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-600 text-[10px] font-bold uppercase tracking-widest">${safeText(label)}</span>`;
}

function renderChurchParticipantsPagination(meta) {
  if (!churchParticipantsPagination) return;
  if (!meta || meta.total <= 0) {
    churchParticipantsPagination.innerHTML = '';
    churchParticipantsPagination.classList.add('hidden');
    return;
  }

  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  const safeStart = meta.start + 1;
  const safeEnd = meta.end;
  churchParticipantsPagination.innerHTML = `
    <span class="font-medium text-slate-500">Mostrando ${safeStart}-${safeEnd} de ${meta.total}</span>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button type="button" class="church-participants-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page - 1}" ${canPrev ? '' : 'disabled'}>
        Anterior
      </button>
      <span class="whitespace-nowrap text-[11px] font-semibold text-slate-500">Página ${meta.page} / ${meta.totalPages}</span>
      <button type="button" class="church-participants-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page + 1}" ${canNext ? '' : 'disabled'}>
        Siguiente
      </button>
    </div>
  `;
  churchParticipantsPagination.classList.remove('hidden');

  churchParticipantsPagination.querySelectorAll('.church-participants-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.page || 0);
      if (!Number.isFinite(next) || next < 1 || next > meta.totalPages) return;
      churchParticipantsPage = next;
      updateChurchParticipantsView();
    });
  });
}

function renderChurchParticipantsTableRows(items) {
  const rows = (items || []).map((item) => {
    const safeBookingId = safeAttr(item.booking_id || '');
    const participantCountLabel = Number(item.participant_count || 0) > 1
      ? `${item.participant_count} inscritos`
      : 'Individual';
    const groupOwner = item.responsable_grupo || item.titular_reserva || 'Responsable';
    const groupLabel = Number(item.participant_count || 0) > 1
      ? item.is_payment_owner
        ? `Responsable del grupo · ${participantCountLabel}`
        : `Pertenece al grupo de ${groupOwner} · ${participantCountLabel}`
      : participantCountLabel;
    const docLabel = [item.document_type, item.document_number].filter(Boolean).join(' ') || '-';
    const ageLabel = item.age != null ? `${item.age} años` : 'Edad n/d';
    const originLabel = [item.city, item.nationality].filter(Boolean).join(' · ') || '-';
    const churchLabel = item.church_final || item.church_input || '-';
    const contactLine = [item.email, item.phone].filter(Boolean).join(' · ') || 'Sin contacto';
    const totalPaidLabel = formatCurrency(item.total_paid, item.currency);
    const totalAmountLabel = formatCurrency(item.total_amount, item.currency);
    const pendingAmount = Number(item.pending_amount || 0);
    const pendingLabel = pendingAmount > 0 ? formatCurrency(pendingAmount, item.currency) : 'Sin saldo';
    const lastPaymentLabel = item.last_payment_at
      ? `${formatCurrency(item.last_payment_amount, item.last_payment_currency || item.currency)} · ${formatDate(item.last_payment_at)}`
      : 'Sin abono aprobado';
    const nextDueLabel = item.next_due_date
      ? `${formatCurrency(item.next_due_amount, item.next_due_currency || item.currency)} · ${formatDate(item.next_due_date)}`
      : pendingAmount > 0
        ? `${formatCurrency(pendingAmount, item.currency)} · Sin fecha`
        : '—';
    const registeredLabel = item.created_at ? formatDateTime(item.created_at) : '-';
    const packageOriginal = item.package_original_type && item.package_original_type !== item.package_type
      ? `Original: ${item.package_original_type}`
      : '';

    return `
      <tr class="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
        <td class="min-w-[190px] px-4 py-3 align-top">
          <p class="text-sm font-black text-[#293C74]">#${safeText(item.booking_ref || '')}</p>
          <p class="text-[11px] font-semibold text-slate-500">${safeText(item.reserva_tipo || '')} · ${safeText(participantCountLabel)}</p>
          <p class="mt-1 text-[11px] text-slate-500">Titular: ${safeText(item.titular_reserva || '-')}</p>
          <p class="text-[11px] text-slate-500">Responsable: ${safeText(item.responsable_grupo || '-')}</p>
        </td>
        <td class="min-w-[240px] px-4 py-3 align-top">
          <p class="text-sm font-bold text-slate-800">${safeText(item.participant_name || '-')}</p>
          <p class="mt-1 text-[11px] font-semibold text-brand-teal">${safeText(groupLabel)}</p>
          <p class="text-[11px] text-slate-500">${safeText(item.relationship || 'Sin relación registrada')}</p>
        </td>
        <td class="min-w-[160px] px-4 py-3 align-top">
          <p class="text-xs font-bold text-slate-700">${safeText(docLabel)}</p>
          <p class="text-[11px] text-slate-500">${safeText(ageLabel)}${item.birthdate ? ` · ${safeText(item.birthdate)}` : ''}</p>
          <p class="text-[11px] text-slate-500">${safeText(item.gender || 'Sin género')}</p>
        </td>
        <td class="min-w-[240px] px-4 py-3 align-top">
          <p class="break-all text-xs font-semibold text-slate-700">${safeText(item.email || '-')}</p>
          <p class="break-words text-[11px] text-slate-500">${safeText(item.phone || '-')}</p>
        </td>
        <td class="min-w-[230px] px-4 py-3 align-top">
          <p class="break-words text-xs font-semibold text-slate-700">${safeText(originLabel)}</p>
          <p class="break-words text-[11px] text-slate-500">${safeText(churchLabel)}</p>
          <p class="text-[11px] text-slate-500">${safeText(item.registration_type || '')}</p>
        </td>
        <td class="min-w-[190px] px-4 py-3 align-top">
          <div class="flex flex-wrap gap-1.5">
            ${getParticipantPackageBadge(item)}
            ${getParticipantMenuBadge(item)}
          </div>
          ${packageOriginal ? `<p class="mt-1 text-[11px] text-slate-400">${safeText(packageOriginal)}</p>` : ''}
        </td>
        <td class="min-w-[190px] px-4 py-3 align-top">
          <div class="flex flex-wrap gap-1.5">
            ${getParticipantPaymentBadge(item)}
            ${getParticipantPaymentMethodBadge(item)}
          </div>
          <p class="mt-2 text-[11px] text-slate-600"><span class="font-bold">Pagado:</span> ${safeText(totalPaidLabel)}</p>
          <p class="text-[11px] text-slate-600"><span class="font-bold">Total:</span> ${safeText(totalAmountLabel)}</p>
          <p class="text-[11px] text-slate-600"><span class="font-bold">Saldo:</span> ${safeText(pendingLabel)}</p>
          <p class="text-[11px] text-slate-400">${safeText(item.booking_status || '')}</p>
        </td>
        <td class="min-w-[220px] px-4 py-3 align-top">
          <p class="text-[11px] text-slate-600"><span class="font-bold uppercase tracking-widest text-slate-400">Último:</span> ${safeText(lastPaymentLabel)}</p>
          <p class="mt-1 text-[11px] text-slate-600"><span class="font-bold uppercase tracking-widest text-slate-400">Próximo:</span> ${safeText(nextDueLabel)}</p>
          <p class="mt-1 text-[11px] text-slate-600"><span class="font-bold uppercase tracking-widest text-slate-400">Registro:</span> ${safeText(registeredLabel)}</p>
        </td>
        <td class="min-w-[150px] px-4 py-3 align-top">
          ${getParticipantAlertBadge(item.package_issue)}
          ${item.package_issue ? `<p class="mt-1 break-words text-[10px] text-slate-400">${safeText(item.package_issue)}</p>` : ''}
        </td>
        <td class="min-w-[150px] px-4 py-3 align-top">
          <div class="flex flex-col gap-2">
            <button type="button" class="btn-view-participant-booking min-h-11 px-3 py-2 rounded-lg border border-slate-200 bg-white text-[#293C74] text-xs font-bold hover:bg-slate-50 transition" data-booking-id="${safeBookingId}">
              Ver detalle
            </button>
            <button type="button" class="btn-edit-participant-booking min-h-11 px-3 py-2 rounded-lg border border-brand-teal text-brand-teal text-xs font-bold hover:bg-brand-teal/10 transition" data-booking-id="${safeBookingId}">
              Editar perfil
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="overflow-x-auto rounded-2xl border border-slate-100">
      <table class="min-w-[1900px] w-full text-left">
        <thead class="bg-slate-50">
          <tr class="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <th class="px-4 py-3">Reserva</th>
            <th class="px-4 py-3">Participante y grupo</th>
            <th class="px-4 py-3">Documento</th>
            <th class="px-4 py-3">Contacto</th>
            <th class="px-4 py-3">Origen / Iglesia</th>
            <th class="px-4 py-3">Alojamiento / Menú</th>
            <th class="px-4 py-3">Pago</th>
            <th class="px-4 py-3">Fechas</th>
            <th class="px-4 py-3">Alerta</th>
            <th class="px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody class="bg-white">${rows}</tbody>
      </table>
    </div>
  `;
}

function renderChurchParticipants(list) {
  if (!churchParticipantsTable || !churchParticipantsEmpty || !churchParticipantsTableWrap) return;
  churchParticipantsTable.innerHTML = '';
  if (churchParticipantsResultCount) {
    churchParticipantsResultCount.textContent = '0 resultados';
  }
  if (churchParticipantsPagination) {
    churchParticipantsPagination.innerHTML = '';
    churchParticipantsPagination.classList.add('hidden');
  }

  if (!list.length) {
    churchParticipantsEmpty.classList.remove('hidden');
    churchParticipantsTableWrap.classList.add('hidden');
    return;
  }

  churchParticipantsEmpty.classList.add('hidden');
  churchParticipantsTableWrap.classList.remove('hidden');
  const sortedList = sortChurchParticipants(list);
  const paginated = paginateChurchParticipants(sortedList);
  if (churchParticipantsResultCount) {
    churchParticipantsResultCount.textContent = `${paginated.total} resultado${paginated.total === 1 ? '' : 's'}`;
  }

  const viewMode = getChurchParticipantsViewMode();
  if (viewMode === 'table') {
    churchParticipantsTable.className = '';
    churchParticipantsTable.innerHTML = renderChurchParticipantsTableRows(paginated.items);
    churchParticipantsTable.querySelectorAll('.btn-view-participant-booking').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.bookingId;
        if (bookingId) openBookingInspectorModal(bookingId);
      });
    });

    churchParticipantsTable.querySelectorAll('.btn-edit-participant-booking').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.bookingId;
        if (bookingId) openEditBookingModal(bookingId);
      });
    });

    renderChurchParticipantsPagination(paginated);
    return;
  }

  churchParticipantsTable.className = 'space-y-3';
  churchParticipantsTable.innerHTML = paginated.items.map((item) => {
    const safeBookingId = safeAttr(item.booking_id || '');
    const ageLabel = item.age != null ? `${item.age} años` : 'Edad n/d';
    const docLabel = [item.document_type, item.document_number].filter(Boolean).join(' ') || '-';
    const originLabel = [item.city, item.nationality].filter(Boolean).join(' · ') || '-';
    const churchLabel = item.church_final || item.church_input || '-';
    const totalPaidLabel = formatCurrency(item.total_paid, item.currency);
    const totalAmountLabel = formatCurrency(item.total_amount, item.currency);
    const pendingAmount = Number(item.pending_amount || 0);
    const pendingLabel = Number(item.pending_amount || 0) > 0
      ? `Pendiente ${formatCurrency(item.pending_amount, item.currency)}`
      : 'Sin saldo';
    const lastPaymentLabel = item.last_payment_at
      ? `${formatCurrency(item.last_payment_amount, item.last_payment_currency || item.currency)} · ${formatDate(item.last_payment_at)}`
      : 'Sin abono aprobado';
    const nextDueLabel = item.next_due_date
      ? `${formatCurrency(item.next_due_amount, item.next_due_currency || item.currency)} · ${formatDate(item.next_due_date)}`
      : pendingAmount > 0
        ? `${formatCurrency(pendingAmount, item.currency)} · Sin fecha`
        : '—';
    const registeredLabel = item.created_at ? formatDateTime(item.created_at) : '-';
    const participantCountLabel = Number(item.participant_count || 0) > 1
      ? `${item.participant_count} inscritos`
      : 'Individual';
    const groupOwner = item.responsable_grupo || item.titular_reserva || 'Responsable';
    const groupLabel = Number(item.participant_count || 0) > 1
      ? item.is_payment_owner
        ? `Responsable del grupo · ${participantCountLabel}`
        : `Pertenece al grupo de ${groupOwner} · ${participantCountLabel}`
      : participantCountLabel;
    const groupBadgeClass = item.is_payment_owner
      ? 'bg-brand-teal/10 text-brand-teal border-brand-teal/20'
      : 'bg-slate-50 text-slate-600 border-slate-200';
    const alertBadge = item.package_issue ? getParticipantAlertBadge(item.package_issue) : '';
    const contactLine = [item.email, item.phone].filter(Boolean).join(' · ') || 'Sin contacto';
    return `
      <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
        <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_180px]">
          <div class="min-w-0">
            <p class="mb-1 break-words text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">${safeText(churchLabel)}</p>
            <div class="flex flex-wrap items-center gap-2">
              <p class="shrink-0 text-base md:text-lg font-black text-[#293C74]">#${safeText(item.booking_ref || '')}</p>
              <span class="text-slate-300">•</span>
              <p class="min-w-0 break-words text-sm md:text-base font-bold text-slate-700">${safeText(item.participant_name || '-')}</p>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              ${getParticipantPaymentBadge(item)}
              ${getParticipantPaymentMethodBadge(item)}
              ${getParticipantPackageBadge(item)}
              ${getParticipantMenuBadge(item)}
              ${alertBadge}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 rounded-xl bg-slate-50/70 p-3 text-left xl:grid-cols-1 xl:text-right">
            <div>
              <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Pagado</p>
              <p class="break-words text-sm font-black text-brand-teal">${safeText(totalPaidLabel)}</p>
            </div>
            <div>
              <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Total</p>
              <p class="break-words text-sm font-black text-[#293C74]">${safeText(totalAmountLabel)}</p>
            </div>
            <div>
              <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Saldo</p>
              <p class="break-words text-[11px] font-semibold text-slate-500">${safeText(pendingLabel)}</p>
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-3">
          <p class="min-w-0 text-slate-600">
            <span class="block text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Último abono</span>
            <span class="block break-words font-semibold">${safeText(lastPaymentLabel)}</span>
          </p>
          <p class="min-w-0 text-slate-600">
            <span class="block text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Próximo abono</span>
            <span class="block break-words font-semibold">${safeText(nextDueLabel)}</span>
          </p>
          <p class="min-w-0 text-slate-600">
            <span class="block text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Registro</span>
            <span class="block break-words font-semibold">${safeText(registeredLabel)}</span>
          </p>
        </div>

        <div class="mt-3 grid gap-3 border-t border-slate-100 pt-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div class="min-w-0">
            <div class="inline-flex max-w-full items-center rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${groupBadgeClass}" title="${safeAttr(groupLabel)}">
              <span class="truncate">${safeText(groupLabel)}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span class="min-w-0"><span class="font-bold text-slate-400 uppercase tracking-widest">Doc:</span> <span class="break-words font-semibold text-slate-700">${safeText(docLabel)}</span></span>
              <span class="min-w-0"><span class="font-bold text-slate-400 uppercase tracking-widest">Origen:</span> <span class="break-words font-semibold text-slate-700">${safeText(originLabel)}</span></span>
              <span class="min-w-0"><span class="font-bold text-slate-400 uppercase tracking-widest">Contacto:</span> <span class="break-all font-semibold text-slate-700">${safeText(contactLine)}</span></span>
              <span class="min-w-0 break-words text-slate-400">${safeText(ageLabel)}${item.gender ? ` · ${safeText(item.gender)}` : ''} · ${safeText(item.registration_type || '')}</span>
            </div>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row xl:justify-end">
            <button type="button" class="btn-view-participant-booking min-h-11 px-4 py-2 rounded-xl border border-slate-200 bg-white text-[#293C74] text-xs font-bold hover:bg-slate-50 transition" data-booking-id="${safeBookingId}">
              Ver detalle
            </button>
            <button type="button" class="btn-edit-participant-booking min-h-11 px-4 py-2 rounded-xl border border-brand-teal text-brand-teal text-xs font-bold hover:bg-brand-teal/10 transition" data-booking-id="${safeBookingId}">
              Editar perfil
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  churchParticipantsTable.querySelectorAll('.btn-view-participant-booking').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bookingId = btn.dataset.bookingId;
      if (bookingId) openBookingInspectorModal(bookingId);
    });
  });

  churchParticipantsTable.querySelectorAll('.btn-edit-participant-booking').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bookingId = btn.dataset.bookingId;
      if (bookingId) openEditBookingModal(bookingId);
    });
  });

  renderChurchParticipantsPagination(paginated);
}

function updateChurchParticipantsView(options = {}) {
  if (options.resetPage) {
    churchParticipantsPage = 1;
  }
  renderChurchParticipants(filterChurchParticipants(churchParticipantsData));
}

function updateChurchPaymentsView(options = {}) {
  if (options.resetPage) {
    churchPaymentsPage = 1;
  }
  updateChurchPaymentSummary(churchPaymentsData);
  const filtered = filterChurchPayments(churchPaymentsData);
  renderChurchPayments(filtered);
}

function updateChurchPaymentSummary(list) {
  const summary = (list || []).reduce((acc, payment) => {
    const status = String(payment?.status || 'PENDING').toUpperCase();
    const provider = String(payment?.provider || '').toLowerCase();
    const method = String(payment?.method || '').toLowerCase();
    if (PAID_PAYMENT_STATUSES.has(status)) acc.approved += 1;
    else if (status === 'PENDING') acc.pending += 1;
    if (provider === 'manual' || provider === 'cash' || method.includes('cash') || method.includes('efectivo')) acc.manual += 1;
    return acc;
  }, { approved: 0, pending: 0, manual: 0 });
  if (eventPaymentApproved) eventPaymentApproved.textContent = String(summary.approved);
  if (eventPaymentPending) eventPaymentPending.textContent = String(summary.pending);
  if (eventPaymentManual) eventPaymentManual.textContent = String(summary.manual);
}

function updateChurchInstallmentsView(options = {}) {
  if (options.resetPage) {
    churchInstallmentsPage = 1;
  }
  renderChurchInstallments(buildChurchInstallmentsView());
}

function resolveInstallmentChargeMode(item) {
  const plan = item?.plan || {};
  const provider = (plan.provider || '').toString().trim().toLowerCase();
  const hasWompiPaymentMethod = Boolean(plan.provider_payment_method_id);
  const hasStripeSubscription = Boolean(plan.provider_subscription_id);

  if (item?.is_balance_only && !provider) return 'OTHER';
  if (provider === 'wompi') return hasWompiPaymentMethod ? 'WOMPI_AUTO' : 'WOMPI_MANUAL';
  if (provider === 'stripe') return hasStripeSubscription ? 'STRIPE_AUTO' : 'STRIPE_MANUAL';
  if (provider === 'manual' || provider === 'cash' || provider === 'physical') return 'MANUAL_CASH';
  return 'OTHER';
}

function getInstallmentChargeMeta(mode) {
  const map = {
    WOMPI_AUTO: { label: 'Wompi automático', className: 'bg-emerald-100 text-emerald-700' },
    WOMPI_MANUAL: { label: 'Wompi manual', className: 'bg-amber-100 text-amber-700' },
    STRIPE_AUTO: { label: 'Stripe automático', className: 'bg-emerald-100 text-emerald-700' },
    STRIPE_MANUAL: { label: 'Stripe manual', className: 'bg-amber-100 text-amber-700' },
    MANUAL_CASH: { label: 'Manual / efectivo', className: 'bg-slate-100 text-slate-700' },
    OTHER: { label: 'Otro', className: 'bg-slate-100 text-slate-700' },
  };
  return map[mode] || map.OTHER;
}

function isInstallmentAutoCharge(item) {
  const mode = resolveInstallmentChargeMode(item);
  return mode === 'WOMPI_AUTO' || mode === 'STRIPE_AUTO';
}

function resolveBalanceProviderFromParticipant(item) {
  const registrationType = (item?.registration_type || '').toString().trim().toLowerCase();
  if (registrationType === 'local') return 'manual';
  return item?.currency === 'USD' ? 'stripe' : 'wompi';
}

function isInstallmentRemindable(item) {
  if (!item?.id) return false;
  if (item.is_balance_only) return false;
  if (isInstallmentAutoCharge(item)) return false;
  return ['PENDING', 'FAILED'].includes((item.status || '').toUpperCase());
}

function isInstallmentOverdue(item) {
  if (!isInstallmentRemindable(item)) return false;
  if (!item?.due_date) return false;
  const dueDate = toDate(item.due_date);
  if (!dueDate) return false;
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function updateChurchInstallmentsBulkReminderButton(list = []) {
  if (!churchInstallmentsRemindVisibleBtn) return;
  const remindableCount = (list || []).filter((item) => isInstallmentRemindable(item)).length;
  churchInstallmentsRemindVisibleBtn.textContent = remindableCount > 0
    ? `Recordar visibles (${remindableCount})`
    : 'Recordar visibles';
  if (remindableCount > 0) {
    churchInstallmentsRemindVisibleBtn.removeAttribute('disabled');
  } else {
    churchInstallmentsRemindVisibleBtn.setAttribute('disabled', 'disabled');
  }
}

function resolveBookingChurchForEdit(booking) {
  if (!booking) return null;
  if (booking.church_id) {
    const match = (portalChurchesCatalog || []).find((church) => church.id === booking.church_id);
    if (match) return match;
  }
  const manualName = (booking.contact_church || '').toString().trim();
  if (!manualName) {
    return { id: 'none', name: 'No asisto a ninguna iglesia', city: '', country: '', isSpecial: true };
  }
  if (/virtual/i.test(manualName)) {
    return {
      id: 'virtual',
      name: 'Ministerio Maná Virtual',
      city: '',
      country: booking.contact_country || '',
      isSpecial: true,
      isVirtual: true,
    };
  }
  return {
    id: 'MANUAL',
    name: manualName,
    manual_name: manualName,
    city: 'Manual',
    country: 'Manual',
    isSpecial: true,
    isManual: true,
  };
}

async function openEditBookingModal(bookingId) {
  try {
    const { registrationModal } = await ensureAdvancedComponents();
    if (!registrationModal) {
      showPortalAlert('El formulario de edición aún no está listo. Intenta nuevamente.', { title: 'Atención' });
      return;
    }
    const headers = typeof window.getPortalAuthHeaders === 'function'
      ? await window.getPortalAuthHeaders()
      : portalAuthHeaders;
    const res = await fetch(`/api/portal/iglesia/booking?bookingId=${encodeURIComponent(bookingId)}`, {
      headers,
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'No se pudo cargar el registro.');
    }
    const church = resolveBookingChurchForEdit(data.booking);
    registrationModal.loadBookingForEdit({ ...data, church });
  } catch (err) {
    console.error(err);
    showPortalAlert(err.message || 'No se pudo abrir la edición.');
  }
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

function getChurchPaymentsSortOption() {
  return churchPaymentsSort?.value || 'recent_desc';
}

function getChurchPaymentsPageSize() {
  const raw = Number(churchPaymentsPageSize?.value || DEFAULT_CHURCH_PAYMENTS_PAGE_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHURCH_PAYMENTS_PAGE_SIZE;
  return raw;
}

function sortChurchPayments(list) {
  const sortOption = getChurchPaymentsSortOption();
  const items = [...(list || [])];
  items.sort((a, b) => {
    const aDate = toDate(a.created_at)?.getTime() || 0;
    const bDate = toDate(b.created_at)?.getTime() || 0;
    const aAmount = Number(a.amount || 0);
    const bAmount = Number(b.amount || 0);
    if (sortOption === 'recent_asc') return aDate - bDate;
    if (sortOption === 'amount_desc') return bAmount - aAmount;
    return bDate - aDate;
  });
  return items;
}

function paginateChurchPayments(list) {
  const safeList = list || [];
  const pageSize = getChurchPaymentsPageSize();
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (churchPaymentsPage > totalPages) churchPaymentsPage = totalPages;
  if (churchPaymentsPage < 1) churchPaymentsPage = 1;
  const start = (churchPaymentsPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: safeList.slice(start, end),
    total,
    totalPages,
    page: churchPaymentsPage,
    start,
    end,
  };
}

function renderChurchPaymentsPagination(meta) {
  if (!churchPaymentsPagination) return;
  if (!meta || meta.total <= 0) {
    churchPaymentsPagination.innerHTML = '';
    churchPaymentsPagination.classList.add('hidden');
    return;
  }

  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  churchPaymentsPagination.innerHTML = `
    <span class="font-medium text-slate-500">Mostrando ${meta.start + 1}-${meta.end} de ${meta.total}</span>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button type="button" class="church-payments-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page - 1}" ${canPrev ? '' : 'disabled'}>
        Anterior
      </button>
      <span class="whitespace-nowrap text-[11px] font-semibold text-slate-500">Página ${meta.page} / ${meta.totalPages}</span>
      <button type="button" class="church-payments-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page + 1}" ${canNext ? '' : 'disabled'}>
        Siguiente
      </button>
    </div>
  `;
  churchPaymentsPagination.classList.remove('hidden');
  churchPaymentsPagination.querySelectorAll('.church-payments-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.page || 0);
      if (!Number.isFinite(next) || next < 1 || next > meta.totalPages) return;
      churchPaymentsPage = next;
      updateChurchPaymentsView();
    });
  });
}

function renderChurchPayments(list) {
  if (!churchPaymentsList || !churchPaymentsEmpty) return;
  churchPaymentsList.innerHTML = '';
  if (churchPaymentsCount) churchPaymentsCount.textContent = '0 resultados';
  if (churchPaymentsPagination) {
    churchPaymentsPagination.innerHTML = '';
    churchPaymentsPagination.classList.add('hidden');
  }
  if (!list.length) {
    churchPaymentsEmpty.classList.remove('hidden');
    churchPaymentsList.classList.add('hidden');
    return;
  }
  churchPaymentsEmpty.classList.add('hidden');
  churchPaymentsList.classList.remove('hidden');
  const sorted = sortChurchPayments(list);
  const paginated = paginateChurchPayments(sorted);
  if (churchPaymentsCount) {
    churchPaymentsCount.textContent = `${paginated.total} resultado${paginated.total === 1 ? '' : 's'}`;
  }

  paginated.items.forEach((payment) => {
    const booking = payment.booking || {};
    const providerLabel = payment.provider ? payment.provider.toUpperCase() : '—';
    const statusLabel = payment.status || 'PENDING';
    const methodLabel = payment.method || '—';
    const referenceLabel = (payment.reference || payment.id || '').toString();
    const safeProviderLabel = safeText(providerLabel);
    const safeStatusLabel = safeText(statusLabel);
    const safeMethodLabel = safeText(methodLabel);
    const safeReferenceLabel = safeText(referenceLabel.slice(0, 10).toUpperCase());
    const contactLabel = booking.contact_name || booking.contact_email || 'Sin nombre';
    const safeContactLabel = safeText(contactLabel);
    const safeContactEmail = booking.contact_email ? safeText(booking.contact_email) : '';
    const statusTone = PAID_PAYMENT_STATUSES.has(String(payment.status || '').toUpperCase())
      ? 'bg-emerald-50 text-emerald-700'
      : String(payment.status || '').toUpperCase() === 'PENDING'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-rose-50 text-rose-700';
    const card = document.createElement('div');
    card.className = 'grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center';
    card.innerHTML = `
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-sm font-bold text-[#293C74]">${safeText(formatCurrency(payment.amount, payment.currency))}</p>
          <span class="portal-chip ${statusTone}">${safeStatusLabel}</span>
        </div>
        <p class="mt-1 truncate text-xs font-semibold text-slate-700">${safeContactLabel}</p>
        ${safeContactEmail ? `<p class="truncate text-xs text-slate-500">${safeContactEmail}</p>` : ''}
      </div>
      <div class="min-w-0 sm:text-right">
        <p class="text-xs font-bold text-[#293C74]">#${safeReferenceLabel}</p>
        <p class="mt-1 text-xs text-slate-500">${safeText(formatDate(payment.created_at))}</p>
        <p class="mt-1 text-[11px] text-slate-400">${safeProviderLabel} · ${safeMethodLabel}</p>
      </div>
    `;
    churchPaymentsList.appendChild(card);
  });
  renderChurchPaymentsPagination(paginated);
}

function filterChurchInstallments(list) {
  const query = churchInstallmentsSearch?.value?.trim().toLowerCase() || '';
  const status = churchInstallmentsStatusFilter?.value || '';
  const charge = churchInstallmentsChargeFilter?.value || '';
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
    if (status === 'OVERDUE') {
      if (!isInstallmentOverdue(item)) return false;
    } else if (status && item.status !== status) {
      return false;
    }
    const chargeMode = resolveInstallmentChargeMode(item);
    if (charge && chargeMode !== charge) return false;
    return true;
  });
}

function buildChurchInstallmentsView() {
  const installmentBookingIds = new Set(
    (churchInstallmentsData || [])
      .map((row) => row.booking_id || row.booking?.id)
      .filter(Boolean),
  );
  const balanceBookingIds = new Set(installmentBookingIds);
  const pendingBalanceItems = (churchBookingsData || []).reduce((acc, booking) => {
    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    if (totalAmount > totalPaid && !balanceBookingIds.has(booking.id)) {
      balanceBookingIds.add(booking.id);
      acc.push({
        id: `balance-${booking.id}`,
        booking_id: booking.id,
        amount: Math.max(0, totalAmount - totalPaid),
        currency: booking.currency,
        status: 'PENDING',
        due_date: null,
        provider_reference: booking.reference || booking.id,
        booking,
        plan: null,
        is_balance_only: true,
      });
    }
    return acc;
  }, []);
  const participantBalanceItemsByBooking = new Map();

  (churchParticipantsData || []).forEach((participant) => {
    const bookingId = participant.booking_id;
    if (!bookingId || balanceBookingIds.has(bookingId)) return;

    const pendingAmount = Number(participant.pending_amount || 0);
    const totalPaid = Number(participant.total_paid || 0);
    const bookingStatus = (participant.booking_status || '').toString().trim().toUpperCase();
    if (pendingAmount <= 0 || (totalPaid <= 0 && bookingStatus !== 'DEPOSIT_OK' && bookingStatus !== 'PAID')) return;

    const existing = participantBalanceItemsByBooking.get(bookingId);
    if (existing && !participant.is_payment_owner) return;

    const provider = resolveBalanceProviderFromParticipant(participant);
    participantBalanceItemsByBooking.set(bookingId, {
      id: `balance-${bookingId}`,
      booking_id: bookingId,
      amount: pendingAmount,
      currency: participant.currency,
      status: 'PENDING',
      due_date: null,
      provider_reference: bookingId,
      booking: {
        id: bookingId,
        contact_name: participant.responsable_grupo || participant.titular_reserva || participant.participant_name,
        contact_email: participant.email,
        contact_phone: participant.phone,
        contact_church: participant.church_final || participant.church_input || participant.church_catalog,
        total_amount: participant.total_amount,
        total_paid: participant.total_paid,
        status: participant.booking_status,
        currency: participant.currency,
      },
      plan: {
        id: null,
        status: 'ACTIVE',
        provider,
        currency: participant.currency,
        installment_count: 1,
        provider_payment_method_id: null,
        provider_subscription_id: null,
      },
      is_balance_only: true,
    });

    if (participant.is_payment_owner) {
      balanceBookingIds.add(bookingId);
    }
  });

  const merged = [
    ...(churchInstallmentsData || []),
    ...pendingBalanceItems,
    ...Array.from(participantBalanceItemsByBooking.values()),
  ];
  const filtered = filterChurchInstallments(merged);
  filtered.sort((a, b) => {
    const aDate = toDate(a.due_date);
    const bDate = toDate(b.due_date);
    const aKey = aDate ? aDate.getTime() : Number.POSITIVE_INFINITY;
    const bKey = bDate ? bDate.getTime() : Number.POSITIVE_INFINITY;
    return aKey - bKey;
  });
  return filtered;
}

function getChurchInstallmentsPageSize() {
  const raw = Number(churchInstallmentsPageSize?.value || DEFAULT_CHURCH_INSTALLMENTS_PAGE_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHURCH_INSTALLMENTS_PAGE_SIZE;
  return raw;
}

function paginateChurchInstallments(list) {
  const safeList = list || [];
  const pageSize = getChurchInstallmentsPageSize();
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (churchInstallmentsPage > totalPages) churchInstallmentsPage = totalPages;
  if (churchInstallmentsPage < 1) churchInstallmentsPage = 1;
  const start = (churchInstallmentsPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: safeList.slice(start, end),
    total,
    totalPages,
    page: churchInstallmentsPage,
    start,
    end,
  };
}

function renderChurchInstallmentsPagination(meta) {
  if (!churchInstallmentsPagination) return;
  if (!meta || meta.total <= 0) {
    churchInstallmentsPagination.innerHTML = '';
    churchInstallmentsPagination.classList.add('hidden');
    return;
  }

  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  churchInstallmentsPagination.innerHTML = `
    <span class="font-medium text-slate-500">Mostrando ${meta.start + 1}-${meta.end} de ${meta.total}</span>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button type="button" class="church-installments-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page - 1}" ${canPrev ? '' : 'disabled'}>
        Anterior
      </button>
      <span class="whitespace-nowrap text-[11px] font-semibold text-slate-500">Página ${meta.page} / ${meta.totalPages}</span>
      <button type="button" class="church-installments-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page + 1}" ${canNext ? '' : 'disabled'}>
        Siguiente
      </button>
    </div>
  `;
  churchInstallmentsPagination.classList.remove('hidden');
  churchInstallmentsPagination.querySelectorAll('.church-installments-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.page || 0);
      if (!Number.isFinite(next) || next < 1 || next > meta.totalPages) return;
      churchInstallmentsPage = next;
      updateChurchInstallmentsView();
    });
  });
}

function renderChurchInstallments(list) {
  if (!churchInstallmentsList || !churchInstallmentsEmpty) return;
  churchInstallmentsList.innerHTML = '';
  if (churchInstallmentsCount) churchInstallmentsCount.textContent = '0 resultados';
  if (churchInstallmentsPagination) {
    churchInstallmentsPagination.innerHTML = '';
    churchInstallmentsPagination.classList.add('hidden');
  }
  if (!list.length) {
    churchInstallmentsEmpty.classList.remove('hidden');
    churchInstallmentsList.classList.add('hidden');
    updateChurchInstallmentsBulkReminderButton(list);
    return;
  }
  churchInstallmentsEmpty.classList.add('hidden');
  churchInstallmentsList.classList.remove('hidden');
  const paginated = paginateChurchInstallments(list);
  if (churchInstallmentsCount) {
    churchInstallmentsCount.textContent = `${paginated.total} resultado${paginated.total === 1 ? '' : 's'}`;
  }

  paginated.items.forEach((item) => {
    const booking = item.booking || {};
    const plan = item.plan || {};
    const chargeMode = resolveInstallmentChargeMode(item);
    const chargeMeta = getInstallmentChargeMeta(chargeMode);
    const statusLabel = item.status || 'PENDING';
    const statusClass = statusLabel === 'PAID'
      ? 'bg-green-100 text-green-700'
      : statusLabel === 'FAILED'
        ? 'bg-red-100 text-red-700'
        : 'bg-yellow-100 text-yellow-700';
    const amountLabel = formatCurrency(item.amount, item.currency || plan.currency || booking.currency);
    const dueLabel = item.due_date ? formatDate(item.due_date) : 'Sin fecha';
    const reminderLabel = item.last_reminder?.sent_at ? formatDateTime(item.last_reminder.sent_at) : '—';
    const linkLabel = item.last_link?.created_at ? formatDateTime(item.last_link.created_at) : '—';
    const isBalanceOnly = Boolean(item.is_balance_only);
    const isAutoCharge = isInstallmentAutoCharge(item);
    const safeStatusLabel = safeText(statusLabel);
    const safeAmountLabel = safeText(amountLabel);
    const safeDueLabel = safeText(dueLabel);
    const safeReminderLabel = safeText(reminderLabel);
    const safeLinkLabel = safeText(linkLabel);
    const safeChargeLabel = safeText(chargeMeta.label);
    const safeContactLabel = safeText(booking.contact_name || booking.contact_email || 'Sin nombre');
    const safeReference = safeText((item.provider_reference || item.id).toString().slice(0, 12).toUpperCase());
    const safeInstallmentId = safeAttr(item.id || '');
    const actionsHtml = isAutoCharge
        ? '<div class="text-xs font-semibold text-emerald-700">Cobro automático activo</div>'
        : `
          <button type="button" class="church-installment-action min-h-11 px-3 py-2 rounded-xl bg-[#293C74] text-white text-xs font-bold hover:shadow-md transition" data-action="copy-link" data-installment="${safeInstallmentId}">
            ${isBalanceOnly ? 'Crear link' : 'Copiar link'}
          </button>
          <button type="button" class="church-installment-action min-h-11 px-3 py-2 rounded-xl bg-white border border-slate-200 text-[#293C74] text-xs font-bold hover:bg-slate-50 transition" data-action="send-reminder" data-installment="${safeInstallmentId}">
            Enviar recordatorio
          </button>
        `;

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-4 py-4';
    card.innerHTML = `
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Cuota</p>
          <p class="text-sm font-bold text-[#293C74]">${safeAmountLabel}</p>
          <p class="text-xs text-slate-500">Vence: ${safeDueLabel}</p>
          <p class="text-xs text-slate-500">${safeContactLabel}</p>
          <p class="text-[11px] text-slate-400">Ref: ${safeReference}</p>
        </div>
        <div class="text-right space-y-2">
          <span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass}">${safeStatusLabel}</span>
          <span class="inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${chargeMeta.className}">${safeChargeLabel}</span>
          <div class="text-[11px] text-slate-400">Último link: ${safeLinkLabel}</div>
          <div class="text-[11px] text-slate-400">Último recordatorio: ${safeReminderLabel}</div>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        ${actionsHtml}
      </div>
    `;
    churchInstallmentsList.appendChild(card);
  });
  renderChurchInstallmentsPagination(paginated);
  updateChurchInstallmentsBulkReminderButton(list);
}

async function sendChurchInstallmentReminder(installmentId) {
  const headers = await getActionAuthHeaders();
  const res = await fetch('/api/portal/iglesia/installments/remind', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ installmentId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'No se pudo enviar');
  }
  return data;
}

async function loadChurchBookings(headers = {}) {
  ensureAllChurchesSelection();
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    if (churchBookingsEmpty && churchBookingsList) {
      churchBookingsEmpty.textContent = 'Selecciona una iglesia para ver los registros.';
      churchBookingsEmpty.classList.remove('hidden');
      churchBookingsList.classList.add('hidden');
    }
    churchBookingsData = [];
    updateChurchStats();
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/bookings', window.location.origin);
    const resolvedId = resolveSelectedChurchId();
    if (resolvedId) url.searchParams.set('churchId', resolvedId);
    const res = await fetch(url.toString(), { headers, credentials: 'include' });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchBookingsData = payload.bookings || [];
    updateChurchBookingsView({ resetPage: true });
    updateChurchInstallmentsView({ resetPage: true });
    updateChurchStats();
  } catch (err) {
    console.error(err);
  }
}

async function loadChurchParticipants(headers = {}) {
  if (!churchParticipantsTable || !churchParticipantsEmpty || !churchParticipantsTableWrap) return;
  ensureAllChurchesSelection();
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchParticipantsEmpty.textContent = 'Selecciona una iglesia para ver participantes.';
    churchParticipantsEmpty.classList.remove('hidden');
    churchParticipantsTableWrap.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/participants', window.location.origin);
    const resolvedId = resolveSelectedChurchId();
    if (resolvedId) url.searchParams.set('churchId', resolvedId);
    const res = await fetch(url.toString(), { headers, credentials: 'include' });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchParticipantsData = payload.participants || [];
    updateChurchParticipantsView({ resetPage: true });
    updateChurchInstallmentsView({ resetPage: true });
  } catch (err) {
    console.error(err);
    churchParticipantsData = [];
    churchParticipantsEmpty.textContent = err?.message || 'No se pudo cargar participantes.';
    churchParticipantsEmpty.classList.remove('hidden');
    churchParticipantsTableWrap.classList.add('hidden');
  }
}

async function loadChurchInstallments(headers = {}) {
  if (!churchInstallmentsList || !churchInstallmentsEmpty) return;
  ensureAllChurchesSelection();
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchInstallmentsEmpty.textContent = 'Selecciona una iglesia para ver las cuotas.';
    churchInstallmentsEmpty.classList.remove('hidden');
    churchInstallmentsList.classList.add('hidden');
    updateChurchInstallmentsBulkReminderButton([]);
    return;
  }
  try {
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = 'Cargando cuotas...';
    }
    const url = new URL('/api/portal/iglesia/installments', window.location.origin);
    const resolvedId = resolveSelectedChurchId();
    if (resolvedId) url.searchParams.set('churchId', resolvedId);
    const res = await fetch(url.toString(), { headers, credentials: 'include' });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchInstallmentsData = payload.installments || [];
    updateChurchInstallmentsView({ resetPage: true });
    updateChurchBookingsView();
    updateChurchStats();
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = '';
    }
  } catch (err) {
    console.error(err);
    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = err?.message || 'No se pudo cargar.';
    }
    updateChurchInstallmentsBulkReminderButton([]);
  }
}

async function loadChurchPayments(headers = {}) {
  if (!churchPaymentsList || !churchPaymentsEmpty) return;
  ensureAllChurchesSelection();
  if (portalIsAdmin && !portalSelectedChurchId && !portalIsCustomChurch) {
    churchPaymentsEmpty.textContent = 'Selecciona una iglesia para ver los pagos.';
    churchPaymentsEmpty.classList.remove('hidden');
    churchPaymentsList.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/payments', window.location.origin);
    const resolvedId = resolveSelectedChurchId();
    if (resolvedId) url.searchParams.set('churchId', resolvedId);
    const res = await fetch(url.toString(), { headers, credentials: 'include' });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    churchPaymentsData = payload.payments || [];
    updateChurchPaymentsView({ resetPage: true });
    updateChurchBookingsView();
    updateChurchStats();
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
    const safeName = safeText(profile.full_name || profile.email || 'Usuario');
    const safeEmail = safeText(profile.email || '');
    const safeRole = safeText(member.role || '');
    const safeStatus = safeText(member.status || '');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-4 py-3';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-bold text-[#293C74]">${safeName}</p>
          <p class="text-xs text-slate-500">${safeEmail}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] uppercase tracking-widest text-slate-400 font-bold">${safeRole}</p>
          <p class="text-[10px] text-slate-400">${safeStatus}</p>
        </div>
      </div>
    `;
    churchMembersList.appendChild(card);
  });
}

async function loadChurchMembers(headers = {}) {
  if (!churchMembersList || !churchMembersEmpty) return;
  ensureAllChurchesSelection();
  if (requiresScopedChurchSelection()) {
    churchMembersEmpty.textContent = 'Selecciona una iglesia para ver el equipo.';
    churchMembersEmpty.classList.remove('hidden');
    churchMembersList.classList.add('hidden');
    return;
  }
  try {
    const url = new URL('/api/portal/iglesia/members', window.location.origin);
    const resolvedId = resolveSelectedChurchId();
    if (resolvedId) url.searchParams.set('churchId', resolvedId);
    const res = await fetch(url.toString(), { headers, credentials: 'include' });
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
  const resolvedId = resolveSelectedChurchId();
  if (!resolvedId) {
    churchExportStatus.textContent = 'Selecciona una iglesia antes de exportar.';
    return;
  }
  churchExportStatus.textContent = 'Generando Excel...';
  try {
    const url = new URL('/api/portal/iglesia/export-participants', window.location.origin);
    url.searchParams.set('churchId', resolvedId);
    url.searchParams.set('format', 'xlsx');
    const res = await fetch(url.toString(), { headers: portalAuthHeaders });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo exportar');
    }
    const blob = await res.blob();
    const filename = res.headers.get('content-disposition')?.split('filename=')?.[1]?.replace(/"/g, '') || 'cumbre-participantes.xlsx';
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    churchExportStatus.textContent = 'Excel listo.';
  } catch (err) {
    console.error(err);
    churchExportStatus.textContent = err?.message || 'No se pudo exportar.';
  }
}

async function exportCumbrePackageAudit() {
  if (!churchAuditBtn || !churchExportStatus) return;
  if (!portalIsAdmin) {
    churchExportStatus.textContent = 'Solo administradores pueden descargar la auditoría.';
    return;
  }
  churchAuditBtn.disabled = true;
  churchExportStatus.textContent = 'Generando auditoría de paquetes...';
  try {
    const url = new URL('/api/portal/admin/cumbre/package-audit', window.location.origin);
    url.searchParams.set('format', 'csv');
    url.searchParams.set('scope', 'participants');
    const res = await fetch(url.toString(), { headers: portalAuthHeaders, credentials: 'include' });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error || 'No se pudo descargar auditoría');
    }
    const blob = await res.blob();
    const filename = res.headers.get('content-disposition')?.split('filename=')?.[1]?.replace(/"/g, '') || 'cumbre-package-audit-participants.csv';
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    window.URL.revokeObjectURL(link.href);
    link.remove();
    churchExportStatus.textContent = 'Auditoría descargada. Revisa primero antes de corregir datos.';
  } catch (err) {
    console.error(err);
    churchExportStatus.textContent = err?.message || 'No se pudo descargar auditoría.';
  } finally {
    churchAuditBtn.disabled = false;
  }
}

async function loadAdminUsers(headers = {}) {
  if (!adminUsersCard) return;
  if (!portalIsSuperadmin) {
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

async function loadAdminFollowups(headers = {}) {
  if (!adminFollowupsCard) return;
  if (!portalIsAdmin) {
    adminFollowupsCard.classList.add('hidden');
    return;
  }
  adminFollowupsCard.classList.remove('hidden');
  if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Cargando alertas...';
  try {
    const res = await fetch('/api/portal/admin/cumbre/issues', { headers });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar');
    adminIssuesData = payload.items || [];
    adminIssuesCounts = payload.counts || {};
    adminIssuesPage = 1;
    renderAdminFollowups(adminIssuesData, adminIssuesCounts);
  } catch (err) {
    console.error(err);
    if (adminFollowupsStatus) {
      adminFollowupsStatus.textContent = err?.message || 'No se pudo cargar alertas.';
    }
    if (adminFollowupsEmpty) adminFollowupsEmpty.classList.remove('hidden');
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
    const safeRolesLabel = safeText(rolesLabel || 'Sin rol de iglesia');
    const safeName = safeText(user.full_name || user.email || '');
    const safeEmail = safeText(user.email || '');
    const safeUserId = safeAttr(user.user_id || '');
    const safeRole = safeText(user.role || '');
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3';
    const roleSelect = portalIsSuperadmin
      ? `<select data-action="role" data-user="${safeUserId}" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-[#293C74]">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>Usuario</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Superadmin</option>
        </select>`
      : `<span class="text-xs font-bold text-[#293C74]">${safeRole}</span>`;
    card.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p class="text-sm font-bold text-[#293C74]">${safeName}</p>
          <p class="text-xs text-slate-500">${safeEmail}</p>
          <p class="text-[10px] text-slate-400 mt-1">${safeRolesLabel}</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${roleSelect}
          <button type="button" data-action="reset" data-email="${safeAttr(user.email || '')}" class="min-h-11 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold text-[#293C74] hover:bg-slate-100">
            Reset contraseña
          </button>
        </div>
      </div>
    `;
    adminUsersList.appendChild(card);
  });
}

function getIssueBadge(type) {
  const map = {
    registration_incomplete: { label: 'Registro incompleto', className: 'bg-amber-50 text-amber-700 border-amber-100' },
    payment_pending: { label: 'Pago pendiente', className: 'bg-sky-50 text-sky-700 border-sky-100' },
    payment_mismatch: { label: 'Descuadre pago', className: 'bg-rose-50 text-rose-700 border-rose-100' },
    overpaid: { label: 'Sobrepago detectado', className: 'bg-pink-50 text-pink-700 border-pink-100' },
    no_church: { label: 'Sin iglesia', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  };
  return map[type] || { label: 'Alerta', className: 'bg-slate-100 text-slate-600 border-slate-200' };
}

function updateAdminFollowupsFilters(counts = {}, total = 0) {
  if (!adminFollowupsFilters) return;
  adminFollowupsFilters.querySelectorAll('[data-filter]').forEach((button) => {
    const filter = button.dataset.filter || 'all';
    const count = filter === 'all' ? total : (counts[filter] || 0);
    const countEl = button.querySelector('[data-count]');
    if (countEl) countEl.textContent = `${count}`;

    if (filter === adminIssuesFilter) {
      button.classList.remove('bg-white', 'text-slate-500', 'border-slate-100');
      button.classList.add('bg-[#293C74]', 'text-white', 'border-transparent');
    } else {
      button.classList.add('bg-white', 'text-slate-500', 'border-slate-100');
      button.classList.remove('bg-[#293C74]', 'text-white', 'border-transparent');
    }
  });
}

function getAdminFollowupsSortOption() {
  return adminFollowupsSort?.value || 'recent_desc';
}

function getAdminFollowupsPageSize() {
  const raw = Number(adminFollowupsPageSize?.value || DEFAULT_ADMIN_FOLLOWUPS_PAGE_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ADMIN_FOLLOWUPS_PAGE_SIZE;
  return raw;
}

function sortAdminFollowups(list) {
  const sortOption = getAdminFollowupsSortOption();
  const items = [...(list || [])];
  items.sort((a, b) => {
    const aDate = toDate(a.created_at)?.getTime() || 0;
    const bDate = toDate(b.created_at)?.getTime() || 0;
    const aAmount = Number(a.total_paid ?? a.total_amount ?? 0);
    const bAmount = Number(b.total_paid ?? b.total_amount ?? 0);
    if (sortOption === 'recent_asc') return aDate - bDate;
    if (sortOption === 'amount_desc') return bAmount - aAmount;
    return bDate - aDate;
  });
  return items;
}

function paginateAdminFollowups(list) {
  const safeList = list || [];
  const pageSize = getAdminFollowupsPageSize();
  const total = safeList.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (adminIssuesPage > totalPages) adminIssuesPage = totalPages;
  if (adminIssuesPage < 1) adminIssuesPage = 1;
  const start = (adminIssuesPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: safeList.slice(start, end),
    total,
    totalPages,
    page: adminIssuesPage,
    start,
    end,
  };
}

function renderAdminFollowupsPagination(meta) {
  if (!adminFollowupsPagination) return;
  if (!meta || meta.total <= 0) {
    adminFollowupsPagination.innerHTML = '';
    adminFollowupsPagination.classList.add('hidden');
    return;
  }
  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  adminFollowupsPagination.innerHTML = `
    <span class="font-medium text-slate-500">Mostrando ${meta.start + 1}-${meta.end} de ${meta.total}</span>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button type="button" class="admin-followups-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page - 1}" ${canPrev ? '' : 'disabled'}>
        Anterior
      </button>
      <span class="whitespace-nowrap text-[11px] font-semibold text-slate-500">Página ${meta.page} / ${meta.totalPages}</span>
      <button type="button" class="admin-followups-page-btn min-h-11 whitespace-nowrap px-4 py-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${meta.page + 1}" ${canNext ? '' : 'disabled'}>
        Siguiente
      </button>
    </div>
  `;
  adminFollowupsPagination.classList.remove('hidden');
  adminFollowupsPagination.querySelectorAll('.admin-followups-page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.page || 0);
      if (!Number.isFinite(next) || next < 1 || next > meta.totalPages) return;
      adminIssuesPage = next;
      renderAdminFollowups(adminIssuesData, adminIssuesCounts);
    });
  });
}

function normalizeWhatsappPhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

function buildWhatsappMessage(item, ctaUrl = '') {
  const name = item.contact_name || 'Hola';
  const bookingRef = (item.booking_id || item.id || '').slice(0, 8).toUpperCase();
  switch (item.type) {
    case 'registration_incomplete':
      const missingFields = Array.isArray(item.missing_fields)
        ? item.missing_fields.join(', ')
        : (item.missing_fields || 'datos del registro');
      return `Hola ${name}, vimos tu pago para la Cumbre Mundial 2026. Falta completar: ${missingFields}. ${ctaUrl ? `Completa aqui: ${ctaUrl}. ` : ''}Booking: ${bookingRef}.`;
    case 'payment_pending':
      return `Hola ${name}, tu pago esta en verificacion. Si pagaste con PSE/Nequi puede tardar unos minutos. No hagas otro pago. Booking: ${bookingRef}.`;
    case 'payment_mismatch':
      return `Hola ${name}, estamos revisando tu pago porque aparece aprobado pero no se actualizo el registro. Nuestro equipo lo esta corrigiendo. Booking: ${bookingRef}.`;
    case 'overpaid':
      return `Hola ${name}, detectamos un pago adicional en tu reserva de la Cumbre. Nuestro equipo esta revisando para ayudarte. Booking: ${bookingRef}.`;
    case 'no_church':
      return `Hola ${name}, necesitamos confirmar tu iglesia o sede para la Cumbre Mundial 2026. Responde con el nombre de tu iglesia y ciudad. Booking: ${bookingRef}.`;
    default:
      return `Hola ${name}, estamos revisando tu registro de la Cumbre Mundial 2026. Booking: ${bookingRef}.`;
  }
}

function renderAdminFollowups(items, counts = {}) {
  if (!adminFollowupsList || !adminFollowupsEmpty) return;
  adminFollowupsList.innerHTML = '';
  if (adminFollowupsVisibleCount) adminFollowupsVisibleCount.textContent = '0 visibles';
  if (adminFollowupsPagination) {
    adminFollowupsPagination.innerHTML = '';
    adminFollowupsPagination.classList.add('hidden');
  }

  const total = items.length || 0;
  if (adminFollowupsCount) adminFollowupsCount.textContent = `${total}`;
  updateAdminFollowupsFilters(counts, total);

  const scopedItems = adminIssuesFilter === 'all'
    ? items
    : items.filter((item) => item.type === adminIssuesFilter);
  const query = adminFollowupsSearch?.value?.trim().toLowerCase() || '';
  const filteredItems = scopedItems.filter((item) => {
    if (!query) return true;
    const searchable = [
      item.contact_name,
      item.contact_email,
      item.contact_phone,
      item.booking_id,
      item.id,
    ].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(query);
  });
  const sortedItems = sortAdminFollowups(filteredItems);
  const paginated = paginateAdminFollowups(sortedItems);
  if (adminFollowupsVisibleCount) {
    adminFollowupsVisibleCount.textContent = `${paginated.total} visibles`;
  }

  if (!paginated.total) {
    adminFollowupsEmpty.classList.remove('hidden');
    adminFollowupsList.classList.add('hidden');
    if (adminFollowupsStatus) adminFollowupsStatus.textContent = total ? 'No hay alertas en este filtro.' : '';
    return;
  }

  adminFollowupsEmpty.classList.add('hidden');
  adminFollowupsList.classList.remove('hidden');
  if (adminFollowupsStatus) {
    adminFollowupsStatus.textContent = `Mostrando ${paginated.start + 1}-${paginated.end} de ${paginated.total} alertas.`;
  }

  const churchOptions = (portalChurchesCatalog || [])
    .map((church) => `<option value="${safeAttr(church.id || '')}">${safeText(church.name || '')}</option>`)
    .join('');

  paginated.items.forEach((item) => {
    const badge = getIssueBadge(item.type);
    const contactLabel = item.contact_name || item.contact_email || 'Participante';
    const createdLabel = formatDateTime(item.created_at);
    const amountValue = item.total_paid != null ? item.total_paid : item.total_amount;
    const amountLabel = amountValue != null ? formatCurrency(amountValue, item.currency) : '-';
    const bookingRef = (item.booking_id || item.id || '').slice(0, 8).toUpperCase();
    const paymentAmountLabel = item.payment?.amount != null
      ? formatCurrency(item.payment.amount, item.payment.currency || item.currency)
      : '-';
    const paymentInfo = item.payment
      ? `${item.payment.provider || 'Pago'} · ${item.payment.status || ''} · ${paymentAmountLabel}`
      : '';
    const lastWhatsapp = item.last_whatsapp;
    const whatsappSender = lastWhatsapp?.sent_by_name || lastWhatsapp?.sent_by_email || '';
    const whatsappStatusLabel = lastWhatsapp?.sent_at
      ? `WhatsApp enviado${whatsappSender ? ` por ${whatsappSender}` : ''} · ${formatDateTime(lastWhatsapp.sent_at)}`
      : '';
    const safeBadgeLabel = safeText(badge.label);
    const safeContactLabel = safeText(contactLabel);
    const safeContactEmail = safeText(item.contact_email || '-');
    const safeContactPhone = safeText(item.contact_phone || 'Sin teléfono');
    const safeCreatedLabel = safeText(createdLabel);
    const safeAmountLabel = safeText(amountLabel);
    const safeBookingRef = safeText(bookingRef);
    const safeWhatsappStatusLabel = safeText(whatsappStatusLabel);
    const safeItemId = safeAttr(item.id || '');
    const safeKind = safeAttr(item.type || '');

    let detail = '';
    if (item.type === 'registration_incomplete') {
      const missing = Array.isArray(item.missing_fields) && item.missing_fields.length
        ? item.missing_fields.join(', ')
        : 'Datos incompletos';
      detail = `Faltan datos: ${missing}`;
    }
    if (item.type === 'payment_pending') {
      detail = paymentInfo || 'Pago en verificación.';
    }
    if (item.type === 'payment_mismatch') {
      detail = `Pagos aprobados: ${formatCurrency(item.approved_total, item.currency)} · Registrado: ${formatCurrency(item.total_paid, item.currency)}`;
    }
    if (item.type === 'overpaid') {
      detail = `Pagado: ${formatCurrency(item.total_paid, item.currency)} · Total: ${formatCurrency(item.total_amount, item.currency)}`;
    }
    if (item.type === 'no_church') {
      detail = 'Sin iglesia registrada.';
    }

    const canEmail = ['registration_incomplete', 'payment_pending'].includes(item.type);
    const canRecompute = item.type === 'payment_mismatch';
    const canAssignChurch = item.type === 'no_church';
    const hasPhone = Boolean(item.contact_phone);
    const whatsappLabel = hasPhone
      ? (lastWhatsapp?.sent_at ? 'Reenviar WhatsApp' : 'WhatsApp')
      : 'Copiar WhatsApp';
    const safeDetail = safeText(detail || 'Alerta pendiente de revisión.');
    const safeWhatsappLabel = safeText(whatsappLabel);
    const safeStatus = safeText(item.status || '-');

    const card = document.createElement('div');
    card.className = 'admin-issue-card rounded-2xl border border-slate-200 bg-white p-4 space-y-3';
    card.dataset.booking = item.id;
    card.dataset.type = item.type;
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest ${badge.className}">${safeBadgeLabel}</span>
            <span class="text-[10px] uppercase tracking-widest text-slate-400">#${safeBookingRef}</span>
          </div>
          <p class="text-sm font-bold text-[#293C74] truncate">${safeContactLabel}</p>
          <p class="text-xs text-slate-500 truncate">${safeContactEmail}</p>
          <p class="text-xs text-slate-400 truncate">${safeContactPhone}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] uppercase tracking-widest text-slate-400">Pagado</p>
          <p class="text-sm font-bold text-brand-teal">${safeAmountLabel}</p>
          <p class="text-[10px] text-slate-400 mt-2">${safeCreatedLabel}</p>
        </div>
      </div>
      <div class="rounded-xl bg-slate-50/70 border border-slate-100 px-3 py-2 text-xs text-slate-600">
        ${safeDetail}
      </div>
      <p class="text-[10px] uppercase tracking-widest text-slate-400" data-field="whatsapp-status">${safeWhatsappStatusLabel}</p>
      ${canAssignChurch ? `
        <div class="flex flex-col md:flex-row md:items-center gap-2 min-w-0">
          <select data-role="assign-church" aria-label="Asignar una iglesia a ${safeContactLabel}" class="w-full min-h-11 min-w-0 md:flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-[#293C74]">
            <option value="">Selecciona iglesia</option>
            <option value="__virtual__">Ministerio Virtual</option>
            ${churchOptions}
          </select>
          <button type="button" data-action="assign-church" data-booking="${safeItemId}" class="w-full min-h-11 md:w-auto shrink-0 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800">
            Asignar
          </button>
        </div>
      ` : ''}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-3">
        <span class="text-[10px] uppercase tracking-widest text-slate-400">Estado: ${safeStatus}</span>
        <div class="flex items-center gap-2 flex-wrap">
          ${canRecompute ? `
            <button type="button" data-action="recompute" data-booking="${safeItemId}" class="min-h-11 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold text-[#293C74] hover:bg-slate-100">
              Recalcular
            </button>
          ` : ''}
          ${canEmail ? `
            <button type="button" data-action="notify-email" data-booking="${safeItemId}" data-kind="${safeKind}" class="min-h-11 whitespace-nowrap px-3 py-2 rounded-lg bg-[#293C74] text-white text-xs font-bold hover:bg-[#293C74]/90">
              Enviar correo
            </button>
          ` : ''}
          <button type="button" data-action="whatsapp" data-booking="${safeItemId}" class="min-h-11 whitespace-nowrap px-3 py-2 rounded-lg bg-teal-600 text-white text-xs font-bold hover:bg-teal-700">
            ${safeWhatsappLabel}
          </button>
        </div>
      </div>
    `;
    adminFollowupsList.appendChild(card);
  });
  renderAdminFollowupsPagination(paginated);
}

function initAdminInvite() {
  if (!adminInviteBtn || !adminInviteEmail || !adminInviteRole) return;
  if (!portalIsSuperadmin) return;

  adminInviteBtn.addEventListener('click', async () => {
    if (!adminInviteStatus) return;
    adminInviteStatus.textContent = 'Enviando...';
    try {
      const actionHeaders = await getActionAuthHeaders();
      const payload = {
        email: adminInviteEmail.value.trim(),
        fullName: adminInviteName?.value?.trim() || '',
        role: adminInviteRole.value,
        churchRole: adminInviteChurchRole?.value || '',
        church: adminInviteChurch?.value?.trim() || '',
      };
      const res = await fetch('/api/portal/admin/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...actionHeaders },
        credentials: 'include',
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
    churchId: resolveSelectedChurchId(),
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
  if (churchManualFormInitialized) return;
  churchManualFormInitialized = true;

  if (requiresScopedChurchSelection()) {
    if (churchFormStatus) {
      churchFormStatus.textContent = 'Selecciona una iglesia en el panel superior antes de registrar.';
    }
    churchForm.classList.add('hidden');
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
    if (requiresScopedChurchSelection()) {
      churchFormStatus.textContent = 'Selecciona una iglesia en el panel superior.';
      return;
    }
    if ((portalIsAdmin || portalIsCountryPastor) && portalIsCustomChurch && !churchNameInput?.value?.trim()) {
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
      churchId: resolveSelectedChurchId(),
      paymentOption: document.getElementById('church-payment-option')?.value || 'FULL',
      paymentAmount: Number(document.getElementById('church-payment-amount')?.value || 0),
      frequency: document.getElementById('church-payment-frequency')?.value || 'MONTHLY',
      paymentMethod: document.getElementById('church-payment-method')?.value || '',
      notes: document.getElementById('church-notes')?.value || '',
      participants: collectParticipants(),
    };
    const signature = JSON.stringify(payload);
    if (!churchFormIdempotencyKey || churchFormSignature !== signature) {
      churchFormIdempotencyKey = generateIdempotencyKey();
      churchFormSignature = signature;
    }
    payload.idempotencyKey = churchFormIdempotencyKey;

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
      churchFormIdempotencyKey = null;
      churchFormSignature = null;
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
  if (inviteFormInitialized) return;
  inviteFormInitialized = true;

  inviteBtn.addEventListener('click', async () => {
    if (!inviteStatus) return;
    inviteStatus.textContent = 'Enviando invitación...';
    try {
      const actionHeaders = await getActionAuthHeaders();
      const selectedChurchId = inviteChurchInput?.value || resolveSelectedChurchId();
      if ((portalIsAdmin || portalIsCountryPastor) && !selectedChurchId) {
        inviteStatus.textContent = 'Selecciona una iglesia antes de invitar.';
        return;
      }
      if (portalIsCustomChurch) {
        inviteStatus.textContent = 'Selecciona una iglesia del listado para invitar.';
        return;
      }
      const payload = {
        email: inviteEmail.value.trim(),
        role: inviteRole.value,
        churchId: selectedChurchId || undefined,
        church: inviteChurchInput?.value?.trim() || '',
      };
      const res = await fetch('/api/portal/iglesia/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...actionHeaders },
        credentials: 'include',
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
    card.className = 'bg-white border border-slate-200 rounded-[2rem] p-6 space-y-5 shadow-sm hover:shadow-lg transition-all';
    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    const balance = Math.max(0, totalAmount - totalPaid);
    const progress = totalAmount > 0 ? Math.min(100, Math.round((totalPaid / totalAmount) * 100)) : 0;
    const isPaidFull = booking.status === 'PAID' || totalPaid >= totalAmount;
    const statusMap = {
      PAID: { label: 'Pago completo', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
      DEPOSIT_OK: { label: 'Abono confirmado', className: 'bg-amber-100 text-amber-700 border border-amber-200' },
      PENDING: { label: 'Pago pendiente', className: 'bg-slate-100 text-slate-600 border border-slate-200' },
    };
    const statusKey = isPaidFull ? 'PAID' : (booking.status || 'PENDING');
    const statusInfo = statusMap[statusKey] || statusMap.PENDING;
    const { title: eventName, start: eventStart, end: eventEnd } = resolveEventDates(booking);
    const bookingRef = (booking.reference || booking.id || '').toString().slice(0, 8).toUpperCase();
    const createdLabel = formatDateTime(booking.created_at);
    const churchName = booking.church_name || booking.contact_church || 'Sin iglesia';
    const cityName = booking.contact_city || '';
    const locationLabel = [churchName, cityName].filter(Boolean).join(' · ');
    const pendingLabel = formatCurrency(balance, booking.currency);
    const progressGradient = isPaidFull ? 'from-emerald-400 to-emerald-500' : 'from-brand-teal to-[#4CC9E0]';
    const balanceBadgeClass = balance > 0 ? 'text-amber-600' : 'text-emerald-600';
    const calendarUrl = buildGoogleCalendarUrl({
      title: eventName,
      start: eventStart,
      end: eventEnd,
      location: locationLabel,
      details: `Reserva #${bookingRef}`,
    });
    const safeEventName = safeText(eventName);
    const safeCreatedLabel = safeText(createdLabel);
    const safeBookingRef = safeText(bookingRef);
    const safeLocationLabel = safeText(locationLabel || 'Sin iglesia');
    const safePendingLabel = safeText(pendingLabel);
    const safeTotalPaid = safeText(formatCurrency(totalPaid, booking.currency));
    const safeTotalAmount = safeText(formatCurrency(totalAmount, booking.currency));
    const safeStatusLabel = safeText(statusInfo.label);
    const safeCalendarUrl = safeAttr(calendarUrl);
    const safeCalendarTitle = safeAttr(eventName);
    const safeCalendarStart = safeAttr(eventStart?.toISOString() || '');
    const safeCalendarEnd = safeAttr(eventEnd?.toISOString() || '');
    const safeCalendarLocation = safeAttr(locationLabel);
    const safeCalendarDetails = safeAttr(`Reserva #${bookingRef}`);
    const calendarLinks = eventStart ? `
      <div class="flex flex-wrap gap-2 pt-1">
        <a href="${safeCalendarUrl}" target="_blank" rel="noreferrer"
           class="inline-flex min-h-11 items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-full border border-slate-200 text-slate-600 hover:border-slate-300">
          Google Calendar
        </a>
        <button type="button"
          class="calendar-download inline-flex min-h-11 items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
          data-calendar-title="${safeCalendarTitle}"
          data-calendar-start="${safeCalendarStart}"
          data-calendar-end="${safeCalendarEnd}"
          data-calendar-location="${safeCalendarLocation}"
          data-calendar-details="${safeCalendarDetails}">
          Descargar .ics
        </button>
      </div>
    ` : '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Reserva</p>
          <h3 class="text-lg font-bold text-[#293C74]">${safeEventName}</h3>
          <p class="text-xs text-slate-500 mt-1">#${safeBookingRef} · ${safeCreatedLabel}</p>
        </div>
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusInfo.className}">${safeStatusLabel}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Aportado</p>
          <p class="text-lg font-bold text-[#293C74] mt-2">${safeTotalPaid}</p>
        </div>
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pendiente</p>
          <p class="text-lg font-bold ${balanceBadgeClass} mt-2">${safePendingLabel}</p>
        </div>
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total</p>
          <p class="text-lg font-bold text-slate-600 mt-2">${safeTotalAmount}</p>
        </div>
      </div>

      <div>
        <div class="flex justify-between text-xs">
          <span class="text-slate-500">Progreso de abono</span>
          <span class="text-[#293C74] font-bold">${progress}%</span>
        </div>
        <div class="h-2 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
          <div class="h-full bg-gradient-to-r ${progressGradient} transition-all duration-700" style="width: ${progress}%"></div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span class="inline-flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 2c-4.418 0-8 3.582-8 8 0 5.25 8 12 8 12s8-6.75 8-12c0-4.418-3.582-8-8-8z" />
          </svg>
          ${safeLocationLabel}
        </span>
        <span class="inline-flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V9m-2 0H7m10 0a2 2 0 110 4h-2a2 2 0 110-4h2z" />
          </svg>
          ${isPaidFull ? 'Cupo confirmado' : `Saldo por pagar: ${safePendingLabel}`}
        </span>
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
    card.className = 'bg-white border border-slate-100 rounded-[2rem] p-6 space-y-5 shadow-sm';
    const statusLabel = plan.status === 'PAUSED' ? 'Pausado' : plan.status === 'COMPLETED' ? 'Completado' : 'Activo';
    const actionLabel = plan.status === 'PAUSED' ? 'Reactivar abonos' : 'Pausar abonos';
    const actionClass = plan.status === 'PAUSED' ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
    const badgeClass = plan.status === 'COMPLETED'
      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
      : plan.status === 'PAUSED'
        ? 'bg-amber-100 text-amber-700 border border-amber-200'
        : 'bg-slate-100 text-slate-600 border border-slate-200';
    const safeFrequency = safeText(plan.frequency === 'BIWEEKLY' ? 'Quincenal' : 'Mensual');
    const safeStatusLabel = safeText(statusLabel);
    const safeAmountLabel = safeText(formatCurrency(plan.installment_amount, plan.currency));
    const safeNextDue = safeText(plan.next_due_date ? formatDate(plan.next_due_date) : 'Sin fecha');
    const safeActionLabel = safeText(actionLabel);
    const safePlanId = safeAttr(plan.id || '');

    card.innerHTML = `
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-3">
           <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
           </div>
           <div>
             <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Recurrencia</p>
             <p class="text-sm font-bold text-[#293C74]">${safeFrequency}</p>
           </div>
        </div>
        <span class="text-[10px] font-bold px-2 py-1 rounded uppercase ${badgeClass}">${safeStatusLabel}</span>
      </div>
      
      <div class="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
         <p class="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Monto de la Cuota</p>
         <p class="text-2xl font-display font-bold text-[#293C74]">${safeAmountLabel}</p>
      </div>

      <div class="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-4">
         <span>Próximo abono: ${safeNextDue}</span>
         <button type="button" class="plan-action min-h-11 px-4 py-2 rounded-lg text-xs font-bold transition-all ${actionClass}" data-plan="${safePlanId}" data-action="${plan.status === 'PAUSED' ? 'resume' : 'pause'}">
          ${safeActionLabel}
         </button>
      </div>
    `;
    plansList.appendChild(card);
  });
}

function setupAdminFilters(allBookings) {
  if (document.getElementById('admin-filters-container')) return;

  // Get unique cities and churches
  const cities = [...new Set(allBookings.map(b => b.city || b.church_city))].filter(Boolean).sort();
  const churches = [...new Set(allBookings.map(b => b.church_name))].filter(Boolean).sort();

  const container = document.createElement('div');
  container.id = 'admin-filters-container';
  container.className = 'flex flex-wrap gap-2 mb-4';

  // City Select
  const citySelect = document.createElement('select');
  citySelect.className = 'bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600 outline-none focus:border-brand-teal';
  citySelect.innerHTML = '<option value="">Todas las ciudades</option>' + cities.map(c => `<option value="${safeAttr(c)}">${safeText(c)}</option>`).join('');

  // Church Select
  const churchSelect = document.createElement('select');
  churchSelect.className = 'bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-600 outline-none focus:border-brand-teal';
  churchSelect.innerHTML = '<option value="">Todas las iglesias</option>' + churches.map(c => `<option value="${safeAttr(c)}">${safeText(c)}</option>`).join('');

  // Event Listeners
  const applyFilters = () => {
    const selectedCity = citySelect.value;
    const selectedChurch = churchSelect.value;

    const filtered = allBookings.filter(b => {
      if (selectedCity && (b.city !== selectedCity && b.church_city !== selectedCity)) return false;
      if (selectedChurch && b.church_name !== selectedChurch) return false;
      return true;
    });

    renderBookings(filtered);
  };

  citySelect.addEventListener('change', applyFilters);
  churchSelect.addEventListener('change', applyFilters);

  container.appendChild(citySelect);
  container.appendChild(churchSelect);

  // Insert before list
  if (bookingsList && bookingsList.parentNode) {
    bookingsList.parentNode.insertBefore(container, bookingsList);
  }
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
    const dueLabel = installment.due_date ? formatDate(installment.due_date) : 'Sin fecha';
    const safeInstallmentLabel = safeText(installmentLabel);
    const safeAmountLabel = safeText(amountLabel);
    const safeDueLabel = safeText(dueLabel);
    const safeContactLabel = safeText(booking.contact_name || booking.contact_email || '');
    const safeStatusLabel = safeText(statusLabel);
    const safeInstallmentId = safeAttr(installment.id || '');
    const safeDueDateRaw = safeAttr((installment.due_date || '').toString());

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-200 bg-white px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between';
    card.innerHTML = `
      <div>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">${safeInstallmentLabel}</p>
        <p class="text-sm font-bold text-[#293C74]">${safeAmountLabel}</p>
        <p class="text-xs text-slate-500">Vence: ${safeDueLabel}</p>
        <p class="text-[11px] text-slate-400 mt-1">${safeContactLabel}</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap md:justify-end">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass} whitespace-nowrap">${safeStatusLabel}</span>
        <button type="button" class="installment-reschedule min-h-11 whitespace-nowrap px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition" data-installment="${safeInstallmentId}" data-due-date="${safeDueDateRaw}">
          Cambiar fecha
        </button>
        <button type="button" class="installment-pay min-h-11 whitespace-nowrap px-4 py-2 rounded-xl bg-[#293C74] text-white text-xs font-bold hover:shadow-md transition" data-installment="${safeInstallmentId}">
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
    row.className = 'group hover:bg-slate-50 transition-colors';
    const statusClass = payment.status === 'APPROVED'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-amber-100 text-amber-700';
    const detailLabel = payment.detail || `${payment.provider?.toUpperCase() || '-'} · Aporte`;
    const safeCreatedAt = safeText(formatDate(payment.created_at));
    const safeReference = safeText(payment.reference || '-');
    const safeDetailLabel = safeText(detailLabel);
    const safeAmountLabel = safeText(formatCurrency(payment.amount, payment.currency));
    const safeStatusLabel = safeText(payment.status || 'PENDING');
    row.innerHTML = `
      <td class="py-6 px-8 text-slate-600">${safeCreatedAt}</td>
      <td class="py-6 px-8 font-mono text-xs text-slate-400">${safeReference}</td>
      <td class="py-6 px-8 text-slate-500">${safeDetailLabel}</td>
      <td class="py-6 px-8 text-right font-bold text-[#293C74]">${safeAmountLabel}</td>
      <td class="py-6 px-8 text-center">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusClass}">
          ${safeStatusLabel}
        </span>
      </td>
    `;
    paymentsTable.appendChild(row);
  });
}

function buildPaymentsTableData(payload) {
  const payments = (payload?.payments || []).map((payment) => ({
    created_at: payment.created_at,
    reference: payment.reference,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    detail: `${payment.provider?.toUpperCase() || 'PAGO'} · Cumbre Mundial 2026`,
  }));

  const donations = (payload?.donations || []).map((donation) => {
    const label = resolveDonationLabel(donation.donation_type);
    const context = donation.event_name || donation.project_name || donation.campus || '';
    const detail = `${donation.provider?.toUpperCase() || 'DONACION'} · ${label}${context ? ` · ${context}` : ''}`;
    return {
      created_at: donation.created_at,
      reference: donation.reference,
      amount: donation.amount,
      currency: donation.currency,
      status: donation.status,
      detail,
    };
  });

  return [...payments, ...donations]
    .filter((item) => item.created_at)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function renderSummaryEvents(bookings, plans, installments) {
  if (!summaryEventsList || !summaryEventsEmpty) return;
  summaryEventsList.innerHTML = '';
  if (!bookings.length) {
    summaryEventsEmpty.classList.remove('hidden');
    return;
  }
  summaryEventsEmpty.classList.add('hidden');

  bookings.forEach((booking) => {
    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    const balance = Math.max(0, totalAmount - totalPaid);
    const { title, start, end, isCumbre } = resolveEventDates(booking);

    const plan = (plans || []).find((item) => item.booking_id === booking.id && item.status !== 'CANCELLED') || null;
    const pendingInstallments = (installments || []).filter((item) =>
      item.booking_id === booking.id && ['PENDING', 'FAILED'].includes(item.status),
    );
    const nextInstallment = [...pendingInstallments].sort((a, b) => {
      const aDate = toDate(a.due_date);
      const bDate = toDate(b.due_date);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.getTime() - bDate.getTime();
    })[0];

    const nextDueDate = plan?.next_due_date || nextInstallment?.due_date || null;
    const nextDueLabel = nextDueDate ? formatDate(nextDueDate) : (balance > 0 ? 'Sin fecha' : '—');
    const deadlineDate = plan?.end_date ? formatLongDate(plan.end_date) : (isCumbre ? formatLongDate(CUMBRE_ABONO_DEADLINE) : '');
    const deadlineNote = (!nextDueDate && balance > 0 && deadlineDate) ? `Antes de ${deadlineDate}` : '';
    const countdown = getCountdownLabel(start, end);
    const locationParts = [booking.contact_church, booking.contact_city].filter(Boolean);
    const location = locationParts.length ? locationParts.join(' · ') : 'Sin iglesia';
    const safeTitle = safeText(title);
    const safeLocation = safeText(location);
    const safeCountdown = safeText(countdown);
    const safeTotalPaid = safeText(formatCurrency(totalPaid, booking.currency));
    const safeBalance = safeText(formatCurrency(balance, booking.currency));
    const safeNextDue = safeText(nextDueLabel);
    const safeDeadlineNote = deadlineNote ? safeText(deadlineNote) : '';
    const safeStart = safeText(start ? `Inicio: ${formatDate(start)}` : 'Fecha por confirmar');
    const safeEnd = safeText(end ? `Fin: ${formatDate(end)}` : '');

    const card = document.createElement('div');
    card.className = 'bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm space-y-4';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Evento</p>
          <h3 class="text-lg font-bold text-[#293C74]">${safeTitle}</h3>
          <p class="text-xs text-slate-500 mt-1">${safeLocation}</p>
        </div>
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200">${safeCountdown}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total aportado</p>
          <p class="text-lg font-bold text-[#293C74] mt-2">${safeTotalPaid}</p>
        </div>
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pendiente</p>
          <p class="text-lg font-bold text-amber-600 mt-2">${safeBalance}</p>
        </div>
        <div class="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Próximo abono</p>
          <p class="text-lg font-bold text-[#293C74] mt-2">${safeNextDue}</p>
          ${safeDeadlineNote ? `<p class="text-[10px] text-slate-400 mt-1">${safeDeadlineNote}</p>` : ''}
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between text-xs text-slate-500">
        <span>${safeStart}</span>
        <span>${safeEnd}</span>
      </div>
    `;
    summaryEventsList.appendChild(card);
  });
}

function resolveDonationRecurringSchedule(item) {
  const status = (item.status || '').toString().toUpperCase();
  if (status === 'PENDING_SETUP') {
    return item.provider === 'wompi'
      ? 'Pendiente: activacion de cobro automatico Wompi'
      : 'Pendiente de confirmacion';
  }
  if (status === 'PENDING') {
    return 'Cobro en proceso de confirmacion';
  }
  if (status === 'PAUSED') {
    return item.pause_until
      ? `Pausado hasta ${formatDate(item.pause_until)}`
      : 'Pausado hasta reactivar';
  }
  if (status === 'PAYMENT_FAILED') {
    return 'Pago fallido: revisa el metodo de pago';
  }
  if (item.next_charge_at) return `Proximo cobro: ${formatDate(item.next_charge_at)}`;
  if (item.current_period_end) return `Periodo actual hasta ${formatDate(item.current_period_end)}`;
  return 'Aporte recurrente';
}

function resolveDonationProviderLabel(item) {
  const provider = (item.provider || '').toString().toLowerCase();
  if (provider === 'stripe') return 'Procesado por Stripe';
  if (provider === 'wompi') return 'Procesado por Wompi';
  return 'Procesador pendiente';
}

function renderGivingSummary(donations, subscriptions, recurringSubscriptions = []) {
  if (!givingList || !givingEmpty) return;
  givingList.innerHTML = '';
  const reminderRecurring = (subscriptions || []).filter((item) => {
    const status = (item.status || 'ACTIVE').toString().toUpperCase();
    return !['CANCELLED', 'ENDED', 'DISABLED'].includes(status)
      && !isEventDonation(item)
      && !isCampusDonation(item);
  });
  const realRecurring = (recurringSubscriptions || []).filter((item) => {
    const status = (item.status || 'ACTIVE').toString().toUpperCase();
    return !['CANCELLED', 'ENDED', 'DISABLED'].includes(status)
      && !isEventDonation(item)
      && !isCampusDonation(item);
  });
  const oneTime = (donations || []).filter((item) => !item.is_recurring && !isEventDonation(item) && !isCampusDonation(item));

  const items = [
    ...realRecurring.map((item) => ({ ...item, _type: 'real-recurring' })),
    ...reminderRecurring.map((item) => ({ ...item, _type: 'recurring-reminder' })),
    ...oneTime.slice(0, 6).map((item) => ({ ...item, _type: 'one-time' })),
  ];

  const hasTithe = [...realRecurring, ...reminderRecurring]
    .some((item) => (item.donation_type || '').toString().toLowerCase() === 'diezmos');
  if (givingCta) {
    givingCta.toggleAttribute('hidden', hasTithe);
  }

  if (!items.length) {
    givingEmpty.classList.remove('hidden');
    return;
  }
  givingEmpty.classList.add('hidden');

  items.forEach((item) => {
    const label = resolveDonationLabel(item.donation_type);
    const amount = formatCurrency(item.amount || 0, item.currency || 'COP');
    const isRealSubscription = item._type === 'real-recurring';
    const schedule = isRealSubscription
      ? resolveDonationRecurringSchedule(item)
      : item._type === 'recurring-reminder'
        ? (item.next_reminder_date ? `Próximo recordatorio: ${formatDate(item.next_reminder_date)}` : 'Próximo recordatorio: Sin fecha')
        : (item.created_at ? `Último aporte: ${formatDate(item.created_at)}` : 'Último aporte');
    const context = item.event_name || item.project_name || item.campus || '';
    const rawStatus = (item.status || (isRealSubscription || item._type === 'recurring-reminder' ? 'ACTIVE' : 'APPROVED')).toString().toUpperCase();
    const statusMap = {
      ACTIVE: { label: 'Activo', className: 'bg-emerald-100 text-emerald-700' },
      PAUSED: { label: 'Pausado', className: 'bg-amber-100 text-amber-700' },
      PENDING_SETUP: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
      INCOMPLETE: { label: 'Incompleto', className: 'bg-amber-100 text-amber-700' },
      PAYMENT_FAILED: { label: 'Pago fallido', className: 'bg-rose-100 text-rose-700' },
      CANCELLED: { label: 'Cancelado', className: 'bg-slate-100 text-slate-600' },
      ENDED: { label: 'Finalizado', className: 'bg-slate-100 text-slate-600' },
      DISABLED: { label: 'Desactivado', className: 'bg-slate-100 text-slate-600' },
      APPROVED: { label: 'Aprobado', className: 'bg-emerald-100 text-emerald-700' },
      PENDING: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
    };
    const statusInfo = statusMap[rawStatus] || { label: rawStatus, className: 'bg-slate-100 text-slate-600' };
    const canManageReminder = item._type === 'recurring-reminder' && item.id;
    const canManageReal = isRealSubscription && item.id;
    const isPaused = rawStatus === 'PAUSED';
    const primaryAction = isPaused ? 'resume' : 'pause';
    const primaryLabel = isPaused ? 'Reanudar' : 'Pausar temporada';
    const safeLabel = safeText(label);
    const safeContext = safeText(context || 'Aporte personalizado');
    const safeSchedule = safeText(schedule);
    const safeAmount = safeText(amount);
    const safeStatusLabel = safeText(statusInfo.label);
    const safePrimaryLabel = safeText(primaryLabel);
    const safeSubscriptionId = safeAttr(item.id || '');
    const safeNextReminderDate = safeAttr((item.next_reminder_date || '').toString());
    const safeProvider = safeText(resolveDonationProviderLabel(item));
    const canOpenProviderPortal = isRealSubscription && item.provider === 'stripe' && item.provider_customer_id;

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-100 bg-white p-4 shadow-sm';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${safeLabel}</p>
          <p class="text-sm font-bold text-[#293C74] mt-1">${safeContext}</p>
          <p class="text-xs text-slate-500 mt-1">${safeSchedule}</p>
          ${isRealSubscription ? `<p class="text-[11px] text-slate-400 mt-1">${safeProvider}</p>` : ''}
        </div>
        <div class="text-right">
          <p class="text-sm font-bold text-brand-teal">${safeAmount}</p>
          <span class="inline-flex mt-2 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusInfo.className}">${safeStatusLabel}</span>
        </div>
      </div>
      ${canManageReal ? `
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button"
            class="giving-recurring-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-giving-subscription-id="${safeSubscriptionId}"
            data-giving-subscription-action="${primaryAction}">
            ${safePrimaryLabel}
          </button>
          ${canOpenProviderPortal ? `
            <button type="button"
              class="giving-recurring-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
              data-giving-subscription-id="${safeSubscriptionId}"
              data-giving-subscription-action="manage">
              Metodo de pago
            </button>
          ` : ''}
          <button type="button"
            class="giving-recurring-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest bg-red-50 text-red-600 hover:bg-red-100"
            data-giving-subscription-id="${safeSubscriptionId}"
            data-giving-subscription-action="cancel">
            Cancelar
          </button>
        </div>
      ` : canManageReminder ? `
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="${primaryAction}">
            ${safePrimaryLabel}
          </button>
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="reschedule"
            data-subscription-next-date="${safeNextReminderDate}">
            Cambiar fecha
          </button>
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest bg-red-50 text-red-600 hover:bg-red-100"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="cancel">
            Cancelar
          </button>
        </div>
      ` : ''}
    `;
    givingList.appendChild(card);
  });
}

function resolveCampusSubscriptionSchedule(item) {
  const status = (item.status || '').toString().toUpperCase();
  if (status === 'PENDING_SETUP') {
    return item.provider === 'wompi'
      ? 'Pendiente: activacion de cobro automatico Wompi'
      : 'Pendiente de confirmacion';
  }
  if (status === 'PENDING') {
    return 'Cobro en proceso de confirmacion';
  }
  if (status === 'PAUSED') {
    return item.pause_until
      ? `Pausado hasta ${formatDate(item.pause_until)}`
      : 'Pausado hasta reactivar';
  }
  if (status === 'PAYMENT_FAILED') {
    return 'Pago fallido: revisa el metodo de pago';
  }
  if (item.next_charge_at) return `Proximo cobro: ${formatDate(item.next_charge_at)}`;
  if (item.current_period_end) return `Periodo actual hasta ${formatDate(item.current_period_end)}`;
  return 'Mensual';
}

function resolveCampusProviderLabel(item) {
  const provider = (item.provider || '').toString().toLowerCase();
  if (provider === 'stripe') return 'Procesado por Stripe';
  if (provider === 'wompi') return 'Procesado por Wompi';
  return 'Procesador pendiente';
}

function renderCampusSummary(donations, subscriptions, campusSubscriptions = []) {
  if (!campusGivingList || !campusGivingEmpty) return;
  campusGivingList.innerHTML = '';

  const realRecurring = (campusSubscriptions || []).filter((item) => {
    const status = (item.status || 'ACTIVE').toString().toUpperCase();
    return !['CANCELLED', 'ENDED', 'DISABLED'].includes(status);
  });
  const reminderRecurring = (subscriptions || []).filter((item) => {
    const status = (item.status || 'ACTIVE').toString().toUpperCase();
    return !['CANCELLED', 'ENDED', 'DISABLED'].includes(status) && isCampusDonation(item);
  });
  const oneTime = (donations || []).filter((item) => !item.is_recurring && isCampusDonation(item));
  const items = [
    ...realRecurring.map((item) => ({ ...item, _type: 'campus-subscription' })),
    ...reminderRecurring.map((item) => ({ ...item, _type: 'recurring-reminder' })),
    ...oneTime.slice(0, 6).map((item) => ({ ...item, _type: 'one-time' })),
  ];

  if (campusGivingCta) {
    campusGivingCta.toggleAttribute('hidden', !items.length);
  }

  if (!items.length) {
    campusGivingEmpty.classList.remove('hidden');
    return;
  }
  campusGivingEmpty.classList.add('hidden');

  items.forEach((item) => {
    const amount = formatCurrency(item.amount || 0, item.currency || 'COP');
    const isRealSubscription = item._type === 'campus-subscription';
    const allocations = Array.isArray(item.allocations) ? item.allocations : [];
    const missionaryNames = allocations.map((allocation) => allocation.missionary_name).filter(Boolean);
    const schedule = isRealSubscription
      ? resolveCampusSubscriptionSchedule(item)
      : item._type === 'recurring-reminder'
        ? (item.next_reminder_date ? `Próximo recordatorio: ${formatDate(item.next_reminder_date)}` : 'Próximo recordatorio: Sin fecha')
      : (item.created_at ? `Último aporte: ${formatDate(item.created_at)}` : 'Último aporte');
    const context = missionaryNames.length
      ? missionaryNames.join(', ')
      : item.campus || item.project_name || item.event_name || 'Apoyo Campus';
    const status = (item.status || (isRealSubscription || item._type === 'recurring-reminder' ? 'ACTIVE' : 'APPROVED')).toString().toUpperCase();
    const statusMap = {
      ACTIVE: { label: 'Activo', className: 'bg-emerald-100 text-emerald-700' },
      PAUSED: { label: 'Pausado', className: 'bg-amber-100 text-amber-700' },
      PENDING_SETUP: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
      INCOMPLETE: { label: 'Incompleto', className: 'bg-amber-100 text-amber-700' },
      PAYMENT_FAILED: { label: 'Pago fallido', className: 'bg-rose-100 text-rose-700' },
      CANCELLED: { label: 'Cancelado', className: 'bg-slate-100 text-slate-600' },
      ENDED: { label: 'Finalizado', className: 'bg-slate-100 text-slate-600' },
      DISABLED: { label: 'Desactivado', className: 'bg-slate-100 text-slate-600' },
      APPROVED: { label: 'Aprobado', className: 'bg-emerald-100 text-emerald-700' },
      PENDING: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
    };
    const statusInfo = statusMap[status] || { label: status, className: 'bg-slate-100 text-slate-600' };
    const canManageReminder = item._type === 'recurring-reminder' && item.id;
    const canManageReal = isRealSubscription && item.id;
    const isPaused = status === 'PAUSED';
    const primaryAction = isPaused ? 'resume' : 'pause';
    const primaryLabel = isPaused ? 'Reactivar' : 'Pausar temporada';
    const safeContext = safeText(context);
    const safeSchedule = safeText(schedule);
    const safeAmount = safeText(amount);
    const safeStatusLabel = safeText(statusInfo.label);
    const safePrimaryLabel = safeText(primaryLabel);
    const safeSubscriptionId = safeAttr(item.id || '');
    const safeNextReminderDate = safeAttr((item.next_reminder_date || '').toString());
    const safeProvider = safeText(resolveCampusProviderLabel(item));
    const canOpenProviderPortal = isRealSubscription && item.provider === 'stripe' && item.provider_customer_id;

    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-100 bg-white p-4 shadow-sm';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Campus</p>
          <p class="text-sm font-bold text-[#293C74] mt-1">${safeContext}</p>
          <p class="text-xs text-slate-500 mt-1">${safeSchedule}</p>
          ${isRealSubscription ? `<p class="text-[11px] text-slate-400 mt-1">${safeProvider}</p>` : ''}
        </div>
        <div class="text-right">
          <p class="text-sm font-bold text-brand-teal">${safeAmount}</p>
          <span class="inline-flex mt-2 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusInfo.className}">${safeStatusLabel}</span>
        </div>
      </div>
      ${canManageReal ? `
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button"
            class="campus-subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-campus-subscription-id="${safeSubscriptionId}"
            data-campus-subscription-action="${primaryAction}">
            ${safePrimaryLabel}
          </button>
          ${canOpenProviderPortal ? `
            <button type="button"
              class="campus-subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
              data-campus-subscription-id="${safeSubscriptionId}"
              data-campus-subscription-action="manage">
              Metodo de pago
            </button>
          ` : ''}
          <button type="button"
            class="campus-subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest bg-red-50 text-red-600 hover:bg-red-100"
            data-campus-subscription-id="${safeSubscriptionId}"
            data-campus-subscription-action="cancel">
            Cancelar
          </button>
        </div>
      ` : canManageReminder ? `
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="${primaryAction}">
            ${safePrimaryLabel}
          </button>
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="reschedule"
            data-subscription-next-date="${safeNextReminderDate}">
            Cambiar fecha
          </button>
          <button type="button"
            class="subscription-action inline-flex min-h-11 items-center justify-center px-3 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest bg-red-50 text-red-600 hover:bg-red-100"
            data-subscription-id="${safeSubscriptionId}"
            data-subscription-action="cancel">
            Cancelar
          </button>
        </div>
      ` : ''}
    `;
    campusGivingList.appendChild(card);
  });
}

function renderLocalEvents(events) {
  if (!localEventsList || !localEventsEmpty) return;
  localEventsList.innerHTML = '';
  const upcoming = (events || []).filter((event) => {
    const start = toDate(event.start_date);
    return !start || start >= new Date();
  }).slice(0, 6);

  if (!upcoming.length) {
    localEventsEmpty.classList.remove('hidden');
    return;
  }
  localEventsEmpty.classList.add('hidden');

  upcoming.forEach((event) => {
    const start = toDate(event.start_date);
    const end = toDate(event.end_date);
    const dateLabel = start ? formatDateTime(start) : 'Fecha por confirmar';
    const locationParts = [event.location_name, event.location_address, event.city, event.country].filter(Boolean);
    const location = locationParts.join(' · ') || 'Ubicación por confirmar';
    const scopeLabel = event.scope === 'GLOBAL'
      ? 'Global'
      : event.scope === 'NATIONAL'
        ? 'Nacional'
        : 'Local';
    const safeScopeLabel = safeText(scopeLabel);
    const safeTitle = safeText(event.title || '');
    const safeDateLabel = safeText(dateLabel);
    const safeEndLabel = safeText(end ? formatDate(end) : '');
    const safeLocation = safeText(location);
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-100 bg-white p-5 shadow-sm';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${safeScopeLabel}</p>
          <h3 class="text-base font-bold text-[#293C74] mt-1">${safeTitle}</h3>
          <p class="text-xs text-slate-500 mt-2">${safeDateLabel}</p>
          ${end ? `<p class="text-[11px] text-slate-400">Finaliza: ${safeEndLabel}</p>` : ''}
          <p class="text-xs text-slate-500 mt-2">${safeLocation}</p>
        </div>
      </div>
    `;
    localEventsList.appendChild(card);
  });
}

async function handleDonationSubscriptionAction(button) {
  const subscriptionId = button.getAttribute('data-subscription-id');
  const action = button.getAttribute('data-subscription-action');
  if (!subscriptionId || !action) return;
  let nextReminderDate = '';

  if (action === 'cancel') {
    const confirmed = await showPortalConfirm('¿Deseas cancelar este aporte recurrente? Puedes volver a activarlo más adelante desde el portal.', {
      title: 'Cancelar aporte',
      confirmLabel: 'Cancelar aporte',
      tone: 'danger',
    });
    if (!confirmed) return;
  }

  if (action === 'reschedule') {
    const currentDate = (button.getAttribute('data-subscription-next-date') || '').trim();
    const requestedDate = window.prompt('Nueva fecha de cobro (YYYY-MM-DD)', currentDate || '');
    if (requestedDate === null) return;
    nextReminderDate = requestedDate.trim();
    if (!isValidDateOnlyInput(nextReminderDate)) {
      showPortalAlert('Usa el formato YYYY-MM-DD.');
      return;
    }
  }

  const originalText = button.textContent;
  button.textContent = 'Procesando...';
  button.disabled = true;

  try {
    const res = await fetch('/api/portal/donations/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      credentials: 'include',
      body: JSON.stringify({
        id: subscriptionId,
        action,
        ...(nextReminderDate ? { nextReminderDate } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');

    if (portalAccountPayload?.donationSubscriptions) {
      const idx = portalAccountPayload.donationSubscriptions.findIndex((item) => item.id === subscriptionId);
      if (idx !== -1) {
        portalAccountPayload.donationSubscriptions[idx] = {
          ...portalAccountPayload.donationSubscriptions[idx],
          status: data.subscription?.status || portalAccountPayload.donationSubscriptions[idx].status,
          next_reminder_date: data.subscription?.next_reminder_date || portalAccountPayload.donationSubscriptions[idx].next_reminder_date,
        };
      }
    }

    renderGivingSummary(
      portalAccountPayload?.donations || [],
      portalAccountPayload?.donationSubscriptions || [],
      portalAccountPayload?.donationRecurringSubscriptions || [],
    );
    renderCampusSummary(
      portalAccountPayload?.donations || [],
      portalAccountPayload?.donationSubscriptions || [],
      portalAccountPayload?.campusSubscriptions || [],
    );
    const successMessages = {
      pause: 'Tu aporte quedó pausado.',
      resume: 'Tu aporte quedó reactivado.',
      cancel: 'Tu aporte fue cancelado.',
      reschedule: 'Fecha de cobro actualizada.',
    };
    showPortalAlert(successMessages[action] || 'Actualizado correctamente.', { title: 'Listo' });
  } catch (err) {
    console.error(err);
    showPortalAlert(err.message || 'No se pudo actualizar el aporte.');
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function handleGivingRecurringAction(button) {
  const subscriptionId = button.getAttribute('data-giving-subscription-id');
  const action = button.getAttribute('data-giving-subscription-action');
  if (!subscriptionId || !action) return;

  let pauseUntil = '';
  if (action === 'pause') {
    const requestedDate = window.prompt(
      'Pausar hasta (YYYY-MM-DD). Deja vacio para pausar hasta que la reactives manualmente.',
      '',
    );
    if (requestedDate === null) return;
    pauseUntil = requestedDate.trim();
    if (pauseUntil && !isValidDateOnlyInput(pauseUntil)) {
      showPortalAlert('Usa el formato YYYY-MM-DD o deja el campo vacio.');
      return;
    }
  }

  if (action === 'cancel') {
    const confirmed = await showPortalConfirm(
      'Esto cancela los cobros futuros de esta donacion recurrente. Los pagos ya procesados no se devuelven automaticamente y se revisan caso por caso.',
      {
        title: 'Cancelar donacion recurrente',
        confirmLabel: 'Cancelar futuros cobros',
        tone: 'danger',
      },
    );
    if (!confirmed) return;
  }

  const originalText = button.textContent;
  button.textContent = 'Procesando...';
  button.disabled = true;

  try {
    const res = await fetch('/api/portal/donations/recurring-subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      credentials: 'include',
      body: JSON.stringify({
        id: subscriptionId,
        action,
        ...(pauseUntil ? { pauseUntil } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');

    if (action === 'manage' && data.url) {
      window.location.href = data.url;
      return;
    }

    if (portalAccountPayload?.donationRecurringSubscriptions) {
      const idx = portalAccountPayload.donationRecurringSubscriptions.findIndex((item) => item.id === subscriptionId);
      if (idx !== -1) {
        portalAccountPayload.donationRecurringSubscriptions[idx] = {
          ...portalAccountPayload.donationRecurringSubscriptions[idx],
          ...(data.subscription || {}),
        };
      }
    }

    renderGivingSummary(
      portalAccountPayload?.donations || [],
      portalAccountPayload?.donationSubscriptions || [],
      portalAccountPayload?.donationRecurringSubscriptions || [],
    );

    const successMessages = {
      pause: 'Tu donacion recurrente quedo pausada.',
      resume: 'Tu donacion recurrente quedo reactivada.',
      cancel: 'Tu donacion recurrente fue cancelada para cobros futuros.',
    };
    showPortalAlert(successMessages[action] || 'Actualizado correctamente.', { title: 'Listo' });
  } catch (err) {
    console.error(err);
    showPortalAlert(err.message || 'No se pudo actualizar la donacion recurrente.');
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function handleCampusSubscriptionAction(button) {
  const subscriptionId = button.getAttribute('data-campus-subscription-id');
  const action = button.getAttribute('data-campus-subscription-action');
  if (!subscriptionId || !action) return;

  let pauseUntil = '';
  if (action === 'pause') {
    const requestedDate = window.prompt(
      'Pausar hasta (YYYY-MM-DD). Deja vacio para pausar hasta que la reactives manualmente.',
      '',
    );
    if (requestedDate === null) return;
    pauseUntil = requestedDate.trim();
    if (pauseUntil && !isValidDateOnlyInput(pauseUntil)) {
      showPortalAlert('Usa el formato YYYY-MM-DD o deja el campo vacio.');
      return;
    }
  }

  if (action === 'cancel') {
    const confirmed = await showPortalConfirm(
      'Esto cancela los cobros futuros de esta siembra. Los pagos ya procesados no se devuelven automaticamente y se revisan caso por caso.',
      {
        title: 'Cancelar siembra Campus',
        confirmLabel: 'Cancelar futuros cobros',
        tone: 'danger',
      },
    );
    if (!confirmed) return;
  }

  const originalText = button.textContent;
  button.textContent = 'Procesando...';
  button.disabled = true;

  try {
    const res = await fetch('/api/portal/campus/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      credentials: 'include',
      body: JSON.stringify({
        id: subscriptionId,
        action,
        ...(pauseUntil ? { pauseUntil } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');

    if (action === 'manage' && data.url) {
      window.location.href = data.url;
      return;
    }

    if (portalAccountPayload?.campusSubscriptions) {
      const idx = portalAccountPayload.campusSubscriptions.findIndex((item) => item.id === subscriptionId);
      if (idx !== -1) {
        portalAccountPayload.campusSubscriptions[idx] = {
          ...portalAccountPayload.campusSubscriptions[idx],
          ...(data.subscription || {}),
        };
      }
    }

    renderCampusSummary(
      portalAccountPayload?.donations || [],
      portalAccountPayload?.donationSubscriptions || [],
      portalAccountPayload?.campusSubscriptions || [],
    );

    const successMessages = {
      pause: 'Tu siembra Campus quedo pausada.',
      resume: 'Tu siembra Campus quedo reactivada.',
      cancel: 'Tu siembra Campus fue cancelada para cobros futuros.',
    };
    showPortalAlert(successMessages[action] || 'Actualizado correctamente.', { title: 'Listo' });
  } catch (err) {
    console.error(err);
    showPortalAlert(err.message || 'No se pudo actualizar la siembra Campus.');
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
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
  openPortalModal(onboardingModal, onboardName);

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
    const roleLabel = membership.role === 'church_admin'
      ? 'Pastor (Admin)'
      : membership.role === 'church_member'
        ? 'Colaborador (Registrar)'
        : (membership.role || '—');
    const card = document.createElement('div');
    card.className = 'rounded-2xl border border-slate-100 bg-slate-50/80 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3';
    const isApprovedMembership = isApprovedChurchMembershipStatus(membership.status);
    const statusLabel = isApprovedMembership ? 'Aprobado' : membership.status === 'rejected' ? 'Rechazado' : 'Pendiente';
    const safeRoleLabel = safeText(roleLabel);
    const safeStatusLabel = safeText(statusLabel);
    const safeChurchName = safeText(membership.church?.name || 'Iglesia sin nombre');
    const safeChurchCity = safeText(membership.church?.city || '');
    const safeChurchCountry = safeText(membership.church?.country || '');
    card.innerHTML = `
      <div>
        <p class="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Sede</p>
        <p class="text-lg font-bold text-[#293C74]">${safeChurchName}</p>
        <p class="text-xs text-slate-500">${safeChurchCity} ${safeChurchCountry ? `· ${safeChurchCountry}` : ''}</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-white border border-slate-200 text-slate-500 whitespace-nowrap">${safeRoleLabel}</span>
        <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${isApprovedMembership ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'} whitespace-nowrap">${safeStatusLabel}</span>
      </div>
    `;
    churchMembershipsList.appendChild(card);
  });
}

async function updateProfile() {
  profileStatus.textContent = 'Guardando...';
  profileStatus.className = 'text-sm font-medium text-white/40';
  try {
    const res = await fetch('/api/portal/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...portalAuthHeaders,
      },
      body: JSON.stringify({
        fullName: profileName.value.trim(),
        phone: profilePhone.value.trim(),
        city: profileCity.value.trim(),
        country: profileCountry.value.trim(),
        documentType: profileDocumentType?.value || '',
        documentNumber: profileDocumentNumber?.value?.trim() || '',
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
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...portalAuthHeaders,
      },
      body: JSON.stringify({ planId }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.ok) throw new Error(payload.error || 'No se pudo actualizar');
    await loadAccount();
  } catch (err) {
    console.error(err);
    showPortalAlert('No pudimos actualizar tu plan. Intenta nuevamente.');
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
    showPortalAlert(err.message || 'No se pudo generar el link.');
  } finally {
    setTimeout(() => {
      target.disabled = false;
      target.textContent = originalText;
    }, 2500);
  }
}

async function handleInstallmentReschedule(event) {
  const target = event.target.closest('.installment-reschedule');
  if (!target) return;
  const installmentId = target.dataset.installment;
  if (!installmentId) return;

  const currentDate = (target.dataset.dueDate || '').trim();
  const requestedDate = window.prompt('Nueva fecha de cuota (YYYY-MM-DD)', currentDate || '');
  if (requestedDate === null) return;

  const dueDate = requestedDate.trim();
  if (!isValidDateOnlyInput(dueDate)) {
    showPortalAlert('Usa el formato YYYY-MM-DD.');
    return;
  }

  const originalText = target.textContent;
  target.textContent = 'Actualizando...';
  target.disabled = true;

  try {
    const res = await fetch('/api/cuenta/installments/reschedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      body: JSON.stringify({ installmentId, dueDate }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar la fecha');
    await loadAccount();
    showPortalAlert('Fecha de cuota actualizada.');
  } catch (err) {
    console.error(err);
    showPortalAlert(err.message || 'No se pudo actualizar la fecha.');
    target.textContent = originalText;
    target.disabled = false;
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
    showPortalAlert(err.message || 'No se pudo actualizar el rol.');
  }
});

adminFollowupsFilters?.addEventListener('click', (event) => {
  const target = event.target.closest('[data-filter]');
  if (!target) return;
  adminIssuesFilter = target.dataset.filter || 'all';
  adminIssuesPage = 1;
  renderAdminFollowups(adminIssuesData, adminIssuesCounts);
});
adminFollowupsSearch?.addEventListener('input', () => {
  adminIssuesPage = 1;
  renderAdminFollowups(adminIssuesData, adminIssuesCounts);
});
adminFollowupsSort?.addEventListener('change', () => {
  adminIssuesPage = 1;
  renderAdminFollowups(adminIssuesData, adminIssuesCounts);
});
adminFollowupsPageSize?.addEventListener('change', () => {
  adminIssuesPage = 1;
  renderAdminFollowups(adminIssuesData, adminIssuesCounts);
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
    showPortalAlert(err.message || 'No se pudo enviar.');
  }
});

adminFollowupsList?.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const bookingId = target.dataset.booking;
  if (!bookingId) return;

  if (action === 'notify-email') {
    const kind = target.dataset.kind || 'registration_incomplete';
    const originalText = target.textContent;
    target.textContent = 'Enviando...';
    target.setAttribute('disabled', 'disabled');
    if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Enviando correo...';

    try {
      const res = await fetch('/api/portal/admin/cumbre/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ bookingId, kind }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo enviar');
      target.textContent = 'Enviado';
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Correo enviado.';
      setTimeout(() => {
        loadAdminFollowups(portalAuthHeaders);
      }, 800);
    } catch (err) {
      console.error(err);
      target.textContent = originalText;
      target.removeAttribute('disabled');
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = err?.message || 'No se pudo enviar el correo.';
      showPortalAlert(err?.message || 'No se pudo enviar el correo.');
    }
    return;
  }

  if (action === 'recompute') {
    const originalText = target.textContent;
    target.textContent = 'Recalculando...';
    target.setAttribute('disabled', 'disabled');
    if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Recalculando totales...';
    try {
      const res = await fetch('/api/portal/admin/cumbre/recompute', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ bookingId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo recalcular');
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Totales actualizados.';
      target.textContent = 'Listo';
      setTimeout(() => {
        loadAdminFollowups(portalAuthHeaders);
      }, 800);
    } catch (err) {
      console.error(err);
      target.textContent = originalText;
      target.removeAttribute('disabled');
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = err?.message || 'No se pudo recalcular.';
      showPortalAlert(err?.message || 'No se pudo recalcular.');
    }
    return;
  }

  if (action === 'assign-church') {
    const card = target.closest('.admin-issue-card');
    const select = card?.querySelector('[data-role=\"assign-church\"]');
    if (!(select instanceof HTMLSelectElement)) return;
    const churchId = select.value;
    const churchName = churchId === '__virtual__'
      ? 'Ministerio Virtual'
      : select.options[select.selectedIndex]?.text || '';
    if (!churchId) {
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Selecciona una iglesia.';
      return;
    }
    const originalText = target.textContent;
    target.textContent = 'Asignando...';
    target.setAttribute('disabled', 'disabled');
    if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Asignando iglesia...';
    try {
      const res = await fetch('/api/portal/admin/cumbre/assign-church', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ bookingId, churchId, churchName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo asignar');
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Iglesia asignada.';
      target.textContent = 'Listo';
      setTimeout(() => {
        loadAdminFollowups(portalAuthHeaders);
      }, 800);
    } catch (err) {
      console.error(err);
      target.textContent = originalText;
      target.removeAttribute('disabled');
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = err?.message || 'No se pudo asignar.';
      showPortalAlert(err?.message || 'No se pudo asignar.');
    }
    return;
  }

  if (action === 'whatsapp') {
    const card = target.closest('.admin-issue-card');
    const issueType = card?.dataset.type;
    const item = adminIssuesData.find((entry) => entry.id === bookingId && (!issueType || entry.type === issueType));
    if (!item) return;
    const originalText = target.textContent;
    target.textContent = 'Enviando...';
    target.setAttribute('disabled', 'disabled');
    if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Enviando WhatsApp...';
    let sentViaApi = false;
    try {
      const res = await fetch('/api/portal/admin/cumbre/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...portalAuthHeaders },
        body: JSON.stringify({ bookingId, kind: item.type, channel: 'whatsapp', force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data?.alreadySent) {
          const sender = data.sent_by_name || data.sent_by_email || '';
          const statusEl = card?.querySelector('[data-field="whatsapp-status"]');
          if (statusEl && data.sent_at) {
            statusEl.textContent = `WhatsApp enviado${sender ? ` por ${sender}` : ''} · ${formatDateTime(data.sent_at)}`;
            statusEl.classList.add('text-emerald-600');
          }
          if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Ya estaba enviado.';
          return;
        }
        throw new Error(data.error || 'No se pudo enviar WhatsApp');
      }
      sentViaApi = true;
      if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'WhatsApp enviado.';
      const statusEl = card?.querySelector('[data-field="whatsapp-status"]');
      if (statusEl) {
        const sentAt = new Date();
        statusEl.textContent = `WhatsApp enviado · ${sentAt.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`;
        statusEl.classList.add('text-emerald-600');
      }
    } catch (err) {
      console.error(err);
      if (!sentViaApi) {
        try {
          let ctaUrl = '';
          if (item.type === 'registration_incomplete') {
            const linkRes = await fetch('/api/portal/admin/cumbre/link', {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...portalAuthHeaders },
              body: JSON.stringify({ bookingId }),
            });
            const linkData = await linkRes.json();
            if (!linkRes.ok || !linkData.ok) throw new Error(linkData.error || 'No se pudo generar el link');
            ctaUrl = linkData.ctaUrl || '';
          }

          const message = buildWhatsappMessage(item, ctaUrl);
          const phone = normalizeWhatsappPhone(item.contact_phone || '');
          if (phone) {
            const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            try {
              await navigator.clipboard.writeText(message);
              showPortalAlert('Mensaje copiado. Pégalo en WhatsApp.');
            } catch (copyErr) {
              window.prompt('Copia este mensaje para WhatsApp:', message);
            }
          }
          if (adminFollowupsStatus) adminFollowupsStatus.textContent = 'Mensaje listo.';
          const statusEl = card?.querySelector('[data-field="whatsapp-status"]');
          if (statusEl) {
            const sentAt = new Date();
            statusEl.textContent = `Mensaje preparado · ${sentAt.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`;
            statusEl.classList.add('text-amber-600');
          }
        } catch (fallbackErr) {
          console.error(fallbackErr);
          if (adminFollowupsStatus) {
            adminFollowupsStatus.textContent = fallbackErr?.message || err?.message || 'No se pudo preparar WhatsApp.';
          }
          showPortalAlert(fallbackErr?.message || err?.message || 'No se pudo preparar WhatsApp.');
        }
      }
    } finally {
      target.textContent = originalText;
      target.removeAttribute('disabled');
    }
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
      const headers = await getActionAuthHeaders();
      const res = await fetch('/api/portal/iglesia/installments/link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...headers },
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
      await sendChurchInstallmentReminder(installmentId);
      target.textContent = 'Recordatorio enviado';
      await loadChurchInstallments(portalAuthHeaders);
    }
  } catch (err) {
    console.error(err);
    target.textContent = original;
    showPortalAlert(err.message || 'No se pudo completar la acción.');
  } finally {
    setTimeout(() => {
      target.removeAttribute('disabled');
      target.textContent = original;
    }, 2500);
  }
});

churchInstallmentsRemindVisibleBtn?.addEventListener('click', async () => {
  const remindable = buildChurchInstallmentsView().filter((item) => isInstallmentRemindable(item));
  if (!remindable.length) {
    showPortalAlert('No hay cuotas visibles disponibles para recordar.');
    return;
  }

  const queue = remindable.slice(0, MAX_BULK_INSTALLMENT_REMINDERS);
  const omitted = Math.max(remindable.length - queue.length, 0);
  const overdueCount = queue.filter((item) => isInstallmentOverdue(item)).length;

  const confirmed = await showPortalConfirm(
    `Se enviarán ${queue.length} recordatorio${queue.length === 1 ? '' : 's'}`
      + `${overdueCount ? ` (${overdueCount} vencida${overdueCount === 1 ? '' : 's'})` : ''}.`
      + `${omitted ? ` Quedan ${omitted} fuera de este lote.` : ''}`,
    {
      title: 'Enviar recordatorios',
      confirmLabel: 'Enviar',
      tone: 'primary',
    },
  );
  if (!confirmed) return;

  const originalText = churchInstallmentsRemindVisibleBtn.textContent;
  churchInstallmentsRemindVisibleBtn.setAttribute('disabled', 'disabled');

  let sent = 0;
  let failed = 0;

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (churchInstallmentsStatusMsg) {
        churchInstallmentsStatusMsg.textContent = `Enviando recordatorios ${index + 1}/${queue.length}...`;
      }
      try {
        await sendChurchInstallmentReminder(current.id);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error('[portal.installments.bulk-reminder]', current.id, err);
      }
    }

    if (churchInstallmentsStatusMsg) {
      churchInstallmentsStatusMsg.textContent = failed
        ? `Listo: ${sent} enviado(s), ${failed} con error.`
        : `Listo: ${sent} recordatorio(s) enviado(s).`;
    }

    showPortalAlert(
      failed
        ? `Se enviaron ${sent} recordatorios y ${failed} fallaron.`
        : `Se enviaron ${sent} recordatorios correctamente.`,
      { title: failed ? 'Proceso completado con alertas' : 'Proceso completado' },
    );

    await loadChurchInstallments(portalAuthHeaders);
  } finally {
    churchInstallmentsRemindVisibleBtn.textContent = originalText;
    updateChurchInstallmentsBulkReminderButton(buildChurchInstallmentsView());
  }
});

churchBookingsSearch?.addEventListener('input', () => {
  updateChurchBookingsView({ resetPage: true });
});
document.getElementById('church-bookings-filters')?.addEventListener('click', (event) => {
  const target = event.target.closest('.church-bookings-filter');
  if (!target) return;
  const filter = target.dataset.filter || 'all';
  if (churchBookingsStatus) {
    churchBookingsStatus.value = filter;
  }
  document.querySelectorAll('.church-bookings-filter').forEach((btn) => {
    btn.classList.remove('bg-[#293C74]', 'text-white', 'shadow-sm');
    btn.classList.add('bg-white', 'text-slate-500', 'border', 'border-slate-100');
  });
  target.classList.remove('bg-white', 'text-slate-500', 'border', 'border-slate-100');
  target.classList.add('bg-[#293C74]', 'text-white', 'shadow-sm');
  updateChurchBookingsView({ resetPage: true });
});
churchBookingsStatus?.addEventListener('change', () => {
  updateChurchBookingsView({ resetPage: true });
});
churchBookingsSort?.addEventListener('change', () => {
  updateChurchBookingsView({ resetPage: true });
});
churchBookingsPageSize?.addEventListener('change', () => {
  updateChurchBookingsView({ resetPage: true });
});
churchParticipantsSearch?.addEventListener('input', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsViewToggle?.addEventListener('click', (event) => {
  const target = event.target.closest('.church-participants-view-btn');
  if (!target) return;
  setChurchParticipantsViewMode(target.dataset.view || 'cards');
  updateChurchParticipantsView();
});
churchParticipantsSort?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsPayment?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsLodging?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsMenu?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsAlert?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchParticipantsPageSize?.addEventListener('change', () => {
  updateChurchParticipantsView({ resetPage: true });
});
churchPaymentsSearch?.addEventListener('input', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsStatus?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsProvider?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsFrom?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsTo?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsSort?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchPaymentsPageSize?.addEventListener('change', () => {
  updateChurchPaymentsView({ resetPage: true });
});
churchInstallmentsSearch?.addEventListener('input', () => {
  updateChurchInstallmentsView({ resetPage: true });
});
churchInstallmentsStatusFilter?.addEventListener('change', () => {
  updateChurchInstallmentsView({ resetPage: true });
});
churchInstallmentsChargeFilter?.addEventListener('change', () => {
  updateChurchInstallmentsView({ resetPage: true });
});
churchInstallmentsPageSize?.addEventListener('change', () => {
  updateChurchInstallmentsView({ resetPage: true });
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
churchAuditBtn?.addEventListener('click', () => {
  void exportCumbrePackageAudit();
});


const churchFormContainer = document.getElementById('church-manual-form-container');
const churchFormCloseBtn = document.getElementById('church-form-close');
const inviteToggleBtn = document.getElementById('btn-toggle-invite');

function openManualRegistrationFallback() {
  const modal = document.getElementById('manual-registration-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  } else {
    console.error('[DEBUG] Modal manual-registration-modal not found');
  }
}

async function openAdvancedRegistrationModal() {
  try {
    const { registrationModal } = await ensureAdvancedComponents();
    if (registrationModal?.open) {
      registrationModal.open();
      return;
    }
  } catch (err) {
    console.error('[portal.dashboard] advanced registration modal failed', err);
  }
  openManualRegistrationFallback();
}

// Manual Registration Modal Trigger
// Variable declared at top is 'churchFormToggle'
churchFormToggle?.addEventListener('click', async () => {
  console.log('[DEBUG] Open manual registration modal clicked');

  // Validation: Check if admin has selected a church
  if (requiresScopedChurchSelection()) {
    showPortalAlert('Por favor selecciona una iglesia en el panel superior antes de registrar.');
    return;
  }

  await openAdvancedRegistrationModal();
});

// Manual Modal Close Handlers
const manualModalCloseBtn = document.getElementById('btn-close-manual-modal');
const manualModalCancelBtn = document.getElementById('btn-cancel-manual-reg');
const manualModal = document.getElementById('manual-registration-modal');

function closeManualModal() {
  if (manualModal) {
    manualModal.classList.add('hidden');
    manualModal.classList.remove('flex');
    document.body.style.overflow = '';
    // Reset form
    document.getElementById('manual-registration-form')?.reset();
    document.getElementById('manual-reg-status').textContent = '';
  }
}

manualModalCloseBtn?.addEventListener('click', closeManualModal);
manualModalCancelBtn?.addEventListener('click', closeManualModal);

// Close on click outside
manualModal?.addEventListener('click', (e) => {
  if (e.target === manualModal) closeManualModal();
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
  void handleInstallmentReschedule(event);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.subscription-action');
  if (!button) return;
  event.preventDefault();
  void handleDonationSubscriptionAction(button);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.giving-recurring-action');
  if (!button) return;
  event.preventDefault();
  void handleGivingRecurringAction(button);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.campus-subscription-action');
  if (!button) return;
  event.preventDefault();
  void handleCampusSubscriptionAction(button);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.calendar-download');
  if (!button) return;
  const title = button.getAttribute('data-calendar-title') || 'Evento Maná';
  const startRaw = button.getAttribute('data-calendar-start');
  const endRaw = button.getAttribute('data-calendar-end');
  const location = button.getAttribute('data-calendar-location') || '';
  const details = button.getAttribute('data-calendar-details') || '';
  if (!startRaw) return;
  const start = new Date(startRaw);
  const end = endRaw ? new Date(endRaw) : null;
  const icsContent = buildIcsContent({ title, start, end, location, details });
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/\s+/g, '-').toLowerCase()}-${start.toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
    const res = await fetch('/api/portal/profile', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...portalAuthHeaders,
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

    closePortalModal(onboardingModal);
  } catch (err) {
    console.error(err);
    onboardingStatus.textContent = err?.message || 'No pudimos guardar tu perfil. Intenta de nuevo.';
  }
});
plansList?.addEventListener('click', handlePlanAction);


const updatePasswordBtn = document.getElementById('btn-update-password');
const newPasswordInput = document.getElementById('security-new-password');
const securityStatus = document.getElementById('security-status');

function getPasswordStrengthErrors(value) {
  const errors = [];
  if (!value || value.length < 10) errors.push('mínimo 10 caracteres');
  if (!/[a-z]/.test(value)) errors.push('una minúscula');
  if (!/[A-Z]/.test(value)) errors.push('una mayúscula');
  if (!/[0-9]/.test(value)) errors.push('un número');
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) errors.push('un símbolo');
  return errors;
}

function formatPasswordStrengthErrors(errors) {
  if (!errors.length) return '';
  if (errors.length === 1) return `La contraseña debe incluir ${errors[0]}.`;
  const last = errors[errors.length - 1];
  return `La contraseña debe incluir ${errors.slice(0, -1).join(', ')} y ${last}.`;
}

updatePasswordBtn?.addEventListener('click', async () => {
  if (!newPasswordInput || !securityStatus) return;
  if (authMode === 'password') {
    securityStatus.textContent = 'Función no disponible en este modo.';
    securityStatus.className = 'text-sm font-medium text-red-500';
    return;
  }
  const password = newPasswordInput.value.trim();
  const strengthErrors = getPasswordStrengthErrors(password);
  if (strengthErrors.length) {
    securityStatus.textContent = formatPasswordStrengthErrors(strengthErrors);
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
    const supabase = await getSupabaseClientForAction();
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

deleteAccountBtn?.addEventListener('click', async () => {
  if (!deleteAccountConfirmInput) return;
  if (authMode === 'password') {
    setDeleteAccountState('No disponible en modo de sesión operativa.', 'error');
    return;
  }

  const confirmText = (deleteAccountConfirmInput.value || '').trim().toUpperCase();
  if (confirmText !== 'ELIMINAR') {
    setDeleteAccountState('Debes escribir ELIMINAR para continuar.', 'error');
    return;
  }

  const confirmed = await showPortalConfirm(
    'Esta acción desactivará tu acceso al portal y cerrará tu sesión. No se puede deshacer desde la app.',
    {
      title: 'Eliminar cuenta',
      confirmLabel: 'Sí, eliminar',
      tone: 'danger',
    },
  );
  if (!confirmed) return;

  const originalText = deleteAccountBtn.textContent;
  deleteAccountBtn.textContent = 'Eliminando...';
  deleteAccountBtn.disabled = true;
  setDeleteAccountState('Procesando solicitud...', 'neutral');

  try {
    const reason = (deleteAccountReasonInput?.value || '').trim();
    const res = await fetch('/api/cuenta/eliminar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portalAuthHeaders },
      credentials: 'include',
      body: JSON.stringify({ confirmText, reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta');

    setDeleteAccountState('Cuenta eliminada. Cerrando sesión...', 'success');

    try {
      if (authMode !== 'password') {
        const supabase = await getSupabaseClientForAction();
        await supabase.auth.signOut({ scope: 'local' });
      }
      await fetch('/api/portal/password-logout', { method: 'POST', credentials: 'include' });
    } catch (cleanupErr) {
      console.error('[delete.account] cleanup error', cleanupErr);
    }

    window.location.href = '/portal/ingresar?account_deleted=1';
  } catch (err) {
    console.error(err);
    setDeleteAccountState(err.message || 'No se pudo eliminar la cuenta.', 'error');
    deleteAccountBtn.textContent = originalText;
    deleteAccountBtn.disabled = false;
  }
});


const registerPasskeyBtn = document.getElementById('btn-register-passkey');
const passkeyStatus = document.getElementById('passkey-status');

registerPasskeyBtn?.addEventListener('click', async () => {
  if (!passkeyStatus) return;
  if (authMode === 'password') {
    passkeyStatus.textContent = 'Passkeys no disponible en este modo.';
    passkeyStatus.className = 'text-xs text-center mt-2 font-medium text-red-500';
    return;
  }
  passkeyStatus.textContent = 'Iniciando registro de Passkey...';
  passkeyStatus.className = 'text-xs text-center mt-2 font-medium text-slate-500';
  registerPasskeyBtn.disabled = true;
  registerPasskeyBtn.classList.add('opacity-50');

  try {
    const supabase = await getSupabaseClientForAction();
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
async function initDashboard() {
  const cleared = await clearStaleServiceWorkersOnce();
  if (cleared) {
    dlog('[DEBUG] Cleared stale service workers. Reloading...');
    window.location.reload();
    return;
  }

  // 1. Clean Slate Auth Check
  dlog('[DEBUG] Starting Clean Auth Check...');
  const auth = await ensureAuthenticated();

  if (!auth.isAuthenticated) {
    console.warn('[DEBUG] Not authenticated. Redirecting...');
    if (loadingEl) loadingEl.classList.add('hidden');
    // Allow a brief moment for any pending logs/events? No, fail fast.
    redirectToLogin();
    return;
  }

  dlog('[DEBUG] Authenticated!', auth);
  cleanupAuthRedirect(); // Clean URL hash/params if present

  // 2. Load Dashboard
  await loadDashboardData(auth);

  // 3. Handle Deep Linking (Tab Restore)
  const urlParams = new URLSearchParams(window.location.search);
  const tab = urlParams.get('tab');
  if (tab) {
    switchTab(tab);
  }
}

initDashboard();

// Church Catalog Helpers
function populateChurchesUI(catalog) {
  if (!catalog || !catalog.length) return;

  // Populate Datalist for Manual Registration
  const dataList = document.getElementById('churches-list');
  if (dataList) {
    dataList.innerHTML = catalog.map(c => {
      const label = `${c.name || ''} - ${c.city || ''}`.trim();
      const safeLabel = safeAttr(label);
      const safeAddress = safeText(c.address || '');
      return `<option value="${safeLabel}">${safeAddress}</option>`;
    }).join('');
  }

  if (inviteChurchInput) {
    inviteChurchInput.innerHTML = '<option value="">Selecciona una iglesia</option>';
    catalog.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const cityLabel = c.city || c.country || 'Ciudad';
      const countryLabel = c.country ? ` · ${c.country}` : '';
      opt.textContent = `${cityLabel} - ${c.name}${countryLabel}`;
      inviteChurchInput.appendChild(opt);
    });
    const selected = resolveSelectedChurchId();
    if (selected) inviteChurchInput.value = selected;
  }
}

// Church Input Logic (Auto-fill city/country)
const regChurchInput = document.getElementById('reg-church');
regChurchInput?.addEventListener('input', (e) => { // 'input' event triggers on autocomplete selection too usually
  const val = e.target.value;
  if (!portalChurchesCatalog) return;

  // Try to find by "Name - City" format or just Name
  const found = portalChurchesCatalog.find(c => `${c.name} - ${c.city}` === val || c.name === val);

  if (found) {
    const cityInput = document.getElementById('reg-city');
    const countryInput = document.getElementById('reg-country');
    // Only auto-fill if empty or explicit override? let's override for convenience
    if (cityInput) cityInput.value = found.city;
    if (countryInput) countryInput.value = found.country || 'Colombia';
  }
});
// Admin Sync Logic
const syncBtn = document.getElementById('btn-sync-churches');
const syncWrapper = document.getElementById('admin-sync-wrapper');

if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    const statusEl = document.getElementById('sync-status');
    const originalText = syncBtn.innerHTML;

    syncBtn.disabled = true;
    syncBtn.textContent = 'Sincronizando...';
    if (statusEl) statusEl.textContent = 'Conectando con base de datos...';

    try {
      const res = await fetch('/api/portal/admin/seed-churches', {
        method: 'POST',
        headers: portalAuthHeaders
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Error al sincronizar');

      if (statusEl) {
        statusEl.textContent = data.message;
        statusEl.className = 'text-[10px] text-center text-green-500 font-bold mt-1';
      }
      setTimeout(() => {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
        // Reload catalog to reflect changes immediately
        window.location.reload();
      }, 2000);

    } catch (err) {
      console.error(err);
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalText;
      if (statusEl) {
        statusEl.textContent = err.message;
        statusEl.className = 'text-[10px] text-center text-red-500 font-bold mt-1';
      }
    }
  });
}

// ======================================
// Advanced Registration Modal & Church Selector Initialization
// ======================================
let advancedChurchSelector;
let advancedRegistrationModal;
let advancedComponentsLoadPromise = null;
let advancedComponentsReadyPromise = null;
let advancedComponentsScheduled = false;

function loadAdvancedComponentClasses() {
  if (!advancedComponentsLoadPromise) {
    advancedComponentsLoadPromise = Promise.all([
      import('./ChurchSelector.js'),
      import('./RegistrationModal.js'),
    ]).then(([churchModule, registrationModule]) => ({
      ChurchSelector: churchModule.ChurchSelector,
      RegistrationModal: registrationModule.RegistrationModal,
    })).catch((err) => {
      advancedComponentsLoadPromise = null;
      throw err;
    });
  }
  return advancedComponentsLoadPromise;
}

function bindAdvancedRegistrationButtons() {
  const btnOpenChurchSelector = document.getElementById('btn-open-church-selector');
  if (btnOpenChurchSelector && btnOpenChurchSelector.dataset.advancedBound !== '1') {
    const newBtn = btnOpenChurchSelector.cloneNode(true);
    newBtn.dataset.advancedBound = '1';
    btnOpenChurchSelector.parentNode.replaceChild(newBtn, btnOpenChurchSelector);

    newBtn.addEventListener('click', async () => {
      const { selector } = await ensureAdvancedComponents();
      selector?.open?.();
    });
  }

  if (advancedChurchSelector && advancedRegistrationModal && advancedChurchSelector.__portalOnSelectBound !== true) {
    advancedChurchSelector.onSelect((church) => {
      advancedRegistrationModal.setChurch(church);
    });
    advancedChurchSelector.__portalOnSelectBound = true;
  }

  const toggle = document.getElementById('church-form-toggle');
  if (toggle && toggle.dataset.advancedBound !== '1') {
    const newToggle = toggle.cloneNode(true);
    newToggle.dataset.advancedBound = '1';
    toggle.parentNode.replaceChild(newToggle, toggle);

    newToggle.addEventListener('click', async () => {
      if (requiresScopedChurchSelection()) {
        showPortalAlert('Por favor selecciona una iglesia en el panel superior antes de registrar.');
        return;
      }
      await openAdvancedRegistrationModal();
    });
  }
}

async function ensureAdvancedComponents() {
  if (advancedChurchSelector && advancedRegistrationModal) {
    if (portalChurchesCatalog?.length) {
      advancedChurchSelector.setChurches(portalChurchesCatalog);
    }
    return { selector: advancedChurchSelector, registrationModal: advancedRegistrationModal };
  }

  if (!advancedComponentsReadyPromise) {
    advancedComponentsReadyPromise = (async () => {
      const modalElement = document.getElementById('manual-registration-modal');
      if (!modalElement) return;

      const { ChurchSelector, RegistrationModal } = await loadAdvancedComponentClasses();

      if (!advancedChurchSelector) {
        advancedChurchSelector = new ChurchSelector(portalChurchesCatalog || []);
        window.advancedChurchSelector = advancedChurchSelector;
      }

      if (!advancedRegistrationModal) {
        advancedRegistrationModal = new RegistrationModal();
      }

      bindAdvancedRegistrationButtons();

      if (portalChurchesCatalog?.length) {
        advancedChurchSelector.setChurches(portalChurchesCatalog);
      }
    })().catch((err) => {
      advancedComponentsReadyPromise = null;
      throw err;
    });
  }

  await advancedComponentsReadyPromise;
  return { selector: advancedChurchSelector, registrationModal: advancedRegistrationModal };
}

function scheduleAdvancedComponentsInit() {
  if (advancedComponentsScheduled) return;
  if (!document.getElementById('manual-registration-modal')) return;
  advancedComponentsScheduled = true;

  const init = () => {
    void ensureAdvancedComponents().catch((err) => {
      console.error('[portal.dashboard] advanced components init failed', err);
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(init, { timeout: 2500 });
  } else {
    window.setTimeout(init, 900);
  }
}
