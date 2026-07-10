import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  canActorApproveEventPayments,
  canActorOperateEventPayments,
  getEventAccessContext,
} from '@lib/eventAccess';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizePlainText } from '@lib/validation';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function loadEvent(eventId: string) {
  if (!supabaseAdmin) return { data: null, error: new Error('Server Config Error') };
  return supabaseAdmin
    .from('events')
    .select('id, title, scope, church_id, region_id, country, start_date, end_date, timezone, status, capacity, currency')
    .eq('id', eventId)
    .maybeSingle();
}

function canCheckIn(ctx: Awaited<ReturnType<typeof getEventAccessContext>>) {
  return ctx.ok && !ctx.isPasswordSession
    && (ctx.isAdmin || ctx.capabilities.can_register_people || ctx.role === 'finance');
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);

  const eventId = String(url.searchParams.get('event_id') || '').trim();
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos para operar este evento.' }, 403);
  }

  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get('page') || 1) || 1));
  const pageSize = 50;
  const statusFilter = String(url.searchParams.get('status') || '').trim().toUpperCase();
  const allowedStatuses = new Set(['UNDER_REVIEW', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'PENDING_PAYMENT']);
  let registrationsQuery = supabaseAdmin
    .from('event_registrations')
    .select('id, contact_name, contact_email, contact_phone, quantity, total_amount, currency, status, expires_at, created_at, confirmed_at', { count: 'exact' })
    .eq('event_id', event.id);
  if (allowedStatuses.has(statusFilter)) registrationsQuery = registrationsQuery.eq('status', statusFilter);
  registrationsQuery = registrationsQuery
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const [registrationsResult, optionsResult, summaryResult] = await Promise.all([
    registrationsQuery,
    supabaseAdmin
      .from('event_payment_options')
      .select('id, label, kind, provider')
      .eq('event_id', event.id),
    supabaseAdmin.rpc('get_event_operation_summary_secure', { p_event_id: event.id }),
  ]);
  if (registrationsResult.error || optionsResult.error || summaryResult.error) {
    return json({ ok: false, error: 'No se pudo cargar la operación del evento.' }, 500);
  }

  const registrationIds = (registrationsResult.data || []).map((row: any) => String(row.id));
  const [paymentsResult, checkinsResult] = registrationIds.length ? await Promise.all([
    supabaseAdmin
      .from('event_payments')
      .select('id, registration_id, payment_option_id, provider, reference, method, amount, currency, status, provider_payload, received_at, verified_at, verified_by, created_at')
      .in('registration_id', registrationIds)
      .in('provider', ['MANUAL', 'EXTERNAL'])
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('event_checkins')
      .select('registration_id, quantity, checked_in_at')
      .in('registration_id', registrationIds),
  ]) : [
    { data: [], error: null },
    { data: [], error: null },
  ];
  if (paymentsResult.error || checkinsResult.error) {
    return json({ ok: false, error: 'No se pudo cargar la operación del evento.' }, 500);
  }

  const paymentsByRegistration = new Map(
    (paymentsResult.data || []).map((payment: any) => [String(payment.registration_id), payment]),
  );
  const checkedByRegistration = new Map<string, number>();
  for (const checkin of checkinsResult.data || []) {
    const registrationId = String((checkin as any).registration_id || '');
    checkedByRegistration.set(
      registrationId,
      (checkedByRegistration.get(registrationId) || 0) + Number((checkin as any).quantity || 0),
    );
  }
  const optionsById = new Map((optionsResult.data || []).map((option: any) => [String(option.id), option]));
  const registrations = (registrationsResult.data || []).map((registration: any) => {
    const payment = paymentsByRegistration.get(String(registration.id)) as any;
    const option = payment?.payment_option_id ? optionsById.get(String(payment.payment_option_id)) as any : null;
    return {
      ...registration,
      checked_in_quantity: checkedByRegistration.get(String(registration.id)) || 0,
      payment: payment ? {
        id: payment.id,
        provider: payment.provider,
        reference: payment.reference,
        reported_reference: String(payment.provider_payload?.reported_reference || ''),
        method: payment.method,
        method_label: option?.label || payment.method,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        received_at: payment.received_at,
        verified_at: payment.verified_at,
      } : null,
    };
  });
  const summaryRow: any = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
  const summary = {
    registrations: Number(summaryRow?.registrations_count || 0),
    total: Number(summaryRow?.attendees_count || 0),
    under_review: Number(summaryRow?.under_review_count || 0),
    confirmed: Number(summaryRow?.confirmed_count || 0),
    checked_in: Number(summaryRow?.checked_in_count || 0),
  };

  return json({
    ok: true,
    event,
    registrations,
    summary,
    pagination: {
      page,
      page_size: pageSize,
      total: Number(registrationsResult.count || 0),
      pages: Math.max(1, Math.ceil(Number(registrationsResult.count || 0) / pageSize)),
    },
    permissions: {
      can_approve: canActorApproveEventPayments(ctx),
      can_check_in: canCheckIn(ctx),
    },
  });
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }
  const allowed = await enforceRateLimit(`event-manual-review:${ctx.userId}`, 60, 60, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas operaciones. Intenta más tarde.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > 3_000) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const action = String(body.action || '').trim().toUpperCase();
  const eventId = String(body.event_id || '').trim();
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos para operar este evento.' }, 403);
  }

  if (action === 'APPROVE' || action === 'DECLINE') {
    if (!canActorApproveEventPayments(ctx)) {
      return json({ ok: false, error: 'No tienes permiso para aprobar pagos.' }, 403);
    }
    const paymentId = String(body.payment_id || '').trim();
    if (!UUID_PATTERN.test(paymentId)) return json({ ok: false, error: 'Pago inválido.' }, 400);
    const paymentLookup = await supabaseAdmin
      .from('event_payments')
      .select('id, event_id')
      .eq('id', paymentId)
      .maybeSingle();
    if (paymentLookup.error || !paymentLookup.data || paymentLookup.data.event_id !== event.id) {
      return json({ ok: false, error: 'Pago no encontrado en este evento.' }, 404);
    }
    const note = sanitizePlainText(String(body.note || ''), 500);
    const result = await supabaseAdmin.rpc('review_event_manual_payment_secure', {
      p_payment_id: paymentId,
      p_actor_user_id: ctx.userId,
      p_action: action,
      p_note: note || null,
    });
    if (result.error) {
      const unavailable = result.error.message?.includes('review_event_manual_payment_secure');
      return json({ ok: false, error: unavailable ? 'La revisión manual todavía no está activada.' : 'No se pudo revisar el pago.' }, unavailable ? 503 : 409);
    }
    return json({ ok: true, result: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  if (action === 'CHECK_IN') {
    if (!canCheckIn(ctx)) return json({ ok: false, error: 'No tienes permiso para registrar asistencia.' }, 403);
    const registrationId = String(body.registration_id || '').trim();
    const quantity = Number(body.quantity || 1);
    if (!UUID_PATTERN.test(registrationId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return json({ ok: false, error: 'Asistencia inválida.' }, 400);
    }
    const registrationLookup = await supabaseAdmin
      .from('event_registrations')
      .select('id, event_id')
      .eq('id', registrationId)
      .maybeSingle();
    if (registrationLookup.error || !registrationLookup.data || registrationLookup.data.event_id !== event.id) {
      return json({ ok: false, error: 'Inscripción no encontrada en este evento.' }, 404);
    }
    const notes = sanitizePlainText(String(body.note || ''), 300);
    const result = await supabaseAdmin.rpc('record_event_checkin_secure', {
      p_registration_id: registrationId,
      p_actor_user_id: ctx.userId,
      p_quantity: quantity,
      p_notes: notes || null,
    });
    if (result.error) {
      const unavailable = result.error.message?.includes('record_event_checkin_secure');
      return json({ ok: false, error: unavailable ? 'El registro de asistencia todavía no está activado.' : 'No se pudo registrar la asistencia.' }, unavailable ? 503 : 409);
    }
    return json({ ok: true, result: Array.isArray(result.data) ? result.data[0] : result.data });
  }

  return json({ ok: false, error: 'Acción inválida.' }, 400);
};
