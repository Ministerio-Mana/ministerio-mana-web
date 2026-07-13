import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import {
  normalizeCountryGroup,
  currencyForGroup,
  sanitizeParticipant,
  calculateTotals,
  depositThreshold,
  buildPaymentReference,
  isValidPackageType,
  type PackageType,
} from '@lib/cumbre2026';
import { checkLodgingCapacity, isReopenedLodgingCreatedAt } from '@lib/cumbreLodgingCapacity';
import {
  buildInstallmentSchedule,
  getInstallmentDeadline,
  type InstallmentFrequency,
  roundCurrency,
} from '@lib/cumbreInstallments';
import {
  countPayments,
  getPlanByBookingId,
  updatePaymentPlan,
  updateInstallment,
  recomputeBookingTotals,
  applyManualPaymentToPlan,
  completePaymentPlan,
  closePaymentPlan,
} from '@lib/cumbreStore';
import { buildIdempotencyKey } from '@lib/cumbreIdempotency';
import { normalizeCityName, normalizeChurchName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { createDonation } from '@lib/donationsStore';
import { logSecurityEvent } from '@lib/securityEvents';
import { getRoleCapabilities } from '@lib/portalRbac';

export const prerender = false;

const VIRTUAL_CHURCH_NAME = 'Ministerio Maná Virtual';
const VIRTUAL_CHURCH_ALIASES = [VIRTUAL_CHURCH_NAME, 'Virtual'];

function normalizeFrequency(raw: string | null | undefined): InstallmentFrequency {
  const value = (raw || '').toString().trim().toUpperCase();
  if (value === 'BIWEEKLY' || value === 'QUINCENAL') return 'BIWEEKLY';
  return 'MONTHLY';
}

function normalizeCurrency(raw: unknown): 'COP' | 'USD' | null {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'COP' || value === 'USD') return value;
  return null;
}

function normalizeEmail(raw: unknown): string | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function parseAmountForCurrency(raw: unknown, currency: 'COP' | 'USD'): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const value = String(raw || '').trim();
  if (!value) return null;
  if (currency === 'COP') {
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) return null;
    const amount = Number(digits);
    return Number.isFinite(amount) ? amount : null;
  }
  const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseDateString(raw: unknown): string | null {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function resolveCountryGroup(rawCountryGroup: unknown, rawCountry: unknown): 'CO' | 'INT' {
  const source = (rawCountryGroup || rawCountry || '').toString().trim().toUpperCase();
  if (!source) return 'CO';
  if (source === 'VIRTUAL' || source === 'ONLINE' || source === 'N/A') return 'CO';
  return normalizeCountryGroup(source);
}

function ageFromBirthdate(raw: unknown): number | null {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function resolveParticipantAge(participant: any): number | null {
  const rawAge = participant?.age;
  if (rawAge !== null && rawAge !== undefined && String(rawAge).trim() !== '') {
    const age = Number(rawAge);
    return Number.isFinite(age) ? age : null;
  }
  return ageFromBirthdate(participant?.birthdate);
}

function isNoLodgingChoice(raw: unknown): boolean {
  if (raw === false) return true;
  const value = String(raw ?? '').trim().toLowerCase();
  return ['no_lodging', 'no', 'false', '0', 'sin alojamiento', 'sin_alojamiento', 'without_lodging'].includes(value);
}

function packageTypeFromAge(ageRaw: unknown, lodgingRaw: unknown): PackageType {
  const age = Number(ageRaw);
  const lodging = !isNoLodgingChoice(lodgingRaw);
  if (Number.isFinite(age)) {
    if (age <= 4) return 'child_0_7';
    if (age <= 10) return 'child_7_13';
  }
  return lodging ? 'lodging' : 'no_lodging';
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function canEditManualPayment(booking: any): boolean {
  const source = String(booking?.source || '').trim().toLowerCase();
  const paymentMethod = String(booking?.payment_method || '').trim().toLowerCase();
  return source === 'portal-iglesia'
    || source === 'cumbre-manual'
    || source === 'portal-iglesia-edit'
    || paymentMethod === 'manual'
    || paymentMethod === 'cash';
}

function isManualProvider(rawProvider: unknown): boolean {
  const provider = String(rawProvider || '').trim().toLowerCase();
  return provider === 'manual' || provider === 'cash' || provider === 'physical';
}

function canManagePaymentPlan(ctx: Awaited<ReturnType<typeof getAccessContext>>, booking: any, plan: any): boolean {
  if (ctx.canAccessFinances) return true;
  return canEditManualPayment(booking) && isManualProvider(plan?.provider);
}

function buildManualEditProviderTxId(bookingId: string, idempotencyKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`portal-iglesia-edit:${bookingId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `portal-iglesia-edit-${digest}`;
}

function buildPhysicalTopupProviderTxId(bookingId: string, idempotencyKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`portal-iglesia-physical-topup:${bookingId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `portal-iglesia-physical-${digest}`;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function getApprovedPaidTotal(bookingId: string): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { data, error } = await supabaseAdmin
    .from('cumbre_payments')
    .select('amount')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');
  if (error) {
    console.error('[portal.iglesia.booking] approved total error', error);
    return 0;
  }
  return (data || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

async function completePlanIfBookingIsPaid(params: {
  bookingId: string;
  totalAmount: number;
  totalPaid: number;
  currency: 'COP' | 'USD';
}): Promise<{ completed: boolean; cancelledInstallments: number }> {
  const epsilon = params.currency === 'USD' ? 0.01 : 1;
  if (Number(params.totalPaid || 0) + epsilon < Number(params.totalAmount || 0)) {
    return { completed: false, cancelledInstallments: 0 };
  }

  const plan = await getPlanByBookingId(params.bookingId);
  if (!plan) {
    return { completed: false, cancelledInstallments: 0 };
  }

  if (plan.provider === 'stripe' && plan.provider_subscription_id) {
    return { completed: false, cancelledInstallments: 0 };
  }

  const amountPaid = Math.min(Number(params.totalPaid || 0), Number(params.totalAmount || 0));
  const result = await completePaymentPlan(plan.id, {
    totalAmount: params.totalAmount,
    amountPaid,
    currency: params.currency,
  });

  return { completed: true, cancelledInstallments: result.cancelledInstallments };
}

async function ensurePhysicalTopupDonation(params: {
  booking: any;
  reference: string | null;
  amount: number;
  currency: 'COP' | 'USD';
  paymentMethod: string | null;
  userId?: string | null;
  idempotencyKey?: string | null;
}): Promise<void> {
  if (!supabaseAdmin || !params.reference) return;

  const { data: existingDonation, error: existingDonationError } = await supabaseAdmin
    .from('donations')
    .select('id')
    .eq('cumbre_booking_id', params.booking.id)
    .eq('reference', params.reference)
    .eq('status', 'APPROVED')
    .limit(1)
    .maybeSingle();

  if (existingDonationError) {
    console.error('[portal.iglesia.booking] physical donation lookup error', existingDonationError);
  }
  if (existingDonation?.id) return;

  await createDonation({
    provider: 'physical',
    status: 'APPROVED',
    amount: params.amount,
    currency: params.currency,
    reference: params.reference,
    provider_tx_id: null,
    payment_method: params.paymentMethod || 'physical',
    donation_type: 'evento',
    project_name: 'Cumbre Mundial 2026',
    event_name: 'Cumbre Mundial 2026',
    campus: params.booking.contact_church ?? null,
    church: params.booking.contact_church ?? null,
    church_city: params.booking.contact_city ?? null,
    donor_name: params.booking.contact_name ?? null,
    donor_email: params.booking.contact_email ?? null,
    donor_phone: params.booking.contact_phone ?? null,
    donor_document_type: params.booking.contact_document_type ?? null,
    donor_document_number: params.booking.contact_document_number ?? null,
    is_recurring: false,
    donor_country: params.booking.contact_country ?? null,
    donor_city: params.booking.contact_city ?? null,
    donation_description: null,
    need_certificate: false,
    source: 'portal-iglesia-physical-topup',
    cumbre_booking_id: params.booking.id,
    church_id: params.booking.church_id ?? null,
    user_id: params.userId ?? null,
    raw_event: {
      source: 'portal-iglesia-physical-topup',
      idempotency_key: params.idempotencyKey ?? null,
    },
  });
}

async function hasOnlinePaymentSignals(bookingId: string): Promise<boolean> {
  if (!supabaseAdmin) return true;

  const { data: payments, error: paymentsError } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, provider')
    .eq('booking_id', bookingId)
    .limit(200);
  if (paymentsError) {
    console.error('[portal.iglesia.booking] online-check payments error', paymentsError);
    return true;
  }

  const hasNonManualPayments = (payments || []).some((payment) => !isManualProvider(payment.provider));
  if (hasNonManualPayments) return true;

  const { data: plans, error: plansError } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('id, provider')
    .eq('booking_id', bookingId)
    .limit(50);
  if (plansError) {
    console.error('[portal.iglesia.booking] online-check plans error', plansError);
    return true;
  }

  const hasNonManualPlans = (plans || []).some((plan) => !isManualProvider(plan.provider));
  if (hasNonManualPlans) return true;

  const { data: donations, error: donationsError } = await supabaseAdmin
    .from('donations')
    .select('id, provider')
    .eq('cumbre_booking_id', bookingId)
    .limit(200);
  if (donationsError) {
    console.error('[portal.iglesia.booking] online-check donations error', donationsError);
    return true;
  }

  return (donations || []).some((donation) => !isManualProvider(donation.provider));
}

async function getAccessContext(request: Request) {
  const access = await getPortalChurchAccessContext(request);
  const role = String(access.role || access.profile?.role || '');
  const capabilities = getRoleCapabilities(role);
  return {
    ok: access.ok,
    reason: access.reason,
    isAdmin: access.isAdmin,
    allowedChurchId: access.allowedChurchId,
    allowedCountry: access.allowedCountry,
    isNational: access.isNational,
    isRegional: access.isRegional,
    allowedRegionIds: access.allowedRegionIds,
    profile: access.profile,
    role,
    userId: access.userId,
    canAccessFinances: Boolean(access.isAdmin || capabilities.can_access_finances),
  };
}

async function isBookingAllowed(booking: any, ctx: Awaited<ReturnType<typeof getAccessContext>>) {
  if (!ctx.ok) return false;
  if (booking.church_id) {
    return isChurchAllowedForAccess(booking.church_id, ctx as any);
  }
  if (ctx.isAdmin) return true;
  if (ctx.allowedChurchId) return false;
  if (ctx.allowedCountry) {
    const bookingCountry = normalizeCountryRegion(booking.contact_country || '').toLowerCase();
    const allowedCountry = normalizeCountryRegion(ctx.allowedCountry || '').toLowerCase();
    return Boolean(bookingCountry && bookingCountry === allowedCountry);
  }
  return false;
}

async function updatePlanForBooking(params: {
  bookingId: string;
  totalAmount: number;
  currency: 'COP' | 'USD';
  totalPaid: number;
  depositDueDate?: string | null;
}) {
  const plan = await getPlanByBookingId(params.bookingId);
  if (!plan || !supabaseAdmin) return;

  const planCurrency = params.currency;
  const planFrequency = (plan.frequency || 'MONTHLY').toUpperCase();
  const fullyPaid = await completePlanIfBookingIsPaid({
    bookingId: params.bookingId,
    totalAmount: params.totalAmount,
    totalPaid: params.totalPaid,
    currency: planCurrency,
  });

  if (fullyPaid.completed) {
    return;
  }

  if (planFrequency === 'DEPOSIT') {
    const remaining = Math.max(Number(params.totalAmount || 0) - Number(params.totalPaid || 0), 0);
    const remainingRounded = roundCurrency(remaining, planCurrency);
    await updatePaymentPlan(plan.id, {
      total_amount: remainingRounded,
      installment_amount: remainingRounded,
      installment_count: 1,
      currency: planCurrency,
    });

    const { data: installments } = await supabaseAdmin
      .from('cumbre_installments')
      .select('id, status, due_date')
      .eq('plan_id', plan.id)
      .in('status', ['PENDING', 'FAILED']);

    if (installments && installments.length > 0) {
      await Promise.all(installments.map((installment) => updateInstallment(installment.id, {
        amount: remainingRounded,
        currency: planCurrency,
      })));
      const nextDue = installments.find((i) => i.due_date)?.due_date || null;
      if (nextDue) {
        await updatePaymentPlan(plan.id, { next_due_date: nextDue });
      }
    }
    return;
  }

  const frequency = normalizeFrequency(planFrequency);
  const deadline = plan.end_date || getInstallmentDeadline();
  const startDate = plan.start_date ? new Date(`${plan.start_date}T00:00:00Z`) : new Date();
  const remainingAmount = roundCurrency(
    Math.max(Number(params.totalAmount || 0) - Number(params.totalPaid || 0), 0),
    planCurrency,
  );
  const schedule = buildInstallmentSchedule({
    totalAmount: remainingAmount,
    currency: planCurrency,
    frequency,
    startDate,
    deadline,
  });

  await updatePaymentPlan(plan.id, {
    total_amount: params.totalAmount,
    amount_paid: Math.min(Number(params.totalPaid || 0), Number(params.totalAmount || 0)),
    currency: planCurrency,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
  });

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, status, installment_index, due_date')
    .eq('plan_id', plan.id);

  const scheduleByIndex = new Map(schedule.installments.map((item) => [item.installmentIndex, item]));

  const pending = (installments || [])
    .filter((item) => ['PENDING', 'FAILED'].includes(item.status))
    .sort((a, b) => Number(a.installment_index || 0) - Number(b.installment_index || 0));
  if (pending.length) {
    const pendingAmount = roundCurrency(remainingAmount / pending.length, planCurrency);
    let accumulated = 0;
    let nextDueDate: string | null = null;
    await Promise.all(pending.map((installment, pendingIndex) => {
      const scheduleItem = schedule.installments[pendingIndex] || scheduleByIndex.get(installment.installment_index);
      const isLast = pendingIndex === pending.length - 1;
      const amount = isLast
        ? roundCurrency(remainingAmount - accumulated, planCurrency)
        : pendingAmount;
      accumulated = roundCurrency(accumulated + amount, planCurrency);
      const dueDate = scheduleItem?.dueDate || installment.due_date;
      if (!nextDueDate && dueDate) nextDueDate = dueDate;
      return updateInstallment(installment.id, {
        amount,
        due_date: dueDate,
        currency: planCurrency,
      });
    }));

    await updatePaymentPlan(plan.id, {
      installment_amount: pendingAmount,
      next_due_date: nextDueDate,
    });
  }
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const bookingId = url.searchParams.get('bookingId') || '';
  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAccessContext(request);
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, country_group, currency, total_amount, total_paid, status, payment_method, source')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = await isBookingAllowed(booking, ctx);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: participants } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, full_name, package_type, relationship, document_type, document_number, birthdate, gender, diet_type, email')
    .eq('booking_id', bookingId);

  const { data: payments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, provider, provider_tx_id, reference, amount, currency, status, created_at, installment_id')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(120);

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, paid_at, created_at, booking_id')
    .eq('booking_id', bookingId)
    .order('installment_index', { ascending: true });

  const { data: plan } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('id, status, provider, currency, total_amount, installment_count, installment_amount, frequency, next_due_date, auto_debit, provider_payment_method_id, provider_subscription_id, amount_paid')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: approvedPayments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('amount')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');

  const { data: payment } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, amount, currency, reference, created_at')
    .eq('booking_id', bookingId)
    .eq('provider', 'manual')
    .eq('status', 'APPROVED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: manualPayments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, amount, currency, reference, created_at')
    .eq('booking_id', bookingId)
    .eq('provider', 'manual')
    .eq('status', 'APPROVED')
    .order('created_at', { ascending: false })
    .limit(12);

  const totalPaid = (approvedPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalAmount = Number(booking.total_amount || 0);
  const remainingAmount = Math.max(totalAmount - totalPaid, 0);
  const hasOnlineSignals = await hasOnlinePaymentSignals(bookingId);
  const canRecordPhysicalPayment = canEditManualPayment(booking);
  const canManageCurrentPaymentPlan = Boolean(plan && canManagePaymentPlan(ctx, booking, plan));

  return new Response(JSON.stringify({
    ok: true,
    booking,
    participants: participants || [],
    payments: payments || [],
    installments: installments || [],
    plan: plan || null,
    payment: payment || null,
    manual_payments: manualPayments || [],
    payment_summary: {
      total_amount: totalAmount,
      total_paid: totalPaid,
      remaining_amount: remainingAmount,
    },
    permissions: {
      can_edit_profile: true,
      can_edit_payment: canEditManualPayment(booking),
      can_record_physical_payment: canRecordPhysicalPayment,
      can_stop_payment_plan: canManageCurrentPaymentPlan,
      can_delete_booking: canEditManualPayment(booking) && !hasOnlineSignals,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return jsonResponse({ ok: false, error: 'Supabase no configurado' }, 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return jsonResponse({ ok: false, error: 'Payload inválido' }, 400);
  }

  const action = String(body.action || '').trim();
  const bookingId = String(body.booking_id || body.bookingId || '').trim();
  if (!bookingId) {
    return jsonResponse({ ok: false, error: 'bookingId requerido' }, 400);
  }

  const ctx = await getAccessContext(request);
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return jsonResponse({ ok: false, error: denied.error }, denied.status);
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, country_group, currency, total_amount, total_paid, status, payment_method, source')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return jsonResponse({ ok: false, error: 'Reserva no encontrada' }, 404);
  }

  const allowed = await isBookingAllowed(booking, ctx);
  if (!allowed) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, 403);
  }

  const currency = normalizeCurrency(booking.currency) || 'COP';
  const totalAmount = Number(booking.total_amount || 0);
  const totalPaidBefore = await getApprovedPaidTotal(bookingId);
  const remainingBefore = Math.max(totalAmount - totalPaidBefore, 0);
  const epsilon = currency === 'USD' ? 0.01 : 1;

  if (action === 'record_physical_payment') {
    if (!canEditManualPayment(booking)) {
      return jsonResponse({
        ok: false,
        error: 'Solo se pueden registrar abonos físicos en reservas manuales o de pago físico',
      }, 409);
    }

    const amount = parseAmountForCurrency(body.amount ?? body.payment_amount ?? body.paymentAmount, currency);
    const paymentMethod = sanitizePlainText(body.payment_method ?? body.paymentMethod ?? 'physical', 40) || 'physical';

    if (amount == null || amount <= 0) {
      return jsonResponse({ ok: false, error: 'Ingresa un abono físico válido' }, 400);
    }

    if (amount > remainingBefore + epsilon) {
      return jsonResponse({
        ok: false,
        error: 'El abono supera el saldo pendiente actual',
        remaining_amount: remainingBefore,
      }, 400);
    }

    const idempotencyKey = buildIdempotencyKey({
      request,
      rawKey: body.idempotencyKey ?? body.idempotency_key,
    });
    const providerTxId = idempotencyKey
      ? buildPhysicalTopupProviderTxId(bookingId, idempotencyKey)
      : null;

    if (providerTxId) {
      const { data: existingPayment, error: existingPaymentError } = await supabaseAdmin
        .from('cumbre_payments')
        .select('id, reference, amount, currency')
        .eq('booking_id', bookingId)
        .eq('provider', 'manual')
        .eq('provider_tx_id', providerTxId)
        .maybeSingle();

      if (existingPaymentError) {
        console.error('[portal.iglesia.booking] physical payment replay lookup error', existingPaymentError);
      }

      if (existingPayment?.id) {
        await ensurePhysicalTopupDonation({
          booking,
          reference: existingPayment.reference || null,
          amount: Number(existingPayment.amount || amount),
          currency,
          paymentMethod,
          userId: ctx.userId,
          idempotencyKey,
        });
        await recomputeBookingTotals(bookingId);
        return jsonResponse({ ok: true, reference: existingPayment.reference, duplicate: true });
      }
    }

    const paymentIndex = (await countPayments(bookingId)) + 1;
    const reference = buildPaymentReference(bookingId, paymentIndex);
    const { error: paymentInsertError } = await supabaseAdmin
      .from('cumbre_payments')
      .insert({
        booking_id: bookingId,
        provider: 'manual',
        provider_tx_id: providerTxId,
        reference,
        amount,
        currency,
        status: 'APPROVED',
        raw_event: {
          source: 'portal-iglesia-physical-topup',
          method: paymentMethod,
          entered_by: ctx.userId || null,
          idempotency_key: idempotencyKey || null,
        },
      });

    if (paymentInsertError) {
      console.error('[portal.iglesia.booking] physical payment insert error', paymentInsertError);
      return jsonResponse({ ok: false, error: 'No se pudo registrar el abono físico' }, 500);
    }

    const plan = await getPlanByBookingId(bookingId);
    if (plan && !['COMPLETED', 'CANCELLED'].includes(String(plan.status || '').toUpperCase())) {
      await applyManualPaymentToPlan({
        planId: plan.id,
        amount,
        reference,
      });
    }

    await ensurePhysicalTopupDonation({
      booking,
      reference,
      amount,
      currency,
      paymentMethod,
      userId: ctx.userId,
      idempotencyKey,
    });

    await recomputeBookingTotals(bookingId);
    const totalPaidAfter = await getApprovedPaidTotal(bookingId);
    const completed = await completePlanIfBookingIsPaid({
      bookingId,
      totalAmount,
      totalPaid: totalPaidAfter,
      currency,
    });

    void logSecurityEvent({
      type: 'payment_processed',
      identifier: 'portal.iglesia.physical-topup',
      detail: 'Abono físico registrado en inscripción Cumbre',
      meta: {
        bookingId,
        amount,
        currency,
        reference,
        userId: ctx.userId || null,
        completedPlan: completed.completed,
      },
    });

    return jsonResponse({
      ok: true,
      reference,
      total_paid: totalPaidAfter,
      remaining_amount: Math.max(totalAmount - totalPaidAfter, 0),
      plan_completed: completed.completed,
    });
  }

  if (action === 'stop_payment_plan') {
    const plan = await getPlanByBookingId(bookingId);
    if (!plan) {
      return jsonResponse({ ok: false, error: 'Esta reserva no tiene plan de cobros' }, 404);
    }
    if (!canManagePaymentPlan(ctx, booking, plan)) {
      return jsonResponse({ ok: false, error: 'No autorizado para gestionar planes de cobro' }, 403);
    }

    const planStatus = String(plan.status || '').toUpperCase();
    if (planStatus === 'COMPLETED' || planStatus === 'CANCELLED') {
      return jsonResponse({ ok: true, already_closed: true });
    }

    if (plan.provider === 'stripe' && plan.provider_subscription_id) {
      return jsonResponse({
        ok: false,
        error: 'Este plan tiene suscripción activa en Stripe y requiere cancelación desde la pasarela.',
      }, 409);
    }

    const isPaid = totalPaidBefore + epsilon >= totalAmount;
    const result = await closePaymentPlan(plan.id, {
      status: isPaid ? 'COMPLETED' : 'CANCELLED',
      totalAmount,
      amountPaid: Math.min(totalPaidBefore, totalAmount),
      currency,
    });
    await recomputeBookingTotals(bookingId);

    void logSecurityEvent({
      type: 'payment_processed',
      identifier: 'portal.iglesia.stop-plan',
      detail: 'Plan de cobros Cumbre cerrado desde portal',
      meta: {
        bookingId,
        planId: plan.id,
        provider: plan.provider,
        userId: ctx.userId || null,
        cancelledInstallments: result.cancelledInstallments,
      },
    });

    return jsonResponse({
      ok: true,
      plan_closed: true,
      plan_status: isPaid ? 'COMPLETED' : 'CANCELLED',
      remaining_amount: remainingBefore,
      cancelled_installments: result.cancelledInstallments,
    });
  }

  if (action === 'update_plan_due_date') {
    const dueDate = parseDateString(body.due_date ?? body.dueDate ?? body.next_due_date ?? body.nextDueDate);
    if (!dueDate) {
      return jsonResponse({ ok: false, error: 'Fecha inválida' }, 400);
    }

    const plan = await getPlanByBookingId(bookingId);
    if (!plan) {
      return jsonResponse({ ok: false, error: 'Esta reserva no tiene plan de cobros' }, 404);
    }
    if (!canManagePaymentPlan(ctx, booking, plan)) {
      return jsonResponse({ ok: false, error: 'No autorizado para gestionar planes de cobro' }, 403);
    }

    const planStatus = String(plan.status || '').toUpperCase();
    if (planStatus === 'COMPLETED' || planStatus === 'CANCELLED') {
      return jsonResponse({ ok: false, error: 'El plan ya está cerrado' }, 409);
    }

    if (plan.provider === 'stripe' && plan.provider_subscription_id) {
      return jsonResponse({
        ok: false,
        error: 'Este plan tiene suscripción activa en Stripe y requiere ajuste desde la pasarela.',
      }, 409);
    }

    const { data: pendingInstallment, error: pendingError } = await supabaseAdmin
      .from('cumbre_installments')
      .select('id')
      .eq('plan_id', plan.id)
      .in('status', ['PENDING', 'FAILED'])
      .order('installment_index', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pendingError) {
      console.error('[portal.iglesia.booking] due date pending lookup error', pendingError);
      return jsonResponse({ ok: false, error: 'No se pudo consultar la próxima cuota' }, 500);
    }
    if (!pendingInstallment?.id) {
      return jsonResponse({ ok: false, error: 'No hay cuotas pendientes para modificar' }, 409);
    }

    await updateInstallment(pendingInstallment.id, { due_date: dueDate });
    await updatePaymentPlan(plan.id, { next_due_date: dueDate });

    void logSecurityEvent({
      type: 'payment_processed',
      identifier: 'portal.iglesia.plan-date',
      detail: 'Fecha de próximo cobro Cumbre actualizada desde portal',
      meta: {
        bookingId,
        planId: plan.id,
        dueDate,
        userId: ctx.userId || null,
      },
    });

    return jsonResponse({
      ok: true,
      due_date: dueDate,
    });
  }

  return jsonResponse({ ok: false, error: 'Acción no soportada' }, 400);
};

export const PUT: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), { status: 400 });
  }

  const bookingId = String(body.booking_id || body.bookingId || '').trim();
  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), { status: 400 });
  }
  const idempotencyKey = buildIdempotencyKey({
    request,
    rawKey: body.idempotencyKey ?? body.idempotency_key,
  });

  const ctx = await getAccessContext(request);
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), { status: denied.status });
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_email, contact_name, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, country_group, currency, total_amount, deposit_threshold, source, payment_method')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), { status: 404 });
  }

  const allowed = await isBookingAllowed(booking, ctx);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 403 });
  }

  const canEditPayment = canEditManualPayment(booking);
  const canRecordPhysicalPayment = true;
  const { data: existingParticipantsForBooking } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, package_type, created_at')
    .eq('booking_id', bookingId);
  const existingLodgingParticipantIds = new Set(
    (existingParticipantsForBooking || [])
      .filter((participant) => participant?.package_type === 'lodging')
      .map((participant) => String(participant.id)),
  );
  const existingParticipantCreatedAtById = new Map(
    (existingParticipantsForBooking || [])
      .map((participant) => [String(participant.id), participant?.created_at || null]),
  );
  const existingParticipantIds = new Set(
    (existingParticipantsForBooking || [])
      .map((participant) => String(participant.id || '').trim())
      .filter(Boolean),
  );
  const existingPackageTypeById = new Map(
    (existingParticipantsForBooking || [])
      .map((participant) => [String(participant.id), String(participant.package_type || '')]),
  );
  const existingReopenedLodgingParticipantIds = new Set(
    (existingParticipantsForBooking || [])
      .filter((participant) => (
        participant?.package_type === 'lodging'
        && isReopenedLodgingCreatedAt(participant?.created_at)
      ))
      .map((participant) => String(participant.id)),
  );
  const existingLegacyLodgingParticipantIds = new Set(
    (existingParticipantsForBooking || [])
      .filter((participant) => (
        participant?.package_type === 'lodging'
        && !isReopenedLodgingCreatedAt(participant?.created_at)
      ))
      .map((participant) => String(participant.id)),
  );

  const participantsRaw = Array.isArray(body.participants) ? body.participants : [];
  if (participantsRaw.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos un participante' }), { status: 400 });
  }

  const submittedParticipantIds = participantsRaw
    .map((participant: any) => String(participant?.id || '').trim())
    .filter(Boolean);
  const duplicateParticipantId = submittedParticipantIds.find((participantId, index) => (
    submittedParticipantIds.indexOf(participantId) !== index
  ));
  if (duplicateParticipantId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se puede reutilizar el mismo participante en la inscripción' }), { status: 400 });
  }

  if (!canEditPayment) {
    const submittedIds = new Set(submittedParticipantIds);
    const preservesParticipantSet = submittedIds.size === existingParticipantIds.size
      && Array.from(existingParticipantIds).every((participantId) => submittedIds.has(participantId));
    if (!preservesParticipantSet) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No se pueden cambiar participantes en una reserva con pagos online',
      }), { status: 403 });
    }
  }

  const invalidEmail = participantsRaw.find((participant: any) => {
    const rawEmail = participant?.email ?? participant?.email_address ?? participant?.emailAddress;
    return rawEmail && !normalizeEmail(rawEmail);
  });
  if (invalidEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'Email de participante inválido' }), { status: 400 });
  }

  const leader = participantsRaw.find((p: any) => p?.isLeader) || participantsRaw[0];
  const contactName = sanitizePlainText(leader?.name ?? '', 120);
  const contactEmail = normalizeEmail(leader?.email ?? '') || '';
  const contactPhone = sanitizePlainText(leader?.phone ?? '', 30);
  const contactDocType = sanitizePlainText(leader?.document_type ?? leader?.documentType ?? '', 10).toUpperCase();
  const contactDocNumber = sanitizePlainText(leader?.document_number ?? leader?.documentNumber ?? '', 40);

  if (!contactName || !contactPhone) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos de contacto incompletos' }), { status: 400 });
  }

  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return new Response(JSON.stringify({ ok: false, error: 'Email inválido' }), { status: 400 });
  }

  if (containsBlockedSequence(contactName) || containsBlockedSequence(contactEmail) || containsBlockedSequence(contactPhone)) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos inválidos' }), { status: 400 });
  }

  let contactCountry = normalizeCountryRegion(body.country ?? '');
  let contactCity = normalizeCityName(body.city ?? '');
  const manualChurchNameRaw = sanitizePlainText(body.manual_church_name ?? body.manualChurchName ?? '', 120);
  const rawChurchId = body.church_id ?? body.churchId ?? '';
  const rawChurchIdLower = String(rawChurchId || '').toLowerCase();
  const isVirtualSelection = rawChurchIdLower === 'virtual' || /virtual/i.test(manualChurchNameRaw);
  const normalizedCountry = contactCountry.trim();

  const currencyOverride = normalizeCurrency(body.currency ?? body.currencyCode);

  let resolvedChurchId: string | null = isUuid(rawChurchId) ? String(rawChurchId) : null;
  let resolvedChurchName: string | null = null;
  let skipChurchCreate = false;

  if (!resolvedChurchId) {
    if (isVirtualSelection) {
      resolvedChurchName = VIRTUAL_CHURCH_NAME;
    } else if (rawChurchIdLower === 'none') {
      resolvedChurchName = 'No asisto a ninguna iglesia';
      skipChurchCreate = true;
    }
  }

  if (isVirtualSelection && !normalizedCountry) {
    return new Response(JSON.stringify({ ok: false, error: 'Escribe el país o región para Maná Virtual' }), { status: 400 });
  }

  if (!resolvedChurchName && manualChurchNameRaw) {
    resolvedChurchName = normalizeChurchName(manualChurchNameRaw);
  }

  if (resolvedChurchId) {
    const { data: church, error: churchError } = await supabaseAdmin
      .from('churches')
      .select('id, name, city, country')
      .eq('id', resolvedChurchId)
      .maybeSingle();

    if (churchError || !church) {
      return new Response(JSON.stringify({ ok: false, error: 'Iglesia no encontrada' }), { status: 404 });
    }

    resolvedChurchName = church.name || resolvedChurchName;
    if (!contactCity && church.city) {
      contactCity = church.city;
    }
    if (!contactCountry && church.country) {
      contactCountry = church.country;
    }
  }

  if (!resolvedChurchId && resolvedChurchName && contactCountry) {
    let existing: { id?: string; name?: string; city?: string } | null = null;
    if (isVirtualSelection) {
      for (const alias of VIRTUAL_CHURCH_ALIASES) {
        const { data } = await supabaseAdmin
          .from('churches')
          .select('id, name, city')
          .ilike('name', alias)
          .eq('country', contactCountry)
          .maybeSingle();
        if (data?.id) {
          existing = data;
          break;
        }
      }
    } else {
      const { data } = await supabaseAdmin
        .from('churches')
        .select('id, name, city')
        .ilike('name', resolvedChurchName)
        .eq('country', contactCountry)
        .maybeSingle();
      if (data?.id) existing = data;
    }
    if (existing?.id) {
      resolvedChurchId = existing.id;
      resolvedChurchName = existing.name || resolvedChurchName;
      if (!contactCity && existing.city) {
        contactCity = existing.city;
      }
    }
  }

  if (!resolvedChurchId && resolvedChurchName && ctx.isAdmin && !skipChurchCreate) {
    let existing: { id?: string; name?: string } | null = null;
    if (isVirtualSelection) {
      for (const alias of VIRTUAL_CHURCH_ALIASES) {
        let query = supabaseAdmin
          .from('churches')
          .select('id, name')
          .ilike('name', alias);
        if (contactCountry) {
          query = query.eq('country', contactCountry);
        }
        const { data } = await query.maybeSingle();
        if (data?.id) {
          existing = data;
          break;
        }
      }
    } else {
      let query = supabaseAdmin
        .from('churches')
        .select('id, name')
        .ilike('name', resolvedChurchName);
      if (contactCountry) {
        query = query.eq('country', contactCountry);
      }
      const { data } = await query.maybeSingle();
      if (data?.id) existing = data;
    }
    if (existing?.id) {
      resolvedChurchId = existing.id;
      resolvedChurchName = existing.name || resolvedChurchName;
    } else {
      const { data: created } = await supabaseAdmin
        .from('churches')
        .insert({
          name: resolvedChurchName,
          city: contactCity || null,
          country: contactCountry || null,
          created_by: ctx.userId || null,
        })
        .select('id, name')
        .single();
      if (created?.id) {
        resolvedChurchId = created.id;
        resolvedChurchName = created.name || resolvedChurchName;
      }
    }
  }

  if (!ctx.isAdmin) {
    if (ctx.allowedChurchId) {
      if (!resolvedChurchId || resolvedChurchId !== ctx.allowedChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'Solo puedes editar registros de tu iglesia asignada' }), { status: 403 });
      }
    } else {
      const isAllowedChurch = await isChurchAllowedForAccess(resolvedChurchId, ctx as any);
      if (!isAllowedChurch) {
        return new Response(JSON.stringify({ ok: false, error: 'Solo puedes editar registros de iglesias de tu alcance' }), { status: 403 });
      }
    }
  }

  if (!resolvedChurchId && !resolvedChurchName) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para continuar' }), { status: 400 });
  }

  const participants = participantsRaw
    .map((participant: any) => {
      const age = resolveParticipantAge(participant);
      const participantId = String(participant?.id || '').trim();
      const existingPackageType = existingPackageTypeById.get(participantId) || null;
      const requestedPackageChoice = participant?.packageType
        ?? participant?.package_type
        ?? participant?.lodging
        ?? (existingLodgingParticipantIds.has(participantId) ? 'lodging' : 'no_lodging');
      const packageType = !canEditPayment && isValidPackageType(existingPackageType)
        ? existingPackageType
        : packageTypeFromAge(age, requestedPackageChoice);
      const relationship = participant?.isLeader ? 'responsable' : 'acompanante';
      const documentType = sanitizePlainText(participant?.document_type ?? participant?.documentType ?? '', 40);
      const documentNumber = sanitizePlainText(participant?.document_number ?? participant?.documentNumber ?? '', 50);
      const safe = sanitizeParticipant({
        fullName: participant?.name ?? participant?.full_name ?? participant?.fullName ?? '',
        packageType,
        relationship,
        documentType,
        documentNumber,
      });
      if (!safe) return null;
      return {
        safe,
        extra: participant ?? {},
        participantId,
        preservesExistingLodging: packageType === 'lodging' && existingLodgingParticipantIds.has(participantId),
        isLegacyLodging: packageType === 'lodging' && existingLegacyLodgingParticipantIds.has(participantId),
        originalCreatedAt: existingParticipantCreatedAtById.get(participantId) || null,
      };
    })
    .filter(Boolean) as {
      safe: NonNullable<ReturnType<typeof sanitizeParticipant>>;
      extra: any;
      participantId: string;
      preservesExistingLodging: boolean;
      isLegacyLodging: boolean;
      originalCreatedAt: string | null;
    }[];

  if (!participants.length) {
    return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), { status: 400 });
  }

  const preservedLegacyLodgingIds = new Set(
    participants
      .filter((participant) => participant.isLegacyLodging)
      .map((participant) => participant.participantId),
  );
  const lodgingCapacity = await checkLodgingCapacity({
    participants: participants.map((participant) => participant.safe),
    currentBookingLodgingCount: existingReopenedLodgingParticipantIds.size,
    legacyLodgingCount: preservedLegacyLodgingIds.size,
  });
  if (!lodgingCapacity.ok) {
    return new Response(JSON.stringify({ ok: false, error: lodgingCapacity.message }), { status: 409 });
  }

  let countryGroup = resolveCountryGroup(body.country_group ?? body.countryGroup, contactCountry);
  if (currencyOverride) {
    countryGroup = currencyOverride === 'USD' ? 'INT' : 'CO';
  }
  const currency = currencyOverride ?? currencyForGroup(countryGroup);
  const financialFieldsLocked = !canEditPayment;
  const effectiveCountryGroup = financialFieldsLocked
    ? (booking.country_group || countryGroup)
    : countryGroup;
  const effectiveCurrency = financialFieldsLocked
    ? (normalizeCurrency(booking.currency) || currency)
    : currency;

  let paymentAmountInput = parseAmountForCurrency(body.payment_amount ?? body.paymentAmount, effectiveCurrency);
  if (!canEditPayment && !canRecordPhysicalPayment) {
    paymentAmountInput = null;
  }

  const totalAmount = financialFieldsLocked
    ? Number(booking.total_amount || 0)
    : calculateTotals(effectiveCurrency, participants.map((p) => p.safe));
  const threshold = financialFieldsLocked
    ? Number(booking.deposit_threshold ?? depositThreshold(totalAmount))
    : depositThreshold(totalAmount);
  const { data: approvedPaymentsBefore } = await supabaseAdmin
    .from('cumbre_payments')
    .select('amount')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');
  const alreadyPaidAmount = (approvedPaymentsBefore || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remainingBeforePayment = Math.max(totalAmount - alreadyPaidAmount, 0);

  if (paymentAmountInput != null) {
    if (paymentAmountInput < 0) {
      return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede ser negativo' }), { status: 400 });
    }
    if (paymentAmountInput > remainingBeforePayment) {
      return new Response(JSON.stringify({ ok: false, error: 'El abono supera el saldo pendiente actual' }), { status: 400 });
    }
  }

  const { error: bookingUpdateError } = await supabaseAdmin
    .from('cumbre_bookings')
    .update({
      contact_name: contactName,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      contact_document_type: contactDocType || null,
      contact_document_number: contactDocNumber || null,
      contact_country: contactCountry || null,
      contact_city: contactCity || null,
      contact_church: resolvedChurchName || null,
      church_id: resolvedChurchId || null,
      country_group: effectiveCountryGroup,
      currency: effectiveCurrency,
      total_amount: totalAmount,
      deposit_threshold: threshold,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId);

  if (bookingUpdateError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar la reserva' }), { status: 500 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('cumbre_participants')
    .delete()
    .eq('booking_id', bookingId);

  if (deleteError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo limpiar participantes' }), { status: 500 });
  }

  const participantRows = participants.map((participant) => ({
    booking_id: bookingId,
    full_name: participant.safe.fullName,
    package_type: participant.safe.packageType,
    relationship: participant.safe.relationship,
    document_type: participant.safe.documentType,
    document_number: participant.safe.documentNumber,
    birthdate: participant.extra?.birthdate || null,
    gender: sanitizePlainText(participant.extra?.gender ?? '', 20) || null,
    diet_type: sanitizePlainText(participant.extra?.menu ?? participant.extra?.menuType ?? participant.extra?.diet_type ?? '', 40) || null,
    email: normalizeEmail(participant.extra?.email) || null,
    created_at: participant.isLegacyLodging ? participant.originalCreatedAt : undefined,
  }));

  const { error: participantError } = await supabaseAdmin
    .from('cumbre_participants')
    .insert(participantRows);

  if (participantError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), { status: 500 });
  }

  let paymentUpdated = false;

  if (paymentAmountInput != null && (canEditPayment || canRecordPhysicalPayment)) {
    if (paymentAmountInput > 0) {
      const paymentIndex = (await countPayments(bookingId)) + 1;
      let reference = buildPaymentReference(bookingId, paymentIndex);
      const paymentSource = canEditPayment ? 'portal-iglesia-edit' : 'portal-iglesia-physical-topup';
      const providerTxId = idempotencyKey
        ? (canEditPayment
          ? buildManualEditProviderTxId(bookingId, idempotencyKey)
          : buildPhysicalTopupProviderTxId(bookingId, idempotencyKey))
        : null;
      let paymentInserted = true;
      const { error: paymentInsertError } = await supabaseAdmin
        .from('cumbre_payments')
        .insert({
          booking_id: bookingId,
          provider: 'manual',
          provider_tx_id: providerTxId,
          reference,
          amount: paymentAmountInput,
          currency: effectiveCurrency,
          status: 'APPROVED',
          raw_event: {
            source: paymentSource,
            method: 'manual',
            idempotency_key: idempotencyKey || null,
          },
        });
      if (paymentInsertError) {
        const isDuplicateRequest = paymentInsertError.code === '23505' && Boolean(providerTxId);
        if (!isDuplicateRequest) {
          console.error('[portal.iglesia.booking] payment insert error', paymentInsertError);
          return new Response(JSON.stringify({ ok: false, error: 'No se pudo registrar el abono manual' }), { status: 500 });
        }

        const { data: existingPayment, error: existingPaymentError } = await supabaseAdmin
          .from('cumbre_payments')
          .select('id, reference')
          .eq('booking_id', bookingId)
          .eq('provider', 'manual')
          .eq('provider_tx_id', providerTxId!)
          .maybeSingle();

        if (existingPaymentError || !existingPayment?.id) {
          console.error('[portal.iglesia.booking] idempotent replay lookup error', existingPaymentError);
          return new Response(JSON.stringify({ ok: false, error: 'No se pudo confirmar el abono manual' }), { status: 500 });
        }

        reference = existingPayment.reference || reference;
        paymentInserted = false;
      }

      let donationExists = false;
      if (reference) {
        const { data: existingDonation, error: existingDonationError } = await supabaseAdmin
          .from('donations')
          .select('id')
          .eq('cumbre_booking_id', bookingId)
          .eq('reference', reference)
          .eq('status', 'APPROVED')
          .limit(1)
          .maybeSingle();
        if (existingDonationError) {
          console.error('[portal.iglesia.booking] donation lookup error', existingDonationError);
        } else {
          donationExists = Boolean(existingDonation?.id);
        }
      }

      if (!donationExists) {
        await createDonation({
          provider: 'physical',
          status: 'APPROVED',
          amount: paymentAmountInput,
          currency: effectiveCurrency,
          reference,
          provider_tx_id: null,
          payment_method: 'manual',
          donation_type: 'evento',
          project_name: 'Cumbre Mundial 2026',
          event_name: 'Cumbre Mundial 2026',
          campus: resolvedChurchName || null,
          church: resolvedChurchName || null,
          church_id: resolvedChurchId || null,
          church_city: contactCity || null,
          donor_name: contactName,
          donor_email: contactEmail || null,
          donor_phone: contactPhone || null,
          donor_document_type: contactDocType || null,
          donor_document_number: contactDocNumber || null,
          is_recurring: false,
          donor_country: contactCountry || null,
          donor_city: contactCity || null,
          donation_description: null,
          need_certificate: false,
          source: paymentSource,
          cumbre_booking_id: bookingId,
          raw_event: idempotencyKey ? { idempotency_key: idempotencyKey } : null,
        });
      }
      if (paymentInserted) {
        const plan = await getPlanByBookingId(bookingId);
        if (plan && !['COMPLETED', 'CANCELLED'].includes(String(plan.status || '').toUpperCase())) {
          await applyManualPaymentToPlan({
            planId: plan.id,
            amount: paymentAmountInput,
            reference,
          });
        }
      }
      paymentUpdated = true;
    }
  }

  const { data: payments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('amount,status')
    .eq('booking_id', bookingId)
    .eq('status', 'APPROVED');

  const totalPaid = (payments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  await updatePlanForBooking({
    bookingId,
    totalAmount,
    currency: effectiveCurrency,
    totalPaid,
    depositDueDate: body.deposit_due_date ?? body.depositDueDate ?? null,
  });

  await recomputeBookingTotals(bookingId);

  return new Response(JSON.stringify({ ok: true, payment_updated: paymentUpdated }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => null);
  const bookingId = String(body?.booking_id || body?.bookingId || url.searchParams.get('bookingId') || '').trim();
  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAccessContext(request);
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, church_id, contact_country, source, payment_method')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = await isBookingAllowed(booking, ctx);
  if (!allowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!canEditManualPayment(booking)) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Solo se pueden eliminar registros manuales. Los pagos online requieren revisión y devolución.',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  const hasOnlineSignals = await hasOnlinePaymentSignals(bookingId);
  if (hasOnlineSignals) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Este registro tiene trazas de pago online. Gestiona revisión/reembolso antes de eliminar.',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error: donationsDeleteError } = await supabaseAdmin
    .from('donations')
    .delete()
    .eq('cumbre_booking_id', bookingId);
  if (donationsDeleteError) {
    console.error('[portal.iglesia.booking] delete donations error', donationsDeleteError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo limpiar donaciones de la reserva' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error: bookingDeleteError } = await supabaseAdmin
    .from('cumbre_bookings')
    .delete()
    .eq('id', bookingId);
  if (bookingDeleteError) {
    console.error('[portal.iglesia.booking] delete booking error', bookingDeleteError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo eliminar la reserva manual' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, deleted: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
