import type { APIRoute } from 'astro';
import { buildInstallmentReference } from '@lib/cumbre2026';
import { listDueInstallments, updateInstallment, updatePaymentPlan, getBookingById, recordPayment } from '@lib/cumbreStore';
import { createWompiCharge } from '@lib/wompi';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validateCron(request: Request): boolean {
  const secret = env('CUMBRE_CRON_SECRET');
  if (!secret) return true;
  const header = request.headers.get('x-cron-secret');
  if (header && header === secret) return true;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && token === secret);
}

export const POST: APIRoute = async ({ request }) => {
  if (!validateCron(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'cumbre.installments',
      detail: 'Cron secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const dueInstallments = await listDueInstallments(50);
  let processed = 0;

  for (const installment of dueInstallments) {
    const plan = installment.plan;
    if (!plan || plan.status !== 'ACTIVE') continue;

    if (plan.provider === 'stripe') {
      continue;
    }

    if (plan.provider === 'wompi') {
      if (!plan.provider_payment_method_id) {
        void logSecurityEvent({
          type: 'payment_error',
          identifier: 'cumbre.installments',
          detail: 'Plan sin payment_source_id para cobro automatico',
          meta: { planId: plan.id, bookingId: plan.booking_id },
        });
        continue;
      }

      const booking = await getBookingById(plan.booking_id);
      if (!booking?.contact_email) continue;

      const reference = buildInstallmentReference({
        bookingId: plan.booking_id,
        planId: plan.id,
        installmentIndex: installment.installment_index,
      });

      await updateInstallment(installment.id, {
        status: 'PROCESSING',
        provider_reference: reference,
        attempt_count: Number(installment.attempt_count || 0) + 1,
        last_error: null,
      });

      try {
        const tx = await createWompiCharge({
          amountInCents: Math.round(Number(installment.amount || 0) * 100),
          currency: 'COP',
          reference,
          customerEmail: booking.contact_email,
          paymentSourceId: plan.provider_payment_method_id,
        });

        await recordPayment({
          bookingId: plan.booking_id,
          provider: 'wompi',
          providerTxId: tx?.id ?? null,
          reference,
          amount: Number(installment.amount || 0),
          currency: 'COP',
          status: tx?.status ?? 'PENDING',
          planId: plan.id,
          installmentId: installment.id,
        });

        await updatePaymentPlan(plan.id, { last_attempt_at: new Date().toISOString() });
        processed += 1;
      } catch (error: any) {
        await updateInstallment(installment.id, {
          status: 'FAILED',
          last_error: error?.message || 'Wompi charge failed',
        });
        await updatePaymentPlan(plan.id, { last_attempt_at: new Date().toISOString() });
        void logSecurityEvent({
          type: 'payment_error',
          identifier: 'cumbre.installments',
          detail: 'Cobro automatico Wompi fallido',
          meta: {
            planId: plan.id,
            bookingId: plan.booking_id,
            installmentId: installment.id,
            error: error?.message,
          },
        });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, processed }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
