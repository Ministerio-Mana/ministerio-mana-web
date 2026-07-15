import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  canActorApproveEventPayments,
  canActorOperateEventPayments,
  getEventAccessContext,
} from '@lib/eventAccess';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizePlainText } from '@lib/validation';
import { selectPreferredEventPayments, summarizeEventPayments } from '@lib/eventPaymentReporting.js';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isEvidenceSchemaMissing(error: any) {
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''))
    || /event_payment_evidence/i.test(String(error?.message || ''));
}

function isPaymentTotalsFunctionMissing(error: any) {
  return ['42883', 'PGRST202'].includes(String(error?.code || ''))
    || /get_event_payment_totals_secure/i.test(String(error?.message || ''));
}

async function loadEvent(eventId: string) {
  if (!supabaseAdmin) return { data: null, error: new Error('Server Config Error') };
  return supabaseAdmin
    .from('events')
    .select('id, title, scope, church_id, region_id, country, start_date, end_date, timezone, status, capacity, currency')
    .eq('id', eventId)
    .maybeSingle();
}

async function loadEventFinanceTotals(eventId: string) {
  if (!supabaseAdmin) return { data: [], error: new Error('Server Config Error') };
  const totals = await supabaseAdmin.rpc('get_event_payment_totals_secure', { p_event_id: eventId });
  if (!totals.error) return totals;
  if (!isPaymentTotalsFunctionMissing(totals.error)) return totals;

  const payments: any[] = [];
  const pageSize = 1_000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const result = await supabaseAdmin
      .from('event_payments')
      .select('provider,currency,status,amount')
      .eq('event_id', eventId)
      .range(from, from + pageSize - 1);
    if (result.error) return { data: [], error: result.error };
    payments.push(...(result.data || []));
    if ((result.data || []).length < pageSize) break;
  }
  return { data: summarizeEventPayments(payments), error: null };
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
    .select('id, contact_name, contact_email, contact_phone, quantity, total_amount, currency, status, expires_at, created_at, confirmed_at, form_responses', { count: 'exact' })
    .eq('event_id', event.id);
  if (allowedStatuses.has(statusFilter)) registrationsQuery = registrationsQuery.eq('status', statusFilter);
  registrationsQuery = registrationsQuery
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const [registrationsResult, optionsResult, summaryResult, financeTotalsResult] = await Promise.all([
    registrationsQuery,
    supabaseAdmin
      .from('event_payment_options')
      .select('id, label, kind, provider, requires_evidence')
      .eq('event_id', event.id),
    supabaseAdmin.rpc('get_event_operation_summary_secure', { p_event_id: event.id }),
    loadEventFinanceTotals(event.id),
  ]);
  if (registrationsResult.error || optionsResult.error || summaryResult.error) {
    return json({ ok: false, error: 'No se pudo cargar la operación del evento.' }, 500);
  }
  if (financeTotalsResult.error && !isPaymentTotalsFunctionMissing(financeTotalsResult.error)) {
    console.error('[event.operation] payment totals failed', financeTotalsResult.error);
  }

  const registrationIds = (registrationsResult.data || []).map((row: any) => String(row.id));
  const [paymentsResult, checkinsResult, attendeesResult, payersResult] = registrationIds.length ? await Promise.all([
    supabaseAdmin
      .from('event_payments')
      .select('id, registration_id, payment_option_id, provider, reference, method, amount, currency, status, provider_payload, received_at, verified_at, verified_by, created_at')
      .in('registration_id', registrationIds)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('event_checkins')
      .select('registration_id, quantity, checked_in_at')
      .in('registration_id', registrationIds),
    supabaseAdmin
      .from('event_registration_attendees')
      .select('registration_id,position,full_name,age_group,gender')
      .in('registration_id', registrationIds)
      .order('position', { ascending: true }),
    supabaseAdmin
      .from('event_registration_payers')
      .select('registration_id,is_contact,person_type,document_type,document_last4,document_country,legal_name,billing_email,tax_document_requested')
      .in('registration_id', registrationIds),
  ]) : [
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ];
  if (paymentsResult.error || checkinsResult.error || attendeesResult.error || payersResult.error) {
    return json({ ok: false, error: 'No se pudo cargar la operación del evento.' }, 500);
  }

  const paymentIds = (paymentsResult.data || []).map((payment: any) => String(payment.id));
  const evidenceResult = paymentIds.length
    ? await supabaseAdmin
      .from('event_payment_evidence')
      .select('id,payment_id,original_filename,mime_type,size_bytes,status,created_at,reviewed_at')
      .in('payment_id', paymentIds)
      .is('deleted_at', null)
    : { data: [], error: null };
  if (evidenceResult.error && !isEvidenceSchemaMissing(evidenceResult.error)) {
    return json({ ok: false, error: 'No se pudieron cargar los comprobantes.' }, 500);
  }
  const evidenceByPayment = new Map(
    (evidenceResult.data || []).map((evidence: any) => [String(evidence.payment_id), evidence]),
  );

  const paymentsByRegistration = selectPreferredEventPayments(paymentsResult.data || []);
  const attendeesByRegistration = new Map<string, any[]>();
  for (const attendee of attendeesResult.data || []) {
    const registrationId = String((attendee as any).registration_id || '');
    attendeesByRegistration.set(registrationId, [
      ...(attendeesByRegistration.get(registrationId) || []),
      attendee,
    ]);
  }
  const payersByRegistration = new Map(
    (payersResult.data || []).map((payer: any) => [String(payer.registration_id), payer]),
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
    const evidence = payment?.id ? evidenceByPayment.get(String(payment.id)) as any : null;
    const payer = payersByRegistration.get(String(registration.id)) as any;
    return {
      ...registration,
      attendees: attendeesByRegistration.get(String(registration.id)) || [],
      payer: payer ? {
        is_contact: payer.is_contact,
        person_type: payer.person_type,
        document_type: payer.document_type,
        document_masked: payer.document_last4 ? `••••${payer.document_last4}` : '',
        document_country: payer.document_country,
        legal_name: payer.legal_name,
        billing_email: payer.billing_email,
        tax_document_requested: payer.tax_document_requested,
      } : null,
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
        is_manual: ['MANUAL', 'EXTERNAL'].includes(String(payment.provider || '').toUpperCase()),
        received_at: payment.received_at,
        verified_at: payment.verified_at,
        requires_evidence: Boolean(option?.requires_evidence),
        evidence: evidence ? {
          id: evidence.id,
          original_filename: evidence.original_filename,
          mime_type: evidence.mime_type,
          size_bytes: evidence.size_bytes,
          status: evidence.status,
          created_at: evidence.created_at,
          reviewed_at: evidence.reviewed_at,
          view_url: `/api/portal/event-payments/evidence?evidence_id=${encodeURIComponent(evidence.id)}`,
        } : null,
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
  const financeSummary = financeTotalsResult.error
    ? []
    : (financeTotalsResult.data || []).map((row: any) => ({
        provider: String(row.provider || '').toUpperCase(),
        currency: String(row.currency || '').toUpperCase(),
        payment_count: Number(row.payment_count || 0),
        approved_count: Number(row.approved_count || 0),
        approved_amount: Number(row.approved_amount || 0),
        pending_count: Number(row.pending_count || 0),
      }));

  return json({
    ok: true,
    event,
    registrations,
    summary,
    finance_summary: financeSummary,
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
      .select('id, event_id, payment_option_id, provider')
      .eq('id', paymentId)
      .maybeSingle();
    if (paymentLookup.error || !paymentLookup.data || paymentLookup.data.event_id !== event.id) {
      return json({ ok: false, error: 'Pago no encontrado en este evento.' }, 404);
    }
    if (!['MANUAL', 'EXTERNAL'].includes(String(paymentLookup.data.provider || '').toUpperCase())) {
      return json({ ok: false, error: 'Los pagos automáticos solo se actualizan mediante el proveedor firmado.' }, 409);
    }
    if (action === 'APPROVE' && paymentLookup.data.payment_option_id) {
      const [optionResult, evidenceResult] = await Promise.all([
        supabaseAdmin
          .from('event_payment_options')
          .select('requires_evidence')
          .eq('id', paymentLookup.data.payment_option_id)
          .eq('event_id', event.id)
          .maybeSingle(),
        supabaseAdmin
          .from('event_payment_evidence')
          .select('id,sharepoint_item_id')
          .eq('payment_id', paymentId)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle(),
      ]);
      if (optionResult.error) {
        return json({ ok: false, error: 'No se pudo validar el método de pago.' }, 500);
      }
      if (evidenceResult.error && !isEvidenceSchemaMissing(evidenceResult.error)) {
        return json({ ok: false, error: 'No se pudo validar el comprobante.' }, 500);
      }
      if (optionResult.data?.requires_evidence && evidenceResult.error) {
        return json({ ok: false, error: 'Falta activar el registro privado de comprobantes.' }, 409);
      }
      if (optionResult.data?.requires_evidence && !evidenceResult.data?.sharepoint_item_id) {
        return json({ ok: false, error: 'Este pago requiere un comprobante antes de aprobarse.' }, 409);
      }
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
    const evidenceStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { error: evidenceUpdateError } = await supabaseAdmin
      .from('event_payment_evidence')
      .update({
        status: evidenceStatus,
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
        review_note: note || null,
      })
      .eq('payment_id', paymentId)
      .eq('status', 'PENDING');
    if (evidenceUpdateError && !isEvidenceSchemaMissing(evidenceUpdateError)) {
      console.error('[event.manual-payment] evidence review update failed', evidenceUpdateError);
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
