import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import {
  normalizeCountryGroup,
  currencyForGroup,
  sanitizeParticipant,
  calculateTotals,
  depositThreshold,
  buildPaymentReference,
  generateAccessToken,
  type PackageType,
} from '@lib/cumbre2026';
import { checkLodgingCapacity, checkWrittenLodgingCapacity } from '@lib/cumbreLodgingCapacity';
import { buildDepositSchedule, buildInstallmentSchedule, getInstallmentDeadline, isValidDateOnly, type InstallmentFrequency } from '@lib/cumbreInstallments';
import { countPayments, createPaymentPlan, recordPayment, recomputeBookingTotals, applyManualPaymentToPlan } from '@lib/cumbreStore';
import { normalizeCityName, normalizeChurchName } from '@lib/normalization';
import { createDonation } from '@lib/donationsStore';
import { cleanupCumbreBooking } from '@lib/cumbreCleanup';
import { buildIdempotencyKey } from '@lib/cumbreIdempotency';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function validateAdmin(request: Request, token?: string | null): boolean {
  const secret = env('CUMBRE_MANUAL_SECRET');
  if (!secret) return false;
  const header = request.headers.get('x-admin-secret');
  if (header && header === secret) return true;
  if (token && token === secret) return true;
  if (isProduction()) return false;
  const url = new URL(request.url);
  const urlToken = url.searchParams.get('token');
  return Boolean(urlToken && urlToken === secret);
}

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

function parseAmountForCurrency(raw: unknown, currency: 'COP' | 'USD'): number {
  const value = String(raw || '').trim();
  if (!value) return 0;
  if (currency === 'COP') {
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) return 0;
    const amount = Number(digits);
    return Number.isFinite(amount) ? amount : 0;
  }
  const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!normalized) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function packageTypeFromInput(ageRaw: unknown, lodgingRaw: unknown): PackageType {
  const ageValue = String(ageRaw ?? '').trim();
  const age = ageValue ? Number(ageValue) : null;
  const lodgingValue = String(lodgingRaw ?? '').trim().toLowerCase();
  const lodging = lodgingRaw === true || ['yes', 'si', 'sí', 'lodging', 'con alojamiento', 'con_alojamiento', 'with_lodging'].includes(lodgingValue);
  if (Number.isFinite(age)) {
    if ((age as number) <= 4) return 'child_0_7';
    if ((age as number) <= 10) return 'child_7_13';
  }
  return lodging ? 'lodging' : 'no_lodging';
}

async function findIdempotentBooking(idempotencyKey: string | null, expectedParticipants: number) {
  if (!supabaseAdmin || !idempotencyKey) return null;
  const { data: booking, error } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error || !booking?.id) return null;
  const { count, error: countError } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', booking.id);
  if (countError) return null;
  if ((count ?? 0) >= expectedParticipants) {
    return booking;
  }
  await cleanupCumbreBooking(booking.id);
  return null;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'cumbre.manual.submit',
    allowlistKeys: ['CUMBRE_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const form = await request.formData();
  const token = form.get('token')?.toString();

  if (!validateAdmin(request, token)) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let createdBookingId: string | null = null;
  try {
    const contactName = sanitizePlainText(form.get('contactName')?.toString() ?? '', 120);
    const email = (form.get('email')?.toString() ?? '').trim().toLowerCase();
    const phone = sanitizePlainText(form.get('phone')?.toString() ?? '', 30);
    const documentType = sanitizePlainText(form.get('documentType')?.toString() ?? '', 10).toUpperCase();
    const documentNumber = sanitizePlainText(form.get('documentNumber')?.toString() ?? '', 40);
    const countryRaw = form.get('countryGroup')?.toString() ?? 'CO';
    let countryGroup = normalizeCountryGroup(countryRaw);
    const contactCountry = sanitizePlainText(form.get('country')?.toString() ?? '', 40);
    const contactCity = normalizeCityName(form.get('city')?.toString() ?? '');
    const contactChurch = normalizeChurchName(form.get('church')?.toString() ?? '');
    const paymentOption = form.get('paymentOption')?.toString() ?? 'FULL';
    const depositDueDateRaw = form.get('deposit_due_date')?.toString().trim() ?? '';
    const paymentMethod = sanitizePlainText(form.get('paymentMethod')?.toString() ?? '', 40);
    const paymentAmountRaw = form.get('paymentAmount')?.toString() ?? '';
    const frequency = normalizeFrequency(form.get('frequency'));
    const currencyOverride = normalizeCurrency(form.get('currency'));

    if (!contactName || !email || !phone) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos de contacto incompletos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Email invalido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (containsBlockedSequence(contactName) || containsBlockedSequence(email) || containsBlockedSequence(phone)) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos invalidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const participantsRaw = form.get('participants')?.toString() ?? '[]';
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(participantsRaw);
    } catch {
      parsed = [];
    }

    const participants = parsed
      .map((entry: any) => {
        const packageType = packageTypeFromInput(entry?.age, entry?.lodging);
        return sanitizeParticipant({
          fullName: entry?.fullName ?? '',
          packageType,
          relationship: entry?.relationship ?? '',
        });
      })
      .filter(Boolean) as ReturnType<typeof sanitizeParticipant>[];

    if (!participants.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (currencyOverride) {
      countryGroup = currencyOverride === 'USD' ? 'INT' : 'CO';
    }

    const currency = currencyOverride ?? currencyForGroup(countryGroup);
    const paymentAmountInput = parseAmountForCurrency(paymentAmountRaw, currency);
    const totalAmount = calculateTotals(currency, participants);
    const threshold = depositThreshold(totalAmount);

    let installmentSchedule: ReturnType<typeof buildInstallmentSchedule> | null = null;
    let paymentAmount = 0;
    if (paymentOption === 'FULL') {
      paymentAmount = totalAmount;
    } else if (paymentOption === 'DEPOSIT') {
      paymentAmount = threshold;
    } else if (paymentOption === 'INSTALLMENTS') {
      installmentSchedule = buildInstallmentSchedule({
        totalAmount,
        currency,
        frequency,
      });
      paymentAmount = installmentSchedule.installmentAmount;
    }

    if (Number.isFinite(paymentAmountInput) && paymentAmountInput < 0) {
      return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede ser negativo' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (paymentAmountInput != null) {
      paymentAmount = paymentAmountInput;
    }

    if (paymentAmount > totalAmount) {
      return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede superar el total' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const remainingAmount = Math.max(totalAmount - paymentAmount, 0);
    const autoPlan = paymentOption === 'FULL' && paymentAmount > 0 && paymentAmount < totalAmount;
    const planOption = autoPlan ? 'INSTALLMENTS' : paymentOption;

    if (planOption === 'DEPOSIT') {
      if (!isValidDateOnly(depositDueDateRaw)) {
        return new Response(JSON.stringify({ ok: false, error: 'Fecha de segundo pago inválida' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const deadline = getInstallmentDeadline();
      const today = new Date();
      const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (depositDueDateRaw < todayValue) {
        return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago debe ser futura' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (depositDueDateRaw > deadline) {
        return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago supera la fecha límite' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const idempotencySeed = JSON.stringify({
      source: 'cumbre-manual',
      contactName,
      email,
      phone,
      totalAmount,
      currency,
      paymentAmount,
      planOption,
      frequency,
      depositDueDateRaw: depositDueDateRaw || null,
      contactChurch,
      participants: participants.map((entry: any) => ({
        fullName: entry.fullName,
        packageType: entry.packageType,
        relationship: entry.relationship,
      })),
    });
    const idempotencyKey = buildIdempotencyKey({
      request,
      rawKey: form.get('idempotencyKey') ?? form.get('idempotency_key'),
      fallbackSeed: idempotencySeed,
    });

    const existingBooking = await findIdempotentBooking(idempotencyKey, participants.length);
    if (existingBooking) {
      return new Response(JSON.stringify({
        ok: true,
        bookingId: existingBooking.id,
        token: null,
        planId: null,
        idempotent: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const lodgingCapacity = await checkLodgingCapacity({ participants });
    if (!lodgingCapacity.ok) {
      return new Response(JSON.stringify({ ok: false, error: lodgingCapacity.message }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    const tokenPair = generateAccessToken();

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('cumbre_bookings')
      .insert({
        contact_name: contactName,
        contact_email: email,
        contact_phone: phone,
        contact_document_type: documentType || null,
        contact_document_number: documentNumber || null,
        contact_country: contactCountry || null,
        contact_city: contactCity || null,
        contact_church: contactChurch || null,
        country_group: countryGroup,
        currency,
        total_amount: totalAmount,
        total_paid: 0,
        status: 'PENDING',
        deposit_threshold: threshold,
        payment_method: paymentMethod || 'manual',
        payment_status: paymentAmount > 0 ? 'APPROVED' : 'PENDING',
        token_hash: tokenPair.hash,
        idempotency_key: idempotencyKey,
        source: 'cumbre-manual',
      })
      .select('id')
      .single();

    if (bookingError || !booking) {
      if (idempotencyKey) {
        const existing = await findIdempotentBooking(idempotencyKey, participants.length);
        if (existing) {
          return new Response(JSON.stringify({
            ok: true,
            bookingId: existing.id,
            token: null,
            planId: null,
            idempotent: true,
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la reserva' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    createdBookingId = booking.id;

    const participantRows = participants.map((participant) => ({
      booking_id: booking.id,
      full_name: participant.fullName,
      package_type: participant.packageType,
      relationship: participant.relationship,
    }));

    const { error: participantError } = await supabaseAdmin
      .from('cumbre_participants')
      .insert(participantRows);

    if (participantError) {
      throw new Error('No se pudo guardar participantes');
    }

    const writtenCapacity = await checkWrittenLodgingCapacity(booking.id);
    if (!writtenCapacity.ok) {
      await cleanupCumbreBooking(booking.id);
      return new Response(JSON.stringify({ ok: false, error: writtenCapacity.message }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    let planId: string | null = null;
    if (planOption === 'INSTALLMENTS') {
      const schedule = installmentSchedule ?? buildInstallmentSchedule({
        totalAmount,
        currency,
        frequency,
      });

      const plan = await createPaymentPlan({
        bookingId: booking.id,
        frequency,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        totalAmount,
        currency,
        installmentCount: schedule.installmentCount,
        installmentAmount: schedule.installmentAmount,
        provider: 'manual',
        autoDebit: false,
        installments: schedule.installments,
      });
      planId = plan.id;
    } else if (planOption === 'DEPOSIT') {
      if (remainingAmount > 0) {
        const schedule = buildDepositSchedule({
          totalAmount: remainingAmount,
          currency,
          dueDate: depositDueDateRaw,
        });
        const plan = await createPaymentPlan({
          bookingId: booking.id,
          frequency: 'DEPOSIT',
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          totalAmount: remainingAmount,
          currency,
          installmentCount: schedule.installmentCount,
          installmentAmount: schedule.installmentAmount,
          provider: 'manual',
          autoDebit: false,
          installments: schedule.installments,
        });
        planId = plan.id;
      }
    }

    if (paymentAmount > 0) {
      const paymentIndex = (await countPayments(booking.id)) + 1;
      const reference = buildPaymentReference(booking.id, paymentIndex);
      await recordPayment({
        bookingId: booking.id,
        provider: 'manual',
        providerTxId: null,
        reference,
        amount: paymentAmount,
        currency,
        status: 'APPROVED',
        rawEvent: {
          source: 'cumbre-manual',
          method: paymentMethod || null,
        },
      });

      if (planId && planOption === 'INSTALLMENTS') {
        await applyManualPaymentToPlan({
          planId,
          amount: paymentAmount,
          reference,
        });
      }

      await createDonation({
        provider: 'physical',
        status: 'APPROVED',
        amount: paymentAmount,
        currency,
        reference,
        provider_tx_id: null,
        payment_method: paymentMethod || null,
        donation_type: 'evento',
        project_name: 'Cumbre Mundial 2026',
        event_name: 'Cumbre Mundial 2026',
        campus: contactChurch,
        church: contactChurch,
        church_city: contactCity,
        donor_name: contactName,
        donor_email: email,
        donor_phone: phone,
        donor_document_type: documentType || null,
        donor_document_number: documentNumber || null,
        is_recurring: false,
        donor_country: contactCountry || null,
        donor_city: contactCity || null,
        donation_description: null,
        need_certificate: false,
        source: 'cumbre-manual',
        cumbre_booking_id: booking.id,
        raw_event: null,
      });
    }

    try {
      await recomputeBookingTotals(booking.id);
    } catch (error) {
      console.error('[cumbre.manual] recompute error', error);
    }

    return new Response(JSON.stringify({
      ok: true,
      bookingId: booking.id,
      token: tokenPair.token,
      planId,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    if (createdBookingId) {
      await cleanupCumbreBooking(createdBookingId);
    }
    console.error('[cumbre.manual] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error creando reserva manual' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
