import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

const ACTIONS = new Set(['pause', 'resume', 'cancel', 'reschedule']);

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidCalendarDate(value: string): boolean {
  if (!isDateOnly(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeEmail(email: string | null | undefined) {
  return (email || '').trim().toLowerCase();
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
  }

  const user = await getUserFromRequest(request);
  const passwordSession = user ? null : readPasswordSession(request);
  if (!user && !passwordSession) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }
  if (passwordSession || !user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Esta operación requiere una cuenta individual' }), { status: 403 });
  }

  let body: { id?: string; action?: string; nextReminderDate?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), { status: 400 });
  }

  const subscriptionId = body.id?.toString().trim();
  const action = body.action?.toString().trim().toLowerCase();
  if (!subscriptionId || !action || !ACTIONS.has(action)) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { status: 400 });
  }

  const nextReminderDate = (body.nextReminderDate || '').toString().trim();
  if (action === 'reschedule' && !isValidCalendarDate(nextReminderDate)) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid date format. Use YYYY-MM-DD' }), { status: 400 });
  }

  const sessionEmail = normalizeEmail(user.email);
  if (!sessionEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'Email missing' }), { status: 400 });
  }

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('donation_reminder_subscriptions')
    .select('id, donor_email, status, next_reminder_date, start_date, end_date')
    .eq('id', subscriptionId)
    .single();

  if (subError || !subscription) {
    return new Response(JSON.stringify({ ok: false, error: 'Subscription not found' }), { status: 404 });
  }

  const donorEmail = normalizeEmail(subscription.donor_email);
  if (!donorEmail || donorEmail !== sessionEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const status = (subscription.status || 'ACTIVE').toString().toUpperCase();
  let nextStatus = status;
  let nextDate = subscription.next_reminder_date || null;

  if (action === 'pause') nextStatus = 'PAUSED';
  if (action === 'resume') nextStatus = 'ACTIVE';
  if (action === 'cancel') nextStatus = 'CANCELLED';

  if (action === 'reschedule') {
    if (['CANCELLED', 'ENDED', 'DISABLED'].includes(status)) {
      return new Response(JSON.stringify({ ok: false, error: 'Subscription is not active' }), { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (nextReminderDate < today) {
      return new Response(JSON.stringify({ ok: false, error: 'Date cannot be in the past' }), { status: 400 });
    }
    const startDate = isValidCalendarDate((subscription.start_date || '').toString())
      ? subscription.start_date.toString()
      : null;
    const endDate = isValidCalendarDate((subscription.end_date || '').toString())
      ? subscription.end_date.toString()
      : null;
    if (startDate && nextReminderDate < startDate) {
      return new Response(JSON.stringify({ ok: false, error: `Date cannot be before ${startDate}` }), { status: 400 });
    }
    if (endDate && nextReminderDate > endDate) {
      return new Response(JSON.stringify({ ok: false, error: `Date cannot be after ${endDate}` }), { status: 400 });
    }
    nextDate = nextReminderDate;
  }

  if (nextStatus === status && nextDate === subscription.next_reminder_date) {
    return new Response(JSON.stringify({ ok: true, subscription }), { status: 200 });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('donation_reminder_subscriptions')
    .update({
      status: nextStatus,
      next_reminder_date: nextDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
    .select('id, status, next_reminder_date')
    .single();

  if (updateError || !updated) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, subscription: updated }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
