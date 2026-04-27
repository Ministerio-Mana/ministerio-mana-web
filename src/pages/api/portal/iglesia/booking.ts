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
  type PackageType,
} from '@lib/cumbre2026';
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
} from '@lib/cumbreStore';
import { buildIdempotencyKey } from '@lib/cumbreIdempotency';
import { normalizeCityName, normalizeChurchName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { createDonation } from '@lib/donationsStore';

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

function packageTypeFromAge(ageRaw: unknown, lodgingRaw: unknown): PackageType {
  const age = Number(ageRaw);
  const lodgingValue = String(lodgingRaw || '').trim().toLowerCase();
  const lodging = !['no_lodging', 'no', 'sin alojamiento', 'sin_alojamiento', 'without_lodging'].includes(lodgingValue);
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

function buildManualEditProviderTxId(bookingId: string, idempotencyKey: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`portal-iglesia-edit:${bookingId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `portal-iglesia-edit-${digest}`;
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
    userId: access.userId,
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
  const schedule = buildInstallmentSchedule({
    totalAmount: params.totalAmount,
    currency: planCurrency,
    frequency,
    startDate,
    deadline,
  });

  await updatePaymentPlan(plan.id, {
    total_amount: params.totalAmount,
    installment_amount: schedule.installmentAmount,
    installment_count: schedule.installmentCount,
    currency: planCurrency,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
  });

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, status, installment_index')
    .eq('plan_id', plan.id);

  const scheduleByIndex = new Map(schedule.installments.map((item) => [item.installmentIndex, item]));

  const pending = (installments || []).filter((item) => ['PENDING', 'FAILED'].includes(item.status));
  if (pending.length) {
    await Promise.all(pending.map((installment) => {
      const scheduleItem = scheduleByIndex.get(installment.installment_index);
      if (!scheduleItem) return Promise.resolve();
      return updateInstallment(installment.id, {
        amount: scheduleItem.amount,
        due_date: scheduleItem.dueDate,
        currency: planCurrency,
      });
    }));

    const next = pending
      .map((item) => scheduleByIndex.get(item.installment_index)?.dueDate)
      .filter(Boolean)
      .sort()[0];
    if (next) {
      await updatePaymentPlan(plan.id, { next_due_date: next });
    }
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
    .select('id, status, provider, currency, installment_count, installment_amount, frequency, next_due_date, provider_payment_method_id, provider_subscription_id, amount_paid')
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
      can_delete_booking: canEditManualPayment(booking) && !hasOnlineSignals,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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
    .select('id, contact_email, contact_name, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, currency, source, payment_method')
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

  const participantsRaw = Array.isArray(body.participants) ? body.participants : [];
  if (participantsRaw.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos un participante' }), { status: 400 });
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
      const packageChoice = participant?.packageType
        ?? participant?.package_type
        ?? participant?.lodging
        ?? 'lodging';
      const packageType = packageTypeFromAge(age, packageChoice);
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
      };
    })
    .filter(Boolean) as { safe: NonNullable<ReturnType<typeof sanitizeParticipant>>; extra: any }[];

  if (!participants.length) {
    return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), { status: 400 });
  }

  let countryGroup = resolveCountryGroup(body.country_group ?? body.countryGroup, contactCountry);
  if (currencyOverride) {
    countryGroup = currencyOverride === 'USD' ? 'INT' : 'CO';
  }
  const currency = currencyOverride ?? currencyForGroup(countryGroup);

  let paymentAmountInput = parseAmountForCurrency(body.payment_amount ?? body.paymentAmount, currency);
  if (!canEditPayment) {
    paymentAmountInput = null;
  }

  const totalAmount = calculateTotals(currency, participants.map((p) => p.safe));
  const threshold = depositThreshold(totalAmount);
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
      country_group: countryGroup,
      currency,
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
  }));

  const { error: participantError } = await supabaseAdmin
    .from('cumbre_participants')
    .insert(participantRows);

  if (participantError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), { status: 500 });
  }

  let paymentUpdated = false;

  if (paymentAmountInput != null && canEditPayment) {
    if (paymentAmountInput > 0) {
      const paymentIndex = (await countPayments(bookingId)) + 1;
      let reference = buildPaymentReference(bookingId, paymentIndex);
      const providerTxId = idempotencyKey ? buildManualEditProviderTxId(bookingId, idempotencyKey) : null;
      const { error: paymentInsertError } = await supabaseAdmin
        .from('cumbre_payments')
        .insert({
          booking_id: bookingId,
          provider: 'manual',
          provider_tx_id: providerTxId,
          reference,
          amount: paymentAmountInput,
          currency,
          status: 'APPROVED',
          raw_event: {
            source: 'portal-iglesia-edit',
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
          currency,
          reference,
          provider_tx_id: null,
          payment_method: 'manual',
          donation_type: 'evento',
          project_name: 'Cumbre Mundial 2026',
          event_name: 'Cumbre Mundial 2026',
          campus: resolvedChurchName || null,
          church: resolvedChurchName || null,
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
          source: 'portal-iglesia-edit',
          cumbre_booking_id: bookingId,
          raw_event: idempotencyKey ? { idempotency_key: idempotencyKey } : null,
        });
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
    currency,
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
