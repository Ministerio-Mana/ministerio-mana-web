import type { APIRoute } from 'astro';
import { sanitizePlainText } from '@lib/validation';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { getBookingById, getPlanByBookingId, recordPayment, recomputeBookingTotals, applyManualPaymentToPlan } from '@lib/cumbreStore';

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

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const token = form.get('token')?.toString();

  if (!validateAdmin(request, token)) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = (form.get('bookingId')?.toString() ?? '').trim();
  const amount = Number(form.get('amount')?.toString() ?? 0);
  const paymentMethod = sanitizePlainText(form.get('paymentMethod')?.toString() ?? '', 40);

  if (!bookingId || !Number.isFinite(amount) || amount <= 0) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId y monto requeridos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const booking = await getBookingById(bookingId);
  if (!booking) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const currency = booking.currency || 'COP';
  const reference = buildDonationReference();

  await recordPayment({
    bookingId,
    provider: 'manual',
    providerTxId: null,
    reference,
    amount,
    currency,
    status: 'APPROVED',
    rawEvent: {
      source: 'cumbre-manual',
      method: paymentMethod || null,
    },
  });

  const plan = await getPlanByBookingId(bookingId);
  if (plan) {
    await applyManualPaymentToPlan({
      planId: plan.id,
      amount,
      reference,
    });
  }

  await recomputeBookingTotals(bookingId);

  await createDonation({
    provider: 'physical',
    status: 'APPROVED',
    amount,
    currency,
    reference,
    provider_tx_id: null,
    payment_method: paymentMethod || null,
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
    donor_country: booking.contact_country ?? null,
    donor_city: booking.contact_city ?? null,
    source: 'cumbre-manual',
    cumbre_booking_id: bookingId,
    raw_event: null,
  });

  return new Response(JSON.stringify({ ok: true, reference }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
