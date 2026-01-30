import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { verifyStripeWebhook, getStripeClient } from '@lib/stripe';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import {
  recordPayment,
  recomputeBookingTotals,
  getBookingById,
  getInstallmentById,
  getPlanByProviderSubscription,
  getNextPendingInstallment,
  updateInstallment,
  updatePaymentPlan,
  addPlanPayment,
  refreshPlanNextDueDate,
  markInstallmentLinksUsed,
} from '@lib/cumbreStore';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import { updateDonationById, updateDonationByReference } from '@lib/donationsStore';

export const prerender = false;

async function processEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripeClient();
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const reference = session.id;
      void logPaymentEvent('stripe', 'checkout.completed', reference, {
        amount_total: session.amount_total,
        currency: session.currency,
        customer_email: session.customer_details?.email ?? session.customer_email,
        payment_status: session.payment_status,
      });

      const bookingId = session.metadata?.cumbre_booking_id;
      const isSubscription = session.mode === 'subscription' || Boolean(session.subscription);
      if (bookingId && !isSubscription) {
        const amount = session.amount_total ? session.amount_total / 100 : 0;
        const currency = session.currency?.toUpperCase() || 'USD';
        const providerTxId = session.payment_intent ? String(session.payment_intent) : session.id;
        const cumbreReference = session.metadata?.cumbre_reference ?? session.id;
        const installmentId = session.metadata?.cumbre_installment_id || null;
        const planId = session.metadata?.cumbre_plan_id || null;

        const serializedSession = JSON.parse(JSON.stringify(session));
        await recordPayment({
          bookingId,
          provider: 'stripe',
          providerTxId,
          reference: cumbreReference,
          amount,
          currency,
          status: session.payment_status === 'paid' ? 'APPROVED' : 'PENDING',
          planId,
          installmentId,
          rawEvent: serializedSession,
        });

        if (session.payment_status === 'paid') {
          if (installmentId) {
            const installment = await getInstallmentById(installmentId);
            await updateInstallment(installmentId, {
              status: 'PAID',
              provider_tx_id: providerTxId,
              provider_reference: cumbreReference,
              paid_at: new Date().toISOString(),
              attempt_count: Number(installment?.attempt_count || 0) + 1,
            });
            await markInstallmentLinksUsed(installmentId);
            if (planId) {
              await addPlanPayment(planId, amount);
              await refreshPlanNextDueDate(planId);
            }
          }
          const booking = await getBookingById(bookingId);
          if (booking?.contact_email) {
            await sendCumbreEmail('payment_received', {
              to: booking.contact_email,
              fullName: booking.contact_name ?? undefined,
              bookingId,
              amount,
              currency,
              totalPaid: booking.total_paid,
              totalAmount: booking.total_amount,
            });
          }
          await recomputeBookingTotals(bookingId);
        }
      }

      const planId = session.metadata?.cumbre_plan_id;
      if (planId && session.subscription) {
        await updatePaymentPlan(planId, {
          provider_subscription_id: String(session.subscription),
          provider_customer_id: session.customer ? String(session.customer) : null,
        });
        const cancelAtRaw = session.metadata?.cumbre_cancel_at;
        const cancelAt = cancelAtRaw ? Number(cancelAtRaw) : 0;
        if (cancelAt && Number.isFinite(cancelAt)) {
          try {
            await stripe.subscriptions.update(String(session.subscription), {
              cancel_at: Math.floor(cancelAt),
            });
          } catch (err) {
            console.error('[stripe.webhook] cancel_at update failed', err);
          }
        }
      }

      const donationId = session.metadata?.donation_id;
      const donationReference = session.metadata?.donation_reference;
      if (donationId || donationReference) {
        const status = session.payment_status === 'paid' ? 'APPROVED' : 'PENDING';
        const providerTxId = session.payment_intent ? String(session.payment_intent) : session.id;
        if (donationId) {
          await updateDonationById({
            donationId,
            status,
            providerTxId,
            rawEvent: session,
          });
        } else if (donationReference) {
          await updateDonationByReference({
            provider: 'stripe',
            reference: donationReference,
            status,
            providerTxId,
            rawEvent: session,
          });
        }
      }
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription ? String(invoice.subscription) : null;
      if (!subscriptionId) break;
      const plan = await getPlanByProviderSubscription(subscriptionId);
      if (!plan) break;

      const installment = await getNextPendingInstallment(plan.id);
      if (!installment) break;

      const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
      const currency = invoice.currency?.toUpperCase() || plan.currency || 'USD';
      const providerTxId = invoice.payment_intent ? String(invoice.payment_intent) : invoice.id;
      const reference = invoice.id;

      await updateInstallment(installment.id, {
        status: 'PAID',
        provider_tx_id: providerTxId,
        provider_reference: reference,
        paid_at: new Date().toISOString(),
      });
      await addPlanPayment(plan.id, amount);
      await refreshPlanNextDueDate(plan.id);

      await recordPayment({
        bookingId: plan.booking_id,
        provider: 'stripe',
        providerTxId,
        reference,
        amount,
        currency,
        status: 'APPROVED',
        planId: plan.id,
        installmentId: installment.id,
        rawEvent: invoice,
      });

      const booking = await getBookingById(plan.booking_id);
      if (booking?.contact_email) {
        await sendCumbreEmail('payment_received', {
          to: booking.contact_email,
          fullName: booking.contact_name ?? undefined,
          bookingId: plan.booking_id,
          amount,
          currency,
          totalPaid: booking.total_paid,
          totalAmount: booking.total_amount,
        });
      }

      await recomputeBookingTotals(plan.booking_id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription ? String(invoice.subscription) : null;
      if (!subscriptionId) break;
      const plan = await getPlanByProviderSubscription(subscriptionId);
      if (!plan) break;

      const installment = await getNextPendingInstallment(plan.id);
      if (!installment) break;

      await updateInstallment(installment.id, {
        status: 'FAILED',
        last_error: invoice.last_finalization_error?.message || 'Stripe invoice payment failed',
        attempt_count: Number(installment.attempt_count || 0) + 1,
      });
      break;
    }
    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      void logPaymentEvent('stripe', 'payment_intent.succeeded', intent.id, {
        amount: intent.amount_received,
        currency: intent.currency,
        customer: intent.customer,
        charges: intent.charges?.data?.map((charge) => ({
          id: charge.id,
          status: charge.status,
        })),
      });
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      void logSecurityEvent({
        type: 'payment_error',
        identifier: intent.id,
        detail: 'Stripe payment failed',
        meta: {
          amount: intent.amount,
          currency: intent.currency,
          last_payment_error: intent.last_payment_error?.message,
        },
      });
      break;
    }
    default: {
      let serialized: Record<string, unknown> = {};
      try {
        serialized = JSON.parse(JSON.stringify(event.data));
      } catch {
        serialized = { object: event.data.object };
      }
      void logPaymentEvent('stripe', event.type, event.id, {
        raw: serialized,
      });
      break;
    }
  }
  if (event.type.startsWith('payment_intent.') && event.data.object) {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata?.checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(intent.metadata.checkout_session_id).catch(() => null);
      if (session) {
        void logPaymentEvent('stripe', 'checkout.session.synced', session.id, {
          amount_total: session.amount_total,
          currency: session.currency,
          payment_status: session.payment_status,
        });
      }
    }
  }
}

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  try {
    const event = verifyStripeWebhook(payload, signature);
    await processEvent(event);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[stripe.webhook] error', error);
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'stripe',
      detail: error?.message || 'Stripe webhook error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Firma inválida o evento desconocido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
};
