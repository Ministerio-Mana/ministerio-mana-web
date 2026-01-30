import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { createWompiPaymentSource, verifyWompiWebhook } from '@lib/wompi';
import { logSecurityEvent } from '@lib/securityEvents';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { parseReferenceBookingId, parseReferencePlanId } from '@lib/cumbre2026';
import {
  recordPayment,
  recomputeBookingTotals,
  getBookingById,
  getPlanById,
  getInstallmentByReference,
  getNextPendingInstallment,
  updateInstallment,
  addPlanPayment,
  updatePaymentPlan,
  refreshPlanNextDueDate,
  markInstallmentLinksUsed,
} from '@lib/cumbreStore';
import { sendCumbreEmail } from '@lib/cumbreMailer';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function validInternalSignature(payload: string, signature: string | null): boolean {
  const secret = env('INTERNAL_WEBHOOK_SECRET');
  if (!secret || !signature) return false;
  const normalized = signature.trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== normalized.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized));
}

function sha256Hex(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.text();
  const internalSignature = request.headers.get('x-internal-signature');
  const wompiSignature = request.headers.get('x-wompi-signature');

  if (!validInternalSignature(payload, internalSignature)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'wompi.forwarded',
      detail: 'Firma interna invalida',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Firma invalida' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let event: any = null;
  let parseError: string | null = null;
  try {
    event = JSON.parse(payload);
  } catch (error: any) {
    parseError = error?.message ?? 'JSON parse error';
  }

  const transaction = event?.data?.transaction;
  const reference = transaction?.reference ?? null;
  const status = transaction?.status ?? null;
  const currency = transaction?.currency ?? null;
  const amountInCents = transaction?.amount_in_cents ?? null;
  const txId = transaction?.id ?? null;
  const bodySha256 = sha256Hex(payload);

  if (!supabaseAdmin) {
    console.error('[wompi.forwarded] missing supabase admin env vars');
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error: inboxError } = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .upsert(
      {
        body_sha256: bodySha256,
        tx_id: txId ? String(txId) : null,
        reference,
        status,
        currency,
        amount_in_cents: amountInCents ? Number(amountInCents) : null,
        raw_body: payload,
        payload: event ?? null,
        parse_error: parseError,
      },
      { onConflict: 'body_sha256', ignoreDuplicates: true }
    );

  if (inboxError) {
    console.error('[wompi.forwarded] inbox insert error', inboxError);
    return new Response(JSON.stringify({ ok: false, error: 'DB error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (parseError || !event) {
    return new Response(JSON.stringify({ ok: true, stored: true, parse_error: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (wompiSignature) {
    try {
      const ok = verifyWompiWebhook(payload, wompiSignature);
      if (!ok) {
        throw new Error('Firma Wompi invalida');
      }
    } catch (error: any) {
      console.error('[wompi.forwarded] wompi signature error', error);
      void logSecurityEvent({
        type: 'webhook_invalid',
        identifier: 'wompi.forwarded',
        detail: error?.message || 'Firma Wompi invalida',
      });
      return new Response(JSON.stringify({ ok: true, stored: true, ignored: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  try {
    const bookingId = parseReferenceBookingId(reference);
    const planId = parseReferencePlanId(reference);

    if (!bookingId && !planId) {
      return new Response(JSON.stringify({ ok: true, stored: true, ignored: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const normalizedStatus = transaction?.status ?? 'PENDING';
    const amount = amountInCents ? Number(amountInCents) / 100 : 0;
    const normalizedCurrency = transaction?.currency || 'COP';
    const providerTxId = txId ? String(txId) : null;
    const paymentMethodType = transaction?.payment_method?.type ?? transaction?.payment_method_type ?? null;
    const paymentMethodToken = transaction?.payment_method?.token ?? null;
    const paymentSourceId = transaction?.payment_source_id ?? null;

    let installmentId: string | null = null;
    if (planId) {
      const installmentByRef = reference ? await getInstallmentByReference(reference) : null;
      const installment = installmentByRef || await getNextPendingInstallment(planId);
      if (installment) {
        installmentId = installment.id;
        await updateInstallment(installment.id, {
          status: normalizedStatus === 'APPROVED' ? 'PAID' : 'FAILED',
          provider_tx_id: providerTxId,
          provider_reference: reference,
          paid_at: normalizedStatus === 'APPROVED' ? new Date().toISOString() : null,
          attempt_count: normalizedStatus === 'APPROVED'
            ? installment.attempt_count
            : Number(installment.attempt_count || 0) + 1,
          last_error: normalizedStatus === 'APPROVED' ? null : 'Wompi payment failed',
        });
        if (normalizedStatus === 'APPROVED') {
          await addPlanPayment(planId, amount);
          await refreshPlanNextDueDate(planId);
          if (installmentId) {
            await markInstallmentLinksUsed(installmentId);
          }
        }
      }

      const plan = await getPlanById(planId);
      if (plan?.provider === 'wompi') {
        if (paymentSourceId) {
          await updatePaymentPlan(planId, {
            provider_payment_method_id: String(paymentSourceId),
          });
        } else if (paymentMethodType === 'CARD' && paymentMethodToken) {
          const booking = bookingId ? await getBookingById(bookingId) : null;
          if (booking?.contact_email) {
            try {
              const sourceId = await createWompiPaymentSource({
                token: String(paymentMethodToken),
                customerEmail: booking.contact_email,
              });
              if (sourceId) {
                await updatePaymentPlan(planId, {
                  provider_payment_method_id: String(sourceId),
                });
              }
            } catch (error: any) {
              void logSecurityEvent({
                type: 'payment_error',
                identifier: 'wompi.forwarded',
                detail: error?.message || 'No se pudo tokenizar tarjeta Wompi',
                meta: { planId, bookingId },
              });
            }
          }
        }
      }
    }

    if (bookingId) {
      await recordPayment({
        bookingId,
        provider: 'wompi',
        providerTxId,
        reference,
        amount,
        currency: normalizedCurrency,
        status: normalizedStatus,
        planId: planId ?? undefined,
        installmentId: installmentId ?? undefined,
        rawEvent: event,
      });
    }

    if (normalizedStatus === 'APPROVED' && bookingId) {
      const booking = await getBookingById(bookingId);
      if (booking?.contact_email) {
        await sendCumbreEmail('payment_received', {
          to: booking.contact_email,
          fullName: booking.contact_name ?? undefined,
          bookingId,
          amount,
          currency: normalizedCurrency,
          totalPaid: booking.total_paid,
          totalAmount: booking.total_amount,
        });
      }
      await recomputeBookingTotals(bookingId);
    }
  } catch (error: any) {
    console.error('[wompi.forwarded] processing error', error);
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'wompi.forwarded',
      detail: error?.message || 'Forwarded webhook processing error',
    });
  }

  return new Response(JSON.stringify({ ok: true, stored: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
