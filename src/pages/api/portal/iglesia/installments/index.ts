import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { listAccessibleChurchIds } from '@lib/portalScope';
import { restrictToPortalIglesiaBookings } from '@lib/portalBookingSource';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

const BOOKING_PAGE_SIZE = 1000;
const QUERY_CHUNK_SIZE = 200;
const MAX_SCOPED_BOOKINGS = 400;
const MAX_PENDING_INSTALLMENTS = 500;
const MAX_RESPONSE_INSTALLMENTS = 500;
const PENDING_INSTALLMENT_STATUSES = ['PENDING', 'FAILED'];
const APPROVED_PAYMENT_STATUSES = ['APPROVED', 'PAID'];

type ScopeContext = {
  isAdmin: boolean;
  requestedChurch: string | null;
  churchId: string | null;
  scopedChurchIds: string[];
};

type LimitedRows<T> = {
  rows: T[];
  truncated: boolean;
};

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildScopedBookingQuery(scope: ScopeContext) {
  let query = supabaseAdmin!
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency, source')
    .order('created_at', { ascending: false });

  if (scope.isAdmin) {
    if (scope.requestedChurch) query = query.eq('church_id', scope.requestedChurch);
  } else if (scope.churchId && scope.churchId.startsWith('IN:')) {
    const ids = scope.scopedChurchIds.length ? scope.scopedChurchIds : scope.churchId.substring(3).split(',');
    if (ids.length === 0) return null;
    query = query.in('church_id', ids);
  } else if (scope.churchId) {
    query = query.eq('church_id', scope.churchId);
  } else {
    return null;
  }

  return restrictToPortalIglesiaBookings(query);
}

async function loadScopedBookings(scope: ScopeContext): Promise<LimitedRows<any> | null> {
  const bookings: any[] = [];

  for (let page = 0; bookings.length < MAX_SCOPED_BOOKINGS; page += 1) {
    const query = buildScopedBookingQuery(scope);
    if (!query) return null;

    const from = page * BOOKING_PAGE_SIZE;
    if (from > MAX_SCOPED_BOOKINGS) break;

    const remaining = MAX_SCOPED_BOOKINGS - bookings.length;
    const to = Math.min(from + BOOKING_PAGE_SIZE - 1, MAX_SCOPED_BOOKINGS);
    const { data, error } = await query.range(from, to);

    if (error) {
      console.error('[portal.iglesia.installments] bookings error', error);
      throw new Error('No se pudo cargar');
    }

    const rows = data || [];
    bookings.push(...rows.slice(0, remaining));
    if (rows.length > remaining) {
      return { rows: bookings, truncated: true };
    }
    if (rows.length < to - from + 1) break;
  }

  return { rows: bookings, truncated: false };
}

async function loadPendingInstallments(bookingIds: string[]): Promise<LimitedRows<any>> {
  const rows: any[] = [];
  const chunks = chunkArray(bookingIds, QUERY_CHUNK_SIZE);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const remaining = MAX_PENDING_INSTALLMENTS - rows.length;
    if (remaining <= 0) {
      return { rows, truncated: true };
    }

    const { data, error } = await supabaseAdmin!
      .from('cumbre_installments')
      .select('id, booking_id, plan_id, installment_index, due_date, amount, currency, status, provider_reference, provider_tx_id, paid_at, created_at, booking:cumbre_bookings(id, contact_name, contact_email, contact_phone, contact_church, church_id, total_amount, total_paid, status, currency, source), plan:cumbre_payment_plans(id, status, provider, currency, installment_count, provider_payment_method_id, provider_subscription_id)')
      .in('booking_id', chunk)
      .in('status', PENDING_INSTALLMENT_STATUSES)
      .order('due_date', { ascending: true })
      .limit(remaining + 1);

    if (error) {
      console.error('[portal.iglesia.installments] list error', error);
      throw new Error('No se pudo cargar');
    }

    const chunkRows = data || [];
    rows.push(...chunkRows.slice(0, remaining));
    if (chunkRows.length > remaining || (rows.length >= MAX_PENDING_INSTALLMENTS && index < chunks.length - 1)) {
      return { rows, truncated: true };
    }
  }

  return { rows, truncated: false };
}

async function loadLatestPaymentProviderByBooking(bookingIds: string[]): Promise<Map<string, string>> {
  const providerByBooking = new Map<string, string>();

  for (const chunk of chunkArray(bookingIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabaseAdmin!
      .from('cumbre_payments')
      .select('booking_id, provider, created_at')
      .in('booking_id', chunk)
      .in('status', APPROVED_PAYMENT_STATUSES)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[portal.iglesia.installments] payment provider lookup error', error);
      continue;
    }

    (data || []).forEach((payment: any) => {
      const bookingId = String(payment.booking_id || '');
      const provider = String(payment.provider || '').trim().toLowerCase();
      if (!bookingId || providerByBooking.has(bookingId)) return;
      if (provider === 'stripe' || provider === 'wompi' || provider === 'manual') {
        providerByBooking.set(bookingId, provider);
      }
    });
  }

  return providerByBooking;
}

function resolveBalanceProvider(booking: any, providerByBooking: Map<string, string>): string {
  const provider = providerByBooking.get(String(booking.id || ''));
  if (provider) return provider;
  return booking.currency === 'USD' ? 'stripe' : 'wompi';
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a datos operativos');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), { status: denied.status });
  }

  const rateAllowed = await enforceRateLimit(
    `portal.iglesia.installments:${access.userId || access.email || clientAddress || 'unknown'}`,
    60,
    30,
  );
  if (!rateAllowed) {
    return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const isAdmin = access.isAdmin;
  let churchId: string | null = access.allowedChurchId;
  let scopedChurchIds: string[] = churchId ? [churchId] : [];
  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');

  if (!isAdmin && !churchId) {
    scopedChurchIds = await listAccessibleChurchIds(access);
    if (requestedChurch) {
      if (!scopedChurchIds.includes(requestedChurch)) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta sede' }), { status: 403 });
      }
      churchId = requestedChurch;
    } else {
      churchId = `IN:${scopedChurchIds.join(',')}`;
    }
  }

  let bookingResult: LimitedRows<any> | null = null;
  try {
    bookingResult = await loadScopedBookings({ isAdmin, requestedChurch, churchId, scopedChurchIds });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!bookingResult) {
    return new Response(JSON.stringify({ ok: true, installments: [] }), { status: 200 });
  }

  const bookings = bookingResult.rows;
  const eligibleBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });

  const bookingIds = eligibleBookings.map((b: any) => b.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, installments: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  let installmentResult: LimitedRows<any>;
  try {
    installmentResult = await loadPendingInstallments(bookingIds);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const installments = installmentResult.rows;
  const nextByPlan = new Map<string, any>();
  (installments || []).forEach((row: any) => {
    const planId = row.plan_id || row.plan?.id;
    if (!planId) return;
    if (row.plan?.status && row.plan.status !== 'ACTIVE') return;
    if (!nextByPlan.has(planId)) {
      nextByPlan.set(planId, row);
    }
  });

  const nextInstallments = Array.from(nextByPlan.values());
  const pendingBookingIds = new Set(nextInstallments.map((row: any) => row.booking_id || row.booking?.id).filter(Boolean));
  const remainingResponseSlots = Math.max(MAX_RESPONSE_INSTALLMENTS - nextInstallments.length, 0);
  const balanceCandidateBookings = installmentResult.truncated
    ? []
    : eligibleBookings
      .filter((booking: any) => {
        const totalAmount = Number(booking.total_amount || 0);
        const totalPaid = Number(booking.total_paid || 0);
        return totalAmount > totalPaid && !pendingBookingIds.has(booking.id);
      })
      .slice(0, remainingResponseSlots);
  const balanceCandidateBookingIds = balanceCandidateBookings.map((booking: any) => booking.id).filter(Boolean);
  const paymentProviderByBooking = await loadLatestPaymentProviderByBooking(balanceCandidateBookingIds);
  const balanceOnlyInstallments = balanceCandidateBookings
    .map((booking: any) => {
      const provider = resolveBalanceProvider(booking, paymentProviderByBooking);
      return {
        id: `balance-${booking.id}`,
        booking_id: booking.id,
        plan_id: null,
        installment_index: 1,
        due_date: null,
        amount: Math.max(Number(booking.total_amount || 0) - Number(booking.total_paid || 0), 0),
        currency: booking.currency,
        status: 'PENDING',
        provider_reference: booking.id,
        provider_tx_id: null,
        paid_at: null,
        created_at: null,
        booking,
        plan: {
          id: null,
          status: 'ACTIVE',
          provider,
          currency: booking.currency,
          installment_count: 1,
          provider_payment_method_id: null,
          provider_subscription_id: null,
        },
        is_balance_only: true,
      };
    });

  const installmentIds = nextInstallments.map((row: any) => row.id);
  const reminderMap: Record<string, any> = {};
  const linkMap: Record<string, any> = {};

  if (installmentIds.length) {
    const { data: reminders } = await supabaseAdmin
      .from('cumbre_installment_reminders')
      .select('installment_id, sent_at, reminder_key, channel, error')
      .in('installment_id', installmentIds)
      .order('sent_at', { ascending: false });

    (reminders || []).forEach((reminder: any) => {
      if (!reminderMap[reminder.installment_id]) {
        reminderMap[reminder.installment_id] = reminder;
      }
    });

    const { data: links } = await supabaseAdmin
      .from('cumbre_installment_links')
      .select('installment_id, created_at, expires_at, used_at')
      .in('installment_id', installmentIds)
      .order('created_at', { ascending: false });

    (links || []).forEach((link: any) => {
      if (!linkMap[link.installment_id]) {
        linkMap[link.installment_id] = link;
      }
    });
  }

  const fullResponse = [
    ...nextInstallments.map((row: any) => ({
      ...row,
      last_reminder: reminderMap[row.id] || null,
      last_link: linkMap[row.id] || null,
    })),
    ...balanceOnlyInstallments,
  ];
  const response = fullResponse.slice(0, MAX_RESPONSE_INSTALLMENTS);
  const truncated = bookingResult.truncated || installmentResult.truncated || fullResponse.length > response.length;

  return new Response(JSON.stringify({
    ok: true,
    installments: response,
    meta: {
      truncated,
      booking_limit: MAX_SCOPED_BOOKINGS,
      installment_limit: MAX_RESPONSE_INSTALLMENTS,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
