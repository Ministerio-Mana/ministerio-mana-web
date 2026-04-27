import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { createWompiPaymentSource, verifyWompiWebhook } from '@lib/wompi';
import { logSecurityEvent } from '@lib/securityEvents';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { parseReferenceBookingId, parseReferencePlanId } from '@lib/cumbre2026';
import { formatCurrency } from '@lib/fx';
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
  hasInstallmentReminder,
  recordInstallmentReminder,
} from '@lib/cumbreStore';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import { sendWhatsappMessage } from '@lib/whatsapp';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function hasWhatsappProvider(): boolean {
  return Boolean(env('WHATSAPP_WEBHOOK_URL'));
}

const WOMPI_FAILED_STATUSES = new Set(['DECLINED', 'VOIDED', 'ERROR', 'FAILED']);

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

  const internalOk = validInternalSignature(payload, internalSignature);
  let wompiOk = false;

  if (wompiSignature) {
    try {
      wompiOk = verifyWompiWebhook(payload, wompiSignature);
    } catch (error: any) {
      if (!internalOk) {
        console.error('[wompi.forwarded] wompi signature error', error);
        void logSecurityEvent({
          type: 'webhook_invalid',
          identifier: 'wompi.forwarded',
          detail: error?.message || 'Firma Wompi invalida',
        });
      }
    }
  }

  if (!internalOk && !wompiOk) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'wompi.forwarded',
      detail: 'Firma invalida',
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

  try {
    const bookingId = parseReferenceBookingId(reference);
    const planId = parseReferencePlanId(reference);

    if (!bookingId && !planId) {
      return new Response(JSON.stringify({ ok: true, stored: true, ignored: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const wompiStatus = String(transaction?.status ?? 'PENDING').toUpperCase();
    const normalizedStatus = wompiStatus === 'APPROVED'
      ? 'APPROVED'
      : WOMPI_FAILED_STATUSES.has(wompiStatus)
        ? 'FAILED'
        : 'PENDING';
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
        const isApproved = normalizedStatus === 'APPROVED';
        const isFailed = normalizedStatus === 'FAILED';
        const wasPaid = installment.status === 'PAID';
        const nextInstallmentStatus = isApproved ? 'PAID' : isFailed ? 'FAILED' : 'PROCESSING';

        installmentId = installment.id;
        await updateInstallment(installment.id, {
          status: nextInstallmentStatus,
          provider_tx_id: providerTxId,
          provider_reference: reference,
          paid_at: isApproved ? new Date().toISOString() : null,
          attempt_count: isFailed
            ? Number(installment.attempt_count || 0) + 1
            : installment.attempt_count,
          last_error: isFailed ? 'Wompi payment failed' : null,
        });
        if (isApproved && !wasPaid) {
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

    const pendingNotify = normalizedStatus === 'PENDING'
      && bookingId
      && paymentMethodType
      && paymentMethodType !== 'CARD';
    const shouldLookupBooking = Boolean(bookingId && (normalizedStatus === 'APPROVED' || pendingNotify));
    const booking = shouldLookupBooking ? await getBookingById(bookingId!) : null;

    if (normalizedStatus === 'APPROVED' && bookingId) {
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

    if (booking?.contact_phone && hasWhatsappProvider()) {
      if (normalizedStatus === 'APPROVED') {
        const reminderKey = 'PAYMENT_RECEIVED';
        const alreadySent = installmentId
          ? await hasInstallmentReminder({ installmentId, reminderKey, channel: 'whatsapp' })
          : false;
        if (!alreadySent) {
          const amountLabel = formatCurrency(amount, normalizedCurrency as any);
          const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_RECEIVED_CONTENT_SID');
          const contentVariables = contentSid
            ? {
                '1': booking.contact_name || 'amigo',
                '2': amountLabel,
                '3': bookingId || '',
              }
            : undefined;
          const message = `Cumbre Mundial 2026: Hola${booking.contact_name ? ` ${booking.contact_name}` : ''}. ` +
            `Confirmamos tu pago de ${amountLabel}. Booking: ${(bookingId || '').slice(0, 8).toUpperCase()}.`;
          const ok = await sendWhatsappMessage({
            to: booking.contact_phone,
            message,
            contentSid: contentSid || null,
            contentVariables,
            meta: {
              bookingId,
              planId,
              installmentId,
              provider: 'wompi',
              reference,
              providerTxId,
              amount,
              currency: normalizedCurrency,
            },
          });
          if (installmentId) {
            await recordInstallmentReminder({
              installmentId,
              reminderKey,
              channel: 'whatsapp',
              payload: {
                bookingId,
                planId,
                reference,
                providerTxId,
                amount,
                currency: normalizedCurrency,
                contentSid: contentSid || null,
                ok,
              },
              error: ok ? null : 'WhatsApp failed',
            });
          }
        }
      }

      if (pendingNotify && bookingId) {
        const reminderKey = 'PAYMENT_PENDING';
        const alreadySent = installmentId
          ? await hasInstallmentReminder({ installmentId, reminderKey, channel: 'whatsapp' })
          : false;
        if (!alreadySent) {
          const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_PENDING_CONTENT_SID');
          const contentVariables = contentSid
            ? {
                '1': booking.contact_name || 'amigo',
                '2': bookingId || '',
              }
            : undefined;
          const message = `Cumbre Mundial 2026: Hola${booking.contact_name ? ` ${booking.contact_name}` : ''}. ` +
            `Tu pago esta en verificacion. Si pagaste con PSE/Nequi/ahorros puede tardar unos minutos. ` +
            `No hagas otro pago. Booking: ${(bookingId || '').slice(0, 8).toUpperCase()}.`;
          const ok = await sendWhatsappMessage({
            to: booking.contact_phone,
            message,
            contentSid: contentSid || null,
            contentVariables,
            meta: {
              bookingId,
              planId,
              installmentId,
              provider: 'wompi',
              reference,
              providerTxId,
              amount,
              currency: normalizedCurrency,
              status: normalizedStatus,
              paymentMethodType,
            },
          });
          if (installmentId) {
            await recordInstallmentReminder({
              installmentId,
              reminderKey,
              channel: 'whatsapp',
              payload: {
                bookingId,
                planId,
                reference,
                providerTxId,
                amount,
                currency: normalizedCurrency,
                status: normalizedStatus,
                paymentMethodType,
                contentSid: contentSid || null,
                ok,
              },
              error: ok ? null : 'WhatsApp failed',
            });
          }
        }
      }
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
