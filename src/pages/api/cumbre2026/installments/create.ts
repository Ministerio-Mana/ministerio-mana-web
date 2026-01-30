import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { resolveBaseUrl } from '@lib/url';
import { buildInstallmentReference } from '@lib/cumbre2026';
import { buildInstallmentSchedule, type InstallmentFrequency } from '@lib/cumbreInstallments';
import {
  createPaymentPlan,
  getBookingById,
  getPlanByBookingId,
  getInstallmentByPlanIndex,
  updateInstallment,
  updatePaymentPlan,
} from '@lib/cumbreStore';
import { createStripeDonationSession, createStripeInstallmentSession } from '@lib/stripe';
import { buildWompiCheckoutUrl } from '@lib/wompi';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isTestModeAllowed(runtimeEnv: string): boolean {
  if (runtimeEnv === 'production') return false;
  const flag = env('CUMBRE_TEST_MODE') ?? env('PUBLIC_CUMBRE_TEST_MODE');
  return flag === 'true';
}

function getTestAmount(currency: string): number {
  const raw = currency === 'COP'
    ? env('CUMBRE_TEST_AMOUNT_COP') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_COP')
    : env('CUMBRE_TEST_AMOUNT_USD') ?? env('PUBLIC_CUMBRE_TEST_AMOUNT_USD');
  const fallback = currency === 'COP' ? 5000 : 1;
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeFrequency(raw: string | null | undefined): InstallmentFrequency {
  const value = (raw || '').toString().trim().toUpperCase();
  if (value === 'BIWEEKLY' || value === 'QUINCENAL') return 'BIWEEKLY';
  return 'MONTHLY';
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const contentType = request.headers.get('content-type') || '';
  let payload: any = {};

  try {
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = {
        bookingId: form.get('bookingId'),
        frequency: form.get('frequency'),
        token: form.get('token'),
      };
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingId = (payload.bookingId || '').toString();
  if (!bookingId) {
    return new Response(JSON.stringify({ ok: false, error: 'bookingId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const allowed = await enforceRateLimit(`cumbre.installments:${clientAddress ?? 'unknown'}`);
  if (!allowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: 'cumbre.installments',
      ip: clientAddress,
      detail: 'Cumbre installments',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const booking = await getBookingById(bookingId);
    if (!booking) {
      return new Response(JSON.stringify({ ok: false, error: 'Reserva no encontrada' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    const existingPlan = await getPlanByBookingId(bookingId);
    if (existingPlan) {
      return new Response(JSON.stringify({ ok: false, error: 'La reserva ya tiene un plan de cuotas' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const runtimeEnv =
      import.meta.env?.VERCEL_ENV ?? process.env?.VERCEL_ENV ?? process.env?.NODE_ENV ?? 'development';
    const allowTestMode = isTestModeAllowed(runtimeEnv);
    const testMode = Boolean(payload.testMode) && allowTestMode;
    const frequency = normalizeFrequency(payload.frequency);
    const currency = booking.currency === 'COP' ? 'COP' : 'USD';
    const totalAmount = testMode ? getTestAmount(currency) : Number(booking.total_amount || 0);
    const schedule = buildInstallmentSchedule({
      totalAmount,
      currency,
      frequency,
    });

    const provider = currency === 'COP' ? 'wompi' : 'stripe';
    const plan = await createPaymentPlan({
      bookingId,
      frequency,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      totalAmount,
      currency,
      installmentCount: schedule.installmentCount,
      installmentAmount: schedule.installmentAmount,
      provider,
      autoDebit: true,
      installments: schedule.installments,
    });

    const baseUrl = resolveBaseUrl(request);
    const tokenParam = payload.token ? `&token=${encodeURIComponent(payload.token)}` : '';
    const statusUrl = `${baseUrl}/eventos/cumbre-mundial-2026/estado?bookingId=${bookingId}${tokenParam}`;
    const registerUrl = `${baseUrl}/eventos/cumbre-mundial-2026/registro?bookingId=${bookingId}${tokenParam}`;

    if (provider === 'stripe') {
      const interval = frequency === 'BIWEEKLY' ? 'week' : 'month';
      const intervalCount = frequency === 'BIWEEKLY' ? 2 : 1;
      const cancelAt = new Date(`${schedule.endDate}T23:59:59-05:00`).getTime() / 1000;

      try {
        const session = await createStripeInstallmentSession({
          amount: schedule.installmentAmount,
          currency: 'USD',
          description: 'Cumbre Mundial 2026 - Cuotas',
          interval,
          intervalCount,
          successUrl: registerUrl,
          cancelUrl: statusUrl,
          metadata: {
            cumbre_booking_id: bookingId,
            cumbre_plan_id: plan.id,
            cumbre_frequency: frequency,
            cumbre_cancel_at: String(Math.floor(cancelAt)),
          },
          customerEmail: booking.contact_email || undefined,
        });

        if (!session.url) {
          throw new Error('No se pudo iniciar el pago en cuotas');
        }

        return new Response(JSON.stringify({
          ok: true,
          planId: plan.id,
          provider: 'stripe',
          url: session.url,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } catch (stripeError: any) {
        console.error('[cumbre.installments] stripe subscription error', stripeError);
        const allowFallback =
          (env('CUMBRE_STRIPE_SUBSCRIPTION_FALLBACK') ?? env('PUBLIC_CUMBRE_STRIPE_SUBSCRIPTION_FALLBACK')) === 'true';
        if (!allowFallback) {
          throw stripeError;
        }

        const firstInstallment = schedule.installments[0];
        const reference = buildInstallmentReference({
          bookingId,
          planId: plan.id,
          installmentIndex: firstInstallment.installmentIndex,
        });
        const installmentRow = await getInstallmentByPlanIndex(plan.id, firstInstallment.installmentIndex);
        if (installmentRow) {
          await updateInstallment(installmentRow.id, { provider_reference: reference });
        }
        await updatePaymentPlan(plan.id, { auto_debit: false });

        const fallbackSession = await createStripeDonationSession({
          amountUsd: firstInstallment.amount,
          currency: 'USD',
          description: 'Cumbre Mundial 2026 - Cuota 1',
          successUrl: registerUrl,
          cancelUrl: statusUrl,
          customerEmail: booking.contact_email || undefined,
          metadata: {
            cumbre_booking_id: bookingId,
            cumbre_plan_id: plan.id,
            cumbre_installment_id: installmentRow?.id || '',
            cumbre_reference: reference,
            cumbre_frequency: frequency,
            cumbre_cancel_at: String(Math.floor(cancelAt)),
          },
        });

        if (!fallbackSession.url) {
          throw stripeError;
        }

        return new Response(JSON.stringify({
          ok: true,
          planId: plan.id,
          provider: 'stripe',
          url: fallbackSession.url,
          mode: 'manual',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const firstInstallment = schedule.installments[0];
    const reference = buildInstallmentReference({
      bookingId,
      planId: plan.id,
      installmentIndex: firstInstallment.installmentIndex,
    });
    const installmentRow = await getInstallmentByPlanIndex(plan.id, firstInstallment.installmentIndex);
    if (installmentRow) {
      await updateInstallment(installmentRow.id, { provider_reference: reference });
    }

    const { url } = buildWompiCheckoutUrl({
      amountInCents: Math.round(firstInstallment.amount * 100),
      currency: 'COP',
      description: 'Cumbre Mundial 2026 - Cuota 1',
      redirectUrl: registerUrl,
      reference,
      email: booking.contact_email || undefined,
    });

    return new Response(JSON.stringify({
      ok: true,
      planId: plan.id,
      provider: 'wompi',
      url,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[cumbre.installments] error', error);
    const runtimeEnv =
      import.meta.env?.VERCEL_ENV ?? process.env?.VERCEL_ENV ?? process.env?.NODE_ENV ?? 'development';
    const isProd = runtimeEnv === 'production';
    const message = isProd ? 'Error creando plan de cuotas' : (error?.message || 'Error creando plan de cuotas');
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
