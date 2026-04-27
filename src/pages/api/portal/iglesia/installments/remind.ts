import type { APIRoute } from 'astro';
import { resolveBaseUrl } from '@lib/url';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { createInstallmentLinkToken, recordInstallmentReminder } from '@lib/cumbreStore';
import { sendCumbreEmail } from '@lib/cumbreMailer';

export const prerender = false;

function formatCurrency(amount: number, currency: string): string {
  if (currency === 'COP') {
    return `$ ${Math.round(amount).toLocaleString('es-CO')} COP`;
  }
  return `$ ${amount.toFixed(2)} ${currency}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a cuotas');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => ({}));
  const installmentId = (body?.installmentId || '').toString();
  if (!installmentId) {
    return new Response(JSON.stringify({ ok: false, error: 'installmentId requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: installment, error } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, plan_id, installment_index, due_date, amount, currency, status, booking:cumbre_bookings(id, contact_name, contact_email, contact_phone, contact_church, church_id), plan:cumbre_payment_plans(id, provider, currency, installment_count, provider_payment_method_id, provider_subscription_id)')
    .eq('id', installmentId)
    .maybeSingle();

  if (error || !installment) {
    return new Response(JSON.stringify({ ok: false, error: 'Cuota no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const booking = (installment as any).booking || {};
  const plan = (installment as any).plan || {};
  const isAuto = (plan?.provider === 'wompi' && plan?.provider_payment_method_id)
    || (plan?.provider === 'stripe' && plan?.provider_subscription_id);

  if (!access.isAdmin) {
    const isAllowedChurch = await isChurchAllowedForAccess(booking?.church_id || null, access);
    if (!isAllowedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (isAuto) {
    return new Response(JSON.stringify({ ok: false, error: 'Cobro automático activo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!booking?.contact_email) {
    return new Response(JSON.stringify({ ok: false, error: 'Reserva sin correo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let paymentLink: string | null = null;
  try {
    const token = await createInstallmentLinkToken(installmentId);
    paymentLink = token ? `${resolveBaseUrl(request)}/cumbre2026/pagar/${token}` : null;
  } catch (err: any) {
    await recordInstallmentReminder({
      installmentId,
      reminderKey: `MANUAL-${new Date().toISOString()}`,
      channel: 'system',
      payload: { bookingId: booking.id, planId: plan.id },
      error: err?.message || 'No se pudo generar link',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo generar el link' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!paymentLink) {
    return new Response(JSON.stringify({ ok: false, error: 'Link inválido' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const reminderKey = `MANUAL-${new Date().toISOString()}`;
  const amount = Number(installment.amount || 0);
  const currency = plan.currency || installment.currency || 'COP';

  try {
    await sendCumbreEmail('installment_reminder', {
      to: booking.contact_email,
      fullName: booking.contact_name ?? undefined,
      bookingId: booking.id,
      amount,
      currency,
      dueDate: installment.due_date,
      installmentIndex: installment.installment_index,
      installmentCount: plan.installment_count,
      paymentLink,
    });

    await recordInstallmentReminder({
      installmentId,
      reminderKey,
      channel: 'email',
      payload: {
        bookingId: booking.id,
        planId: plan.id,
        amount,
        currency,
        paymentLink,
      },
    });
  } catch (err: any) {
    await recordInstallmentReminder({
      installmentId,
      reminderKey,
      channel: 'email',
      payload: {
        bookingId: booking.id,
        planId: plan.id,
        amount,
        currency,
        paymentLink,
      },
      error: err?.message || 'Email failed',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar el recordatorio' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, paymentLink, amountLabel: formatCurrency(amount, currency) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
