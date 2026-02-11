import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
  normalizeCountryGroup,
  currencyForGroup,
  sanitizeParticipant,
  calculateTotals,
  depositThreshold,
  generateAccessToken,
  type PackageType,
} from '@lib/cumbre2026';
import { buildDepositSchedule, buildInstallmentSchedule, getInstallmentDeadline, isValidDateOnly, type InstallmentFrequency } from '@lib/cumbreInstallments';
import { createPaymentPlan, recordPayment, recomputeBookingTotals, applyManualPaymentToPlan } from '@lib/cumbreStore';
import { normalizeCityName, normalizeChurchName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { resolveBaseUrl } from '@lib/url';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';
import { cleanupCumbreBooking } from '@lib/cumbreCleanup';
import { buildIdempotencyKey } from '@lib/cumbreIdempotency';

export const prerender = false;

const VIRTUAL_CHURCH_NAME = 'Ministerio Maná Virtual';
const VIRTUAL_CHURCH_ALIASES = [VIRTUAL_CHURCH_NAME, 'Virtual'];

function normalizeFrequency(raw: string | null | undefined): InstallmentFrequency {
  const value = (raw || '').toString().trim().toUpperCase();
  if (value === 'BIWEEKLY' || value === 'QUINCENAL') return 'BIWEEKLY';
  return 'MONTHLY';
}

function packageTypeFromInput(ageRaw: unknown, lodgingRaw: unknown): PackageType {
  const age = Number(ageRaw || 0);
  const lodging = String(lodgingRaw || '').toLowerCase() === 'yes';
  if (age <= 4) return 'child_0_7';
  if (age <= 10) return 'child_7_13';
  return lodging ? 'lodging' : 'no_lodging';
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let userId: string | null = null;
  let churchId: string | null = null;
  let churchNameFromRole: string | null = null;
  let isAllowed = false;
  let isAdmin = false;
  let isNational = false;
  let allowedCountry: string | null = null;

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    isAllowed = true;
    isAdmin = true;
  } else {
    userId = user.id;
    const profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const activeMembership = memberships.find((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    const hasChurchRole = Boolean(activeMembership);
    const role = profile?.role || 'user';
    const allowedRoles = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator', 'church_admin'];
    if (!allowedRoles.includes(role) && !hasChurchRole) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    isAdmin = Boolean(profile && isAdminRole(role));
    if (role === 'national_pastor') {
      isNational = true;
      allowedCountry = profile?.country || null;
      if (!allowedCountry) {
        return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    isAllowed = Boolean(profile && (isAdmin || isNational || hasChurchRole || role === 'pastor' || role === 'local_collaborator'));
    const membership = memberships.find((m: any) => m?.church?.id);
    churchId = membership?.church?.id || profile?.church_id || null;
    churchNameFromRole = membership?.church?.name || profile?.church_name || null;
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let createdBookingId: string | null = null;
  let selectedChurchFromPayload: any = null;
  try {
    const contactName = sanitizePlainText(payload.contactName ?? '', 120);
    const email = (payload.email ?? '').toString().trim().toLowerCase();
    const phone = sanitizePlainText(payload.phone ?? '', 30);
    const documentType = sanitizePlainText(payload.documentType ?? '', 10).toUpperCase();
    const documentNumber = sanitizePlainText(payload.documentNumber ?? '', 40);
    const countryGroup = normalizeCountryGroup(payload.countryGroup ?? 'CO');
    const contactCountry = normalizeCountryRegion(payload.country ?? '');
    const contactCity = normalizeCityName(payload.city ?? '');
    const contactChurchInput = sanitizePlainText(payload.church ?? '', 120);
    const isVirtualSelection = /virtual/i.test(contactChurchInput);
    const contactChurchRaw = isVirtualSelection ? VIRTUAL_CHURCH_NAME : normalizeChurchName(contactChurchInput);
    const churchIdFromPayload = isUuid(payload.churchId) ? payload.churchId : null;
    const paymentOption = (payload.paymentOption ?? 'FULL').toString().toUpperCase();
    const depositDueDateRaw = (payload.deposit_due_date ?? payload.depositDueDate ?? '').toString().trim();
    const paymentMethod = sanitizePlainText(payload.paymentMethod ?? '', 40);
    const rawPaymentAmount = Number(payload.paymentAmount ?? 0);
    const paymentAmount = Number.isFinite(rawPaymentAmount) ? rawPaymentAmount : 0;
    const frequency = normalizeFrequency(payload.frequency);

    if (isNational) {
      if (!churchIdFromPayload) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const { data: church } = await supabaseAdmin
        .from('churches')
        .select('id, name, city, country')
        .eq('id', churchIdFromPayload)
        .maybeSingle();
      if (!church?.id || (allowedCountry && church.country !== allowedCountry)) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      selectedChurchFromPayload = church;
    }

    if (isVirtualSelection && !contactCountry.trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'Escribe el país o región para Maná Virtual' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!contactName || !email || !phone) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos de contacto incompletos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Email inválido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (containsBlockedSequence(contactName) || containsBlockedSequence(email) || containsBlockedSequence(phone)) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos inválidos' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const parsed = Array.isArray(payload.participants) ? payload.participants : [];
    const participants = parsed
      .map((entry: any) => {
        const packageType = packageTypeFromInput(entry?.age, entry?.lodging);
        return {
          safe: sanitizeParticipant({
            fullName: entry?.fullName ?? '',
            packageType,
            relationship: entry?.relationship ?? '',
          }),
          extra: entry ?? {},
        };
      })
      .filter((item: any) => item.safe);

    if (!participants.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const currency = currencyForGroup(countryGroup);
    const totalAmount = calculateTotals(currency, participants.map((p: any) => p.safe));
    const threshold = depositThreshold(totalAmount);

    if (paymentAmount < 0) {
      return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede ser negativo' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
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
      source: 'portal-iglesia',
      contactName,
      email,
      phone,
      totalAmount,
      currency,
      paymentAmount,
      planOption,
      frequency,
      depositDueDateRaw: depositDueDateRaw || null,
      churchId: churchIdFromPayload || churchId,
      participants: participants.map((item: any) => ({
        fullName: item.safe.fullName,
        packageType: item.safe.packageType,
        relationship: item.safe.relationship,
        documentNumber: item.safe.documentNumber,
      })),
    });
    const idempotencyKey = buildIdempotencyKey({
      request,
      rawKey: payload.idempotencyKey ?? payload.idempotency_key,
      fallbackSeed: idempotencySeed,
    });

    const existingBooking = await findIdempotentBooking(idempotencyKey, participants.length);
    if (existingBooking) {
      return new Response(JSON.stringify({
        ok: true,
        bookingId: existingBooking.id,
        idempotent: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const tokenPair = generateAccessToken();

    let resolvedChurchId = churchId;
    let resolvedChurchName = churchNameFromRole || contactChurchRaw;

    if (isNational && selectedChurchFromPayload?.id) {
      resolvedChurchId = selectedChurchFromPayload.id;
      resolvedChurchName = selectedChurchFromPayload.name || resolvedChurchName;
    }

    if (isAdmin && churchIdFromPayload) {
      const { data: selectedChurch } = await supabaseAdmin
        .from('churches')
        .select('id, name')
        .eq('id', churchIdFromPayload)
        .maybeSingle();
      if (selectedChurch?.id) {
        resolvedChurchId = selectedChurch.id;
        resolvedChurchName = selectedChurch.name || resolvedChurchName;
      }
    }

    if (isAdmin && !resolvedChurchId && contactChurchRaw) {
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
          .ilike('name', contactChurchRaw);
        if (contactCountry) {
          query = query.eq('country', contactCountry);
        }
        const { data } = await query.maybeSingle();
        if (data?.id) existing = data;
      }
      if (existing?.id) {
        resolvedChurchId = existing.id;
        resolvedChurchName = existing.name || contactChurchRaw;
      } else {
        const { data: created } = await supabaseAdmin
          .from('churches')
          .insert({
            name: contactChurchRaw,
            city: contactCity || null,
            country: contactCountry || null,
            created_by: isUuid(userId) ? userId : null,
          })
          .select('id, name')
          .single();
        if (created?.id) {
          resolvedChurchId = created.id;
          resolvedChurchName = created.name || contactChurchRaw;
        }
      }
    }

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
        contact_church: resolvedChurchName || null,
        country_group: countryGroup,
        currency,
        total_amount: totalAmount,
        total_paid: 0,
        status: 'PENDING',
        deposit_threshold: threshold,
        payment_method: 'manual',
        token_hash: tokenPair.hash,
        idempotency_key: idempotencyKey,
        source: 'portal-iglesia',
        church_id: resolvedChurchId || null,
        created_by: isUuid(userId) ? userId : null,
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

    const participantRows = participants.map((item: any) => ({
      booking_id: booking.id,
      full_name: item.safe.fullName,
      package_type: item.safe.packageType,
      relationship: item.safe.relationship,
      birthdate: item.extra?.birthdate || null,
      gender: sanitizePlainText(item.extra?.gender ?? '', 20) || null,
      document_type: sanitizePlainText(item.extra?.documentType ?? '', 20) || null,
      document_number: sanitizePlainText(item.extra?.documentNumber ?? '', 40) || null,
      diet_type: sanitizePlainText(item.extra?.menuType ?? '', 40) || null,
    }));

    const { error: participantError } = await supabaseAdmin
      .from('cumbre_participants')
      .insert(participantRows);

    if (participantError) {
      throw new Error('No se pudo guardar participantes');
    }

    try {
      const baseUrl = resolveBaseUrl(request);
      const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;
      const existingUser = await findAuthUserByEmail(email);
      if (!existingUser) {
        const result = await sendAuthLink({ kind: 'invite', email, redirectTo });
        if (!result.ok) {
          console.warn('[portal.iglesia.submit] invite email failed', result.error);
        }
      }
    } catch (inviteError) {
      console.error('[portal.iglesia.submit] invite error', inviteError);
    }

    let planId: string | null = null;
    if (planOption === 'INSTALLMENTS') {
      const schedule = buildInstallmentSchedule({
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
      const reference = buildDonationReference();
      await recordPayment({
        bookingId: booking.id,
        provider: 'manual',
        providerTxId: null,
        reference,
        amount: paymentAmount,
        currency,
        status: 'APPROVED',
        rawEvent: {
          source: 'portal-iglesia',
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
        campus: resolvedChurchName || contactChurchRaw,
        church: resolvedChurchName || contactChurchRaw,
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
        source: 'portal-iglesia',
        cumbre_booking_id: booking.id,
        raw_event: null,
      });
    }

    try {
      await recomputeBookingTotals(booking.id);
    } catch (error) {
      console.error('[portal.iglesia.submit] recompute error', error);
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
    console.error('[portal.iglesia.submit] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error creando reserva' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
