import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { depositThreshold } from '@lib/cumbre2026';
import { buildDepositSchedule, getInstallmentDeadline, isValidDateOnly } from '@lib/cumbreInstallments';
import { createPaymentPlan, getBookingById, getPlanByBookingId } from '@lib/cumbreStore';

export const prerender = false;

function parseLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
        dueDate: form.get('dueDate') || form.get('depositDueDate') || form.get('deposit_due_date'),
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

  const allowed = await enforceRateLimit(`cumbre.deposit:${clientAddress ?? 'unknown'}`);
  if (!allowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: 'cumbre.deposit',
      ip: clientAddress,
      detail: 'Cumbre deposit',
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

    const rawDueDate = (payload.dueDate || payload.depositDueDate || payload.deposit_due_date || '').toString().trim();
    if (!isValidDateOnly(rawDueDate)) {
      return new Response(JSON.stringify({ ok: false, error: 'Fecha de segundo pago invalida' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const deadline = getInstallmentDeadline();
    const today = parseLocalDate(new Date());
    if (rawDueDate < today) {
      return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago debe ser futura' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (rawDueDate > deadline) {
      return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago supera la fecha limite' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const totalAmount = Number(booking.total_amount || 0);
    const threshold = booking.deposit_threshold || depositThreshold(totalAmount);
    const remaining = Math.max(totalAmount - Number(threshold || 0), 0);
    if (!remaining || remaining <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'No hay saldo pendiente' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const currency = booking.currency === 'COP' ? 'COP' : 'USD';
    const schedule = buildDepositSchedule({
      totalAmount: remaining,
      currency,
      dueDate: rawDueDate,
    });

    const provider = currency === 'COP' ? 'wompi' : 'stripe';
    const plan = await createPaymentPlan({
      bookingId,
      frequency: 'DEPOSIT',
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      totalAmount: remaining,
      currency,
      installmentCount: schedule.installmentCount,
      installmentAmount: schedule.installmentAmount,
      provider,
      autoDebit: false,
      installments: schedule.installments,
    });

    return new Response(JSON.stringify({ ok: true, planId: plan.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[cumbre.deposit] error', error);
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'cumbre.deposit',
      detail: error?.message || 'Deposit error',
    });
    return new Response(JSON.stringify({ ok: false, error: 'Error creando plan de segundo pago' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
