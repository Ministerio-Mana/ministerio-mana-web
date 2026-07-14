import type { APIRoute } from 'astro';
import { sanitizePlainText } from '@lib/validation';
import { createDonation } from '@lib/donationsStore';
import { buildPaymentReference } from '@lib/cumbre2026';
import {
  applyManualPaymentToPlan,
  countPayments,
  getApprovedPaymentsTotal,
  getBookingById,
  getPaymentByProviderTxId,
  getPlanByBookingId,
  recordPayment,
  recomputeBookingTotals,
  updatePaymentRawEventByProviderTxId,
} from '@lib/cumbreStore';
import { buildIdempotencyKey, isSafeTokenCandidate } from '@lib/cumbreIdempotency';
import { authorizeCumbreManualAccess } from '@lib/cumbreManualAccess';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function roundCurrency(amount: number, currency: string): number {
  return currency === 'USD'
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : Math.round(amount);
}

function parseCurrencyAmount(raw: string, currency: 'COP' | 'USD'): number {
  const value = raw.trim();
  if (!value || value.includes('-')) return Number.NaN;
  if (currency === 'COP') {
    if (!/^\d+$|^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return Number.NaN;
    return Number(value.replace(/[.,]/g, ''));
  }
  if (!/^\d+(?:\.\d{1,2})?$|^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value)) {
    return Number.NaN;
  }
  return Number(value.replace(/,/g, ''));
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const access = await authorizeCumbreManualAccess({
    request,
    clientAddress,
    identifier: 'cumbre.manual.payment',
  });
  if (!access.ok) return json({ ok: false, error: access.error || 'No autorizado' }, access.status);

  const allowed = await enforceRateLimit(
    `cumbre-manual-payment:${access.userId || access.email || clientAddress || 'service'}`,
    60,
    20,
    { failOpen: false },
  );
  if (!allowed) return json({ ok: false, error: 'Demasiados intentos. Espera un minuto y vuelve a intentar.' }, 429);

  const form = await request.formData();
  const bookingId = String(form.get('bookingId') || '').trim();
  const amountRaw = String(form.get('amount') || '').trim();
  const paymentMethod = sanitizePlainText(String(form.get('paymentMethod') || ''), 40);
  const confirmed = form.get('paymentConfirmed')?.toString() === 'yes';
  const idempotencyKey = buildIdempotencyKey({
    request,
    rawKey: form.get('idempotencyKey') ?? form.get('idempotency_key'),
  });

  if (!confirmed) return json({ ok: false, error: 'Confirma que verificaste la reserva, la moneda y el soporte del pago.' }, 400);
  if (!UUID_PATTERN.test(bookingId)) return json({ ok: false, error: 'El Booking ID no es válido.' }, 400);
  if (!amountRaw) return json({ ok: false, error: 'Escribe un monto mayor que cero.' }, 400);
  if (paymentMethod.length < 3) return json({ ok: false, error: 'Indica el método usado para verificar el pago.' }, 400);
  if (!idempotencyKey || !isSafeTokenCandidate(idempotencyKey)) {
    return json({ ok: false, error: 'No se pudo proteger el envío. Recarga la página e intenta de nuevo.' }, 400);
  }

  const booking = await getBookingById(bookingId);
  if (!booking) return json({ ok: false, error: 'Reserva no encontrada.' }, 404);

  const currency = String(booking.currency || 'COP').toUpperCase() === 'USD' ? 'USD' : 'COP';
  const amount = parseCurrencyAmount(amountRaw, currency);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({
      ok: false,
      error: currency === 'COP'
        ? 'Usa un monto COP entero, por ejemplo 300000 o 300.000.'
        : 'Usa un monto USD con máximo dos decimales, por ejemplo 300 o 300.00.',
    }, 400);
  }
  const normalizedAmount = roundCurrency(amount, currency);
  if (Math.abs(normalizedAmount - amount) > 0.000001) {
    return json({
      ok: false,
      error: currency === 'COP'
        ? 'Los abonos en COP deben registrarse sin centavos.'
        : 'Los abonos en USD admiten máximo dos decimales.',
    }, 400);
  }

  const providerTxId = `manual:${idempotencyKey}`;
  const existing = await getPaymentByProviderTxId({ provider: 'manual', providerTxId });
  if (existing) {
    if (
      existing.booking_id !== bookingId
      || roundCurrency(Number(existing.amount || 0), currency) !== normalizedAmount
      || String(existing.currency || '').toUpperCase() !== currency
    ) {
      return json({ ok: false, error: 'La protección del envío no coincide con este abono. Recarga la página.' }, 409);
    }
    const reconciliationStatus = String(existing.raw_event?.reconciliation_status || 'pending');
    if (reconciliationStatus !== 'complete') {
      return json({
        ok: false,
        recorded: true,
        reference: existing.reference,
        error: 'El abono ya está registrado y su conciliación secundaria requiere revisión. No lo vuelvas a enviar.',
      }, 409);
    }
    return json({ ok: true, reference: existing.reference, idempotent: true });
  }

  const approvedTotal = roundCurrency(await getApprovedPaymentsTotal(bookingId), currency);
  const totalAmount = roundCurrency(Number(booking.total_amount || 0), currency);
  const remaining = roundCurrency(Math.max(totalAmount - approvedTotal, 0), currency);
  if (remaining <= 0) return json({ ok: false, error: 'La reserva ya está pagada completamente.' }, 409);
  if (normalizedAmount > remaining) {
    return json({
      ok: false,
      error: `El abono supera el saldo pendiente de ${new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'USD' ? 2 : 0,
      }).format(remaining)}.`,
    }, 409);
  }

  const paymentIndex = (await countPayments(bookingId)) + 1;
  const reference = buildPaymentReference(bookingId, paymentIndex);

  try {
    await recordPayment({
      bookingId,
      provider: 'manual',
      providerTxId,
      reference,
      amount: normalizedAmount,
      currency,
      status: 'APPROVED',
      rawEvent: {
        source: 'cumbre-manual',
        method: paymentMethod,
        actor_user_id: access.userId,
        access_mode: access.mode,
        idempotency_key: idempotencyKey,
        reconciliation_status: 'pending',
      },
      throwOnError: true,
      insertOnly: true,
    });
  } catch (error) {
    const racedPayment = await getPaymentByProviderTxId({ provider: 'manual', providerTxId });
    if (racedPayment) {
      const reconciliationStatus = String(racedPayment.raw_event?.reconciliation_status || 'pending');
      if (reconciliationStatus === 'complete') {
        return json({ ok: true, reference: racedPayment.reference, idempotent: true });
      }
      return json({
        ok: false,
        recorded: true,
        reference: racedPayment.reference,
        error: 'El abono ya está registrado y su conciliación secundaria requiere revisión. No lo vuelvas a enviar.',
      }, 409);
    }
    console.error('[cumbre.manual.payment] record failed', {
      bookingId,
      actorUserId: access.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: 'No se pudo registrar el abono. No lo vuelvas a enviar hasta revisar el estado de la reserva.' }, 500);
  }

  try {
    const plan = await getPlanByBookingId(bookingId);
    if (plan) {
      await applyManualPaymentToPlan({
        planId: plan.id,
        amount: normalizedAmount,
        reference,
      });
    }

    await recomputeBookingTotals(bookingId);

    await createDonation({
      provider: 'physical',
      status: 'APPROVED',
      amount: normalizedAmount,
      currency,
      reference,
      provider_tx_id: providerTxId,
      payment_method: paymentMethod,
      donation_type: 'evento',
      project_name: 'Cumbre Mundial 2026',
      event_name: 'Cumbre Mundial 2026',
      campus: booking.contact_church ?? null,
      church: booking.contact_church ?? null,
      church_city: booking.contact_city ?? null,
      donor_name: booking.contact_name ?? null,
      donor_email: booking.contact_email ?? null,
      donor_phone: booking.contact_phone ?? null,
      donor_document_type: booking.contact_document_type ?? null,
      donor_document_number: booking.contact_document_number ?? null,
      is_recurring: false,
      donor_country: booking.contact_country ?? null,
      donor_city: booking.contact_city ?? null,
      donation_description: null,
      need_certificate: false,
      source: 'cumbre-manual',
      cumbre_booking_id: bookingId,
      raw_event: {
        actor_user_id: access.userId,
        access_mode: access.mode,
        idempotency_key: idempotencyKey,
      },
    });

    await updatePaymentRawEventByProviderTxId({
      provider: 'manual',
      providerTxId,
      rawEvent: {
        source: 'cumbre-manual',
        method: paymentMethod,
        actor_user_id: access.userId,
        access_mode: access.mode,
        idempotency_key: idempotencyKey,
        reconciliation_status: 'complete',
      },
    });

    await logSecurityEvent({
      type: 'admin_action',
      identifier: 'cumbre.manual.payment',
      ip: clientAddress || null,
      detail: 'Abono manual registrado',
      meta: {
        actor_user_id: access.userId,
        actor_email: access.email,
        access_mode: access.mode,
        booking_id: bookingId,
        reference,
        amount: normalizedAmount,
        currency,
      },
    });
  } catch (error) {
    console.error('[cumbre.manual.payment] reconciliation failed after payment record', {
      bookingId,
      reference,
      actorUserId: access.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      await updatePaymentRawEventByProviderTxId({
        provider: 'manual',
        providerTxId,
        rawEvent: {
          source: 'cumbre-manual',
          method: paymentMethod,
          actor_user_id: access.userId,
          access_mode: access.mode,
          idempotency_key: idempotencyKey,
          reconciliation_status: 'error',
        },
      });
    } catch (statusError) {
      console.error('[cumbre.manual.payment] reconciliation status update failed', {
        bookingId,
        reference,
        message: statusError instanceof Error ? statusError.message : String(statusError),
      });
    }
    await logSecurityEvent({
      type: 'admin_action',
      identifier: 'cumbre.manual.payment.reconciliation_error',
      ip: clientAddress || null,
      detail: 'Abono registrado con conciliación secundaria pendiente',
      meta: {
        actor_user_id: access.userId,
        actor_email: access.email,
        access_mode: access.mode,
        booking_id: bookingId,
        reference,
      },
    });
    return json({
      ok: false,
      recorded: true,
      reference,
      error: 'El abono quedó registrado, pero la conciliación secundaria requiere revisión. No lo vuelvas a enviar.',
    }, 500);
  }

  return json({ ok: true, reference, idempotent: false });
};
