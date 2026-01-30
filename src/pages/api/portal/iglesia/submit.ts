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
import { buildInstallmentSchedule, type InstallmentFrequency } from '@lib/cumbreInstallments';
import { createPaymentPlan, recordPayment, recomputeBookingTotals, applyManualPaymentToPlan } from '@lib/cumbreStore';
import { normalizeCityName, normalizeChurchName } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { resolveBaseUrl } from '@lib/url';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';

export const prerender = false;

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
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    isAdmin = Boolean(profile && isAdminRole(profile.role));
    isAllowed = Boolean(profile && (isAdmin || hasChurchRole));
    const membership = memberships.find((m: any) => m?.church?.id);
    churchId = membership?.church?.id || profile?.church_id || null;
    churchNameFromRole = membership?.church?.name || null;
  }

  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const contactName = sanitizePlainText(payload.contactName ?? '', 120);
    const email = (payload.email ?? '').toString().trim().toLowerCase();
    const phone = sanitizePlainText(payload.phone ?? '', 30);
    const documentType = sanitizePlainText(payload.documentType ?? '', 10).toUpperCase();
    const documentNumber = sanitizePlainText(payload.documentNumber ?? '', 40);
    const countryGroup = normalizeCountryGroup(payload.countryGroup ?? 'CO');
    const contactCountry = sanitizePlainText(payload.country ?? '', 40);
    const contactCity = normalizeCityName(payload.city ?? '');
    const contactChurchRaw = normalizeChurchName(payload.church ?? '');
    const churchIdFromPayload = isUuid(payload.churchId) ? payload.churchId : null;
    const paymentOption = (payload.paymentOption ?? 'FULL').toString().toUpperCase();
    const paymentMethod = sanitizePlainText(payload.paymentMethod ?? '', 40);
    const paymentAmount = Number(payload.paymentAmount ?? 0);
    const frequency = normalizeFrequency(payload.frequency);

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
    const tokenPair = generateAccessToken();

    let resolvedChurchId = churchId;
    let resolvedChurchName = churchNameFromRole || contactChurchRaw;

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
      const { data: existing } = await supabaseAdmin
        .from('churches')
        .select('id, name')
        .ilike('name', contactChurchRaw)
        .maybeSingle();
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
        token_hash: tokenPair.hash,
        source: 'portal-iglesia',
        church_id: resolvedChurchId || null,
        created_by: isUuid(userId) ? userId : null,
      })
      .select('id')
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la reserva' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

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
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
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
    if (paymentOption === 'INSTALLMENTS') {
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

      if (planId) {
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
        donor_country: contactCountry || null,
        donor_city: contactCity || null,
        source: 'portal-iglesia',
        cumbre_booking_id: booking.id,
        raw_event: null,
      });
    }

    await recomputeBookingTotals(booking.id);

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
    console.error('[portal.iglesia.submit] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error creando reserva' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
