import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
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
import { buildDonationReference, createDonation } from '@lib/donationsStore';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateAdmin(request: Request, token?: string | null): boolean {
  const secret = env('CUMBRE_MANUAL_SECRET');
  if (!secret) return false;
  const header = request.headers.get('x-admin-secret');
  if (header && header === secret) return true;
  if (token && token === secret) return true;
  const url = new URL(request.url);
  const urlToken = url.searchParams.get('token');
  return Boolean(urlToken && urlToken === secret);
}

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

export const POST: APIRoute = async ({ request }) => {
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

  try {
    const contactName = sanitizePlainText(form.get('contactName')?.toString() ?? '', 120);
    const email = (form.get('email')?.toString() ?? '').trim().toLowerCase();
    const phone = sanitizePlainText(form.get('phone')?.toString() ?? '', 30);
    const documentType = sanitizePlainText(form.get('documentType')?.toString() ?? '', 10).toUpperCase();
    const documentNumber = sanitizePlainText(form.get('documentNumber')?.toString() ?? '', 40);
    const countryRaw = form.get('countryGroup')?.toString() ?? 'CO';
    const countryGroup = normalizeCountryGroup(countryRaw);
    const contactCountry = sanitizePlainText(form.get('country')?.toString() ?? '', 40);
    const contactCity = normalizeCityName(form.get('city')?.toString() ?? '');
    const contactChurch = normalizeChurchName(form.get('church')?.toString() ?? '');
    const paymentOption = form.get('paymentOption')?.toString() ?? 'FULL';
    const paymentMethod = sanitizePlainText(form.get('paymentMethod')?.toString() ?? '', 40);
    const paymentAmount = Number(form.get('paymentAmount')?.toString() ?? 0);
    const frequency = normalizeFrequency(form.get('frequency'));

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

    const currency = currencyForGroup(countryGroup);
    const totalAmount = calculateTotals(currency, participants);
    const threshold = depositThreshold(totalAmount);
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
        token_hash: tokenPair.hash,
      })
      .select('id')
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear la reserva' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

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
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
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
          source: 'cumbre-manual',
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
        campus: contactChurch,
        church: contactChurch,
        church_city: contactCity,
        donor_name: contactName,
        donor_email: email,
        donor_phone: phone,
        donor_document_type: documentType || null,
        donor_document_number: documentNumber || null,
        donor_country: contactCountry || null,
        donor_city: contactCity || null,
        source: 'cumbre-manual',
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
    console.error('[cumbre.manual] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Error creando reserva manual' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
