import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { verifyStripeWebhook, getStripeClient } from '@lib/stripe';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { formatCurrency } from '@lib/fx';
import {
  recordPayment,
  recomputeBookingTotals,
  hasApprovedPaymentByReference,
  getBookingById,
  getInstallmentById,
  getPlanByProviderSubscription,
  getNextPendingInstallment,
  updateInstallment,
  updatePaymentPlan,
  addPlanPayment,
  refreshPlanNextDueDate,
  markInstallmentLinksUsed,
  hasInstallmentReminder,
  recordInstallmentReminder,
} from '@lib/cumbreStore';
import { sendCumbreEmail } from '@lib/cumbreMailer';
import {
  createDonation,
  getDonationByReference,
  updateDonationById,
  updateDonationByReference,
} from '@lib/donationsStore';
import { sendWhatsappMessage } from '@lib/whatsapp';
import {
  getDonationRecurringSubscriptionByProviderSubscription,
  resolveStripeDonationPeriod,
  updateDonationRecurringSubscriptionById,
} from '@lib/donationRecurringSubscriptions';
import {
  getCampusSubscriptionByProviderSubscription,
  resolveStripePeriod,
  updateCampusSubscriptionById,
} from '@lib/campusSubscriptions';
import { upsertCampusDonationAllocations } from '@lib/campusDonationAllocations';
import { isEventPaymentReference, processEventProviderPayment } from '@lib/eventFinance';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function hasWhatsappProvider(): boolean {
  return Boolean(env('WHATSAPP_WEBHOOK_URL'));
}

async function maybeSendWhatsappPaymentReceived(params: {
  bookingId: string;
  booking: any;
  amount: number;
  currency: string;
  installmentId?: string | null;
  planId?: string | null;
  providerTxId?: string | null;
  reference?: string | null;
}): Promise<void> {
  if (!params.booking?.contact_phone || !hasWhatsappProvider()) return;
  const reminderKey = 'PAYMENT_RECEIVED';
  if (params.installmentId) {
    const alreadySent = await hasInstallmentReminder({
      installmentId: params.installmentId,
      reminderKey,
      channel: 'whatsapp',
    });
    if (alreadySent) return;
  }

  const amountLabel = formatCurrency(params.amount, params.currency as any);
  const contentSid = env('WHATSAPP_CUMBRE_PAYMENT_RECEIVED_CONTENT_SID');
  const contentVariables = contentSid
    ? {
        '1': params.booking.contact_name || 'amigo',
        '2': amountLabel,
        '3': params.bookingId,
      }
    : undefined;
  const message = `Cumbre Mundial 2026: Hola${params.booking.contact_name ? ` ${params.booking.contact_name}` : ''}. ` +
    `Confirmamos tu pago de ${amountLabel}. Booking: ${(params.bookingId || '').slice(0, 8).toUpperCase()}.`;

  const ok = await sendWhatsappMessage({
    to: params.booking.contact_phone,
    message,
    contentSid: contentSid || null,
    contentVariables,
    meta: {
      bookingId: params.bookingId,
      planId: params.planId,
      installmentId: params.installmentId,
      provider: 'stripe',
      providerTxId: params.providerTxId,
      reference: params.reference,
      amount: params.amount,
      currency: params.currency,
    },
  });

  if (params.installmentId) {
    await recordInstallmentReminder({
      installmentId: params.installmentId,
      reminderKey,
      channel: 'whatsapp',
      payload: {
        bookingId: params.bookingId,
        planId: params.planId,
        reference: params.reference,
        providerTxId: params.providerTxId,
        amount: params.amount,
        currency: params.currency,
        contentSid: contentSid || null,
        ok,
      },
      error: ok ? null : 'WhatsApp failed',
    });
  }
}

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

      const eventPaymentReference = session.metadata?.event_payment_reference;
      if (isEventPaymentReference(eventPaymentReference)) {
        await processEventProviderPayment({
          provider: 'STRIPE',
          reference: String(eventPaymentReference),
          providerTxId: session.payment_intent ? String(session.payment_intent) : session.id,
          amount: Number(session.amount_total || 0) / 100,
          currency: String(session.currency || '').toUpperCase(),
          status: session.payment_status === 'paid' ? 'APPROVED' : 'PENDING',
          method: 'CARD',
          expectedPaymentId: session.metadata?.event_payment_id || null,
          requestId: event.id,
          payload: {
            event: event.type,
            checkout_session_id: session.id,
            payment_intent_id: session.payment_intent ? String(session.payment_intent) : null,
            client_reference_id: session.client_reference_id,
            payment_status: session.payment_status,
            amount_total: session.amount_total,
            currency: session.currency,
          },
        });
      }

      const bookingId = session.metadata?.cumbre_booking_id;
      const isSubscription = session.mode === 'subscription' || Boolean(session.subscription);
      if (bookingId && !isSubscription) {
        const amount = session.amount_total ? session.amount_total / 100 : 0;
        const currency = session.currency?.toUpperCase() || 'USD';
        const providerTxId = session.payment_intent ? String(session.payment_intent) : session.id;
        const cumbreReference = session.metadata?.cumbre_reference ?? session.id;
        const installmentId = session.metadata?.cumbre_installment_id || null;
        const planId = session.metadata?.cumbre_plan_id || null;
        const isPaid = session.payment_status === 'paid';
        const alreadyApproved = isPaid
          ? await hasApprovedPaymentByReference({ provider: 'stripe', reference: cumbreReference })
          : false;

        const serializedSession = JSON.parse(JSON.stringify(session));
        await recordPayment({
          bookingId,
          provider: 'stripe',
          providerTxId,
          reference: cumbreReference,
          amount,
          currency,
          status: isPaid ? 'APPROVED' : 'PENDING',
          planId,
          installmentId,
          rawEvent: serializedSession,
        });

        if (isPaid && !alreadyApproved) {
          if (installmentId) {
            const installment = await getInstallmentById(installmentId);
            if (installment?.status !== 'PAID') {
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
          if (booking) {
            await maybeSendWhatsappPaymentReceived({
              bookingId,
              booking,
              amount,
              currency,
              installmentId,
              planId,
              providerTxId,
              reference: cumbreReference,
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

      const donationSubscriptionId = session.metadata?.donation_subscription_id;
      if (donationSubscriptionId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription)).catch(() => null);
        const period = resolveStripeDonationPeriod(subscription);
        await updateDonationRecurringSubscriptionById(donationSubscriptionId, {
          status: session.payment_status === 'paid' ? 'ACTIVE' : 'INCOMPLETE',
          provider_subscription_id: String(session.subscription),
          provider_customer_id: session.customer ? String(session.customer) : null,
          current_period_start: period.currentPeriodStart,
          current_period_end: period.currentPeriodEnd,
          next_charge_at: period.nextChargeAt,
          last_charge_status: session.payment_status === 'paid' ? 'APPROVED' : 'PENDING',
          raw_provider_data: session,
        });
      }

      const campusSubscriptionId = session.metadata?.campus_subscription_id;
      if (campusSubscriptionId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription)).catch(() => null);
        const period = resolveStripePeriod(subscription);
        await updateCampusSubscriptionById(campusSubscriptionId, {
          status: session.payment_status === 'paid' ? 'ACTIVE' : 'INCOMPLETE',
          provider_subscription_id: String(session.subscription),
          provider_customer_id: session.customer ? String(session.customer) : null,
          current_period_start: period.currentPeriodStart,
          current_period_end: period.currentPeriodEnd,
          next_charge_at: period.nextChargeAt,
          last_charge_status: session.payment_status === 'paid' ? 'APPROVED' : 'PENDING',
          raw_provider_data: session,
        });
      }
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription ? String(invoice.subscription) : null;
      if (!subscriptionId) break;
      const plan = await getPlanByProviderSubscription(subscriptionId);
      if (!plan) {
        const donationSubscription = await getDonationRecurringSubscriptionByProviderSubscription('stripe', subscriptionId);
        const campusSubscription = donationSubscription
          ? null
          : await getCampusSubscriptionByProviderSubscription('stripe', subscriptionId);
        if (!donationSubscription && !campusSubscription) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId).catch(() => null);
        const billingReason = String((invoice as any).billing_reason || '');
        const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
        const providerTxId = invoice.payment_intent ? String(invoice.payment_intent) : invoice.id;
        const reference = invoice.id;

        if (donationSubscription) {
          const period = resolveStripeDonationPeriod(subscription);
          const currency = invoice.currency?.toUpperCase() || donationSubscription.currency || 'USD';

          if (billingReason !== 'subscription_create') {
            const existingDonation = await getDonationByReference('stripe', reference);
            if (!existingDonation && amount > 0) {
              const donation = await createDonation({
                provider: 'stripe',
                status: 'APPROVED',
                amount,
                currency,
                reference,
                provider_tx_id: providerTxId,
                payment_method: 'card',
                donation_type: donationSubscription.donation_type || 'general',
                project_name: donationSubscription.project_name || 'Donacion recurrente',
                event_name: donationSubscription.event_name || 'Donaciones Mana',
                campus: donationSubscription.campus || '',
                church: donationSubscription.church || '',
                church_city: donationSubscription.donor_city || '',
                donor_name: donationSubscription.donor_name || '',
                donor_email: donationSubscription.donor_email,
                donor_phone: donationSubscription.donor_phone || '',
                donor_document_type: donationSubscription.donor_document_type || '',
                donor_document_number: donationSubscription.donor_document_number || '',
                is_recurring: true,
                donor_country: donationSubscription.donor_country || '',
                donor_city: donationSubscription.donor_city || '',
                donation_description: donationSubscription.donation_description || 'Donacion recurrente Ministerio Mana',
                need_certificate: Boolean(donationSubscription.need_certificate),
                source: 'donaciones-recurrentes-stripe',
                cumbre_booking_id: null,
                raw_event: invoice,
              });
              await updateDonationRecurringSubscriptionById(donationSubscription.id, {
                last_donation_id: donation.id,
              });
            }
          }

          await updateDonationRecurringSubscriptionById(donationSubscription.id, {
            status: 'ACTIVE',
            current_period_start: period.currentPeriodStart,
            current_period_end: period.currentPeriodEnd,
            next_charge_at: period.nextChargeAt,
            last_charge_status: 'APPROVED',
            last_charge_error: null,
            raw_provider_data: invoice,
          });
          break;
        }

        if (campusSubscription) {
          const period = resolveStripePeriod(subscription);
          const currency = invoice.currency?.toUpperCase() || campusSubscription.currency || 'USD';

          if (billingReason !== 'subscription_create') {
          const existingDonation = await getDonationByReference('stripe', reference);
          if (!existingDonation && amount > 0) {
            const allocations = campusSubscription.allocations || [];
            const missionaryName = allocations.length === 1
              ? allocations[0].missionary_name
              : allocations.map((allocation: any) => allocation.missionary_name).filter(Boolean).join(', ');
            const projectName = allocations.length
              ? `campus-multi:${allocations.map((allocation: any) => allocation.missionary_slug).join(',')}`
              : 'Campus Maná';
            const donation = await createDonation({
              provider: 'stripe',
              status: 'APPROVED',
              amount,
              currency,
              reference,
              provider_tx_id: providerTxId,
              payment_method: 'card',
              donation_type: 'campus',
              project_name: projectName,
              event_name: 'Campus Maná',
              campus: 'Campus Maná',
              church: '',
              church_city: campusSubscription.donor_city || '',
              donor_name: campusSubscription.donor_name || '',
              donor_email: campusSubscription.donor_email,
              donor_phone: campusSubscription.donor_phone || '',
              donor_document_type: campusSubscription.donor_document_type || '',
              donor_document_number: campusSubscription.donor_document_number || '',
              is_recurring: true,
              donor_country: campusSubscription.donor_country || '',
              donor_city: campusSubscription.donor_city || '',
              donation_description: 'Siembra mensual Campus Mana',
              need_certificate: false,
              source: 'campus-recurring-stripe',
              cumbre_booking_id: null,
              missionary_id: allocations.length === 1 ? allocations[0].missionary_id || null : null,
              missionary_name: missionaryName || null,
              raw_event: invoice,
            });
            await upsertCampusDonationAllocations(allocations.map((allocation: any) => ({
              donationId: donation.id,
              missionarySlug: allocation.missionary_slug,
              missionaryName: allocation.missionary_name,
              missionaryId: allocation.missionary_id,
              amount: allocation.amount,
              currency,
            })));
            await updateCampusSubscriptionById(campusSubscription.id, {
              last_donation_id: donation.id,
            });
          }
        }

        await updateCampusSubscriptionById(campusSubscription.id, {
          status: 'ACTIVE',
          current_period_start: period.currentPeriodStart,
          current_period_end: period.currentPeriodEnd,
          next_charge_at: period.nextChargeAt,
          last_charge_status: 'APPROVED',
          last_charge_error: null,
          raw_provider_data: invoice,
        });
        break;
        }
      }

      const installment = await getNextPendingInstallment(plan.id);
      if (!installment) break;

      const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
      const currency = invoice.currency?.toUpperCase() || plan.currency || 'USD';
      const providerTxId = invoice.payment_intent ? String(invoice.payment_intent) : invoice.id;
      const reference = invoice.id;
      const alreadyApproved = await hasApprovedPaymentByReference({
        provider: 'stripe',
        reference,
      });
      if (alreadyApproved) break;

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
      if (booking) {
        await maybeSendWhatsappPaymentReceived({
          bookingId: plan.booking_id,
          booking,
          amount,
          currency,
          installmentId: installment.id,
          planId: plan.id,
          providerTxId,
          reference,
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
      if (!plan) {
        const donationSubscription = await getDonationRecurringSubscriptionByProviderSubscription('stripe', subscriptionId);
        if (donationSubscription) {
          await updateDonationRecurringSubscriptionById(donationSubscription.id, {
            status: 'PAYMENT_FAILED',
            last_charge_status: 'FAILED',
            last_charge_error: invoice.last_finalization_error?.message || 'Stripe invoice payment failed',
            raw_provider_data: invoice,
          });
        }

        const campusSubscription = await getCampusSubscriptionByProviderSubscription('stripe', subscriptionId);
        if (campusSubscription) {
          await updateCampusSubscriptionById(campusSubscription.id, {
            status: 'PAYMENT_FAILED',
            last_charge_status: 'FAILED',
            last_charge_error: invoice.last_finalization_error?.message || 'Stripe invoice payment failed',
            raw_provider_data: invoice,
          });
        }
        break;
      }

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
    const eventPaymentReference = intent.metadata?.event_payment_reference;
    if (isEventPaymentReference(eventPaymentReference)) {
      const status = event.type === 'payment_intent.succeeded'
        ? 'APPROVED'
        : event.type === 'payment_intent.payment_failed'
          ? 'FAILED'
          : event.type === 'payment_intent.canceled'
            ? 'VOIDED'
            : 'PENDING';
      await processEventProviderPayment({
        provider: 'STRIPE',
        reference: String(eventPaymentReference),
        providerTxId: intent.id,
        amount: Number(intent.amount_received || intent.amount || 0) / 100,
        currency: String(intent.currency || '').toUpperCase(),
        status,
        method: Array.isArray(intent.payment_method_types) ? intent.payment_method_types[0]?.toUpperCase() : null,
        expectedPaymentId: intent.metadata?.event_payment_id || null,
        requestId: event.id,
        payload: {
          event: event.type,
          payment_intent_id: intent.id,
          status: intent.status,
          amount: intent.amount,
          amount_received: intent.amount_received,
          currency: intent.currency,
        },
      });
    }
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
