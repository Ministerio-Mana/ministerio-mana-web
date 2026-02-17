import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function validateExport(request: Request): boolean {
  const secret = env('CUMBRE_ADMIN_EXPORT_SECRET');
  if (!secret) return !isProduction();
  const header = request.headers.get('x-export-secret');
  if (header && header === secret) return true;
  if (isProduction()) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return Boolean(token && token === secret);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[,\n\r"]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toString().trim();
}

function normalizeName(value: string | null | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function formatDietLabel(value: string | null | undefined): string {
  const raw = normalizeText(value).toUpperCase();
  if (!raw) return '';
  if (raw === 'GENERAL' || raw === 'TRADICIONAL') return 'TRADICIONAL';
  if (raw === 'KIDS' || raw === 'INFANTIL') return 'INFANTIL';
  if (raw === 'VEGETARIAN' || raw === 'VEGETARIANO') return 'VEGETARIANO';
  if (raw === 'SIN ALIMENTACION' || raw === 'SIN_ALIMENTACION') return 'SIN ALIMENTACION';
  return raw;
}

function formatLodgingLabel(value: string | null | undefined): string {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'lodging') return 'Con alojamiento';
  if (raw === 'no_lodging') return 'Sin alojamiento';
  if (raw === 'child_0_7') return 'Nino 0-4';
  if (raw === 'child_7_13') return 'Nino 5-10';
  return normalizeText(value);
}

function isResponsibleRelationship(value: string | null | undefined): boolean {
  const raw = normalizeName(value);
  return raw.includes('responsable');
}

function resolvePrimaryParticipantId(participants: any[], booking: any): string | undefined {
  if (!participants?.length) return undefined;
  const byRelationship = participants.find((p) => isResponsibleRelationship(p?.relationship));
  if (byRelationship?.id) return byRelationship.id;
  const bookingName = normalizeName(booking?.contact_name);
  if (bookingName) {
    const byName = participants.find((p) => normalizeName(p?.full_name) === bookingName);
    if (byName?.id) return byName.id;
  }
  return participants[0]?.id;
}

function resolveRegistrationType(booking: any): string {
  const method = String(booking?.payment_method || '').toLowerCase();
  const isManual =
    method === 'cash' ||
    method === 'manual' ||
    booking?.source === 'portal-iglesia';
  return isManual ? 'LOCAL' : 'ONLINE';
}

function resolveChurchFinal(booking: any): string {
  const catalog = normalizeText(booking?.church?.name);
  if (catalog) return catalog;
  const typed = normalizeText(booking?.contact_church);
  if (typed) return typed;
  return 'Ministerio Maná Virtual';
}

function buildUpcomingSummary(list: any[]): string {
  if (!list?.length) return '';
  return list
    .map((row) => {
      const date = row?.due_date || '';
      const amount = row?.amount != null ? row.amount : '';
      const currency = row?.currency || '';
      return `${date} ${amount} ${currency}`.trim();
    })
    .filter(Boolean)
    .join(' | ');
}

function normalizePaymentProviderLabel(value: string | null | undefined): string {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return '';
  if (raw === 'wompi') return 'WOMPI';
  if (raw === 'stripe') return 'STRIPE';
  if (raw === 'manual' || raw === 'physical' || raw === 'fisico') return 'MANUAL/FISICO';
  return raw.toUpperCase();
}

function resolvePaymentMeta(booking: any, payment: any, plan: any): { medio: string; pasarela: string; metodo: string } {
  const rawEvent = payment?.raw_event && typeof payment.raw_event === 'object' ? payment.raw_event : {};
  const provider = normalizePaymentProviderLabel(payment?.provider) || normalizePaymentProviderLabel(plan?.provider);
  const method = normalizeText(
    rawEvent?.payment_method
      || rawEvent?.payment_method_type
      || rawEvent?.method
      || rawEvent?.payment_method_types?.[0]
      || booking?.payment_method,
  );

  if (provider) {
    const normalizedMethod = method || (provider === 'MANUAL/FISICO' ? 'manual' : 'online');
    return {
      medio: provider,
      pasarela: provider,
      metodo: normalizedMethod,
    };
  }

  const bookingMethod = normalizeText(booking?.payment_method).toLowerCase();
  const registrationType = resolveRegistrationType(booking);
  if (bookingMethod === 'cash' || bookingMethod === 'manual' || registrationType === 'LOCAL') {
    return {
      medio: 'MANUAL/FISICO',
      pasarela: '',
      metodo: method || bookingMethod || 'manual',
    };
  }

  if (registrationType === 'ONLINE') {
    const currency = normalizeText(booking?.currency).toUpperCase();
    const inferredGateway = currency === 'COP' ? 'WOMPI' : currency === 'USD' ? 'STRIPE' : 'ONLINE';
    return {
      medio: inferredGateway,
      pasarela: inferredGateway,
      metodo: method || 'online',
    };
  }

  return {
    medio: method ? 'ONLINE' : 'SIN_PAGO',
    pasarela: '',
    metodo: method,
  };
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!validateExport(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'cumbre.admin.export.participants',
      detail: 'Export secret invalido',
    });
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'cumbre.admin.export.participants',
    allowlistKeys: ['CUMBRE_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const churchIdFilter = url.searchParams.get('churchId');
  const churchFilter = normalizeText(url.searchParams.get('church'));
  const typeFilter = (url.searchParams.get('type') || '').toString().trim().toUpperCase();
  const format = normalizeText(url.searchParams.get('format')).toLowerCase();

  const baseSelect = 'id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, source, status, total_amount, total_paid, currency, created_at';
  const extendedSelect = `${baseSelect}, payment_method`;

  let churchNameFromId = '';
  if (churchIdFilter) {
    const { data: church } = await supabaseAdmin
      .from('churches')
      .select('name')
      .eq('id', churchIdFilter)
      .maybeSingle();
    churchNameFromId = normalizeText(church?.name);
  }

  let { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select(`${extendedSelect}, church:churches(id, name)`)
    .order('created_at', { ascending: false });

  if (bookingsError && bookingsError.code === '42703') {
    const fallback = await supabaseAdmin
      .from('cumbre_bookings')
      .select(`${baseSelect}, church:churches(id, name)`)
      .order('created_at', { ascending: false });
    bookings = fallback.data;
    bookingsError = fallback.error;
  }

  if (bookingsError) {
    console.error('[cumbre.admin.export.participants] booking error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar reservas' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const enrolledBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });

  const normalizedChurchFilter = normalizeName(churchFilter || churchNameFromId);
  const filteredBookings = enrolledBookings.filter((booking: any) => {
    if (!normalizedChurchFilter && !churchIdFilter && !typeFilter) return true;

    const registrationType = resolveRegistrationType(booking);
    if (typeFilter && registrationType !== typeFilter) return false;

    if (churchIdFilter && booking?.church_id === churchIdFilter) return true;
    if (!normalizedChurchFilter) return false;

    const finalChurch = normalizeName(resolveChurchFinal(booking));
    const catalogChurch = normalizeName(booking?.church?.name);
    const typedChurch = normalizeName(booking?.contact_church);
    return finalChurch === normalizedChurchFilter
      || catalogChurch === normalizedChurchFilter
      || typedChurch === normalizedChurchFilter;
  });

  const bookingIds = filteredBookings.map((row: any) => row.id);
  if (!bookingIds.length) {
    if (format === 'json') {
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return new Response('', {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    });
  }

  const { data: participants } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, relationship, birthdate, gender, nationality, document_type, document_number, diet_type, package_type, email')
    .in('booking_id', bookingIds);

  let paymentQuery = supabaseAdmin
    .from('cumbre_payments')
    .select('id, booking_id, provider, amount, currency, status, raw_event, created_at')
    .in('booking_id', bookingIds)
    .eq('status', 'APPROVED')
    .order('created_at', { ascending: false });
  if (from) paymentQuery = paymentQuery.gte('created_at', from);
  if (to) paymentQuery = paymentQuery.lte('created_at', to);
  const { data: payments } = await paymentQuery;

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, due_date, amount, currency, status')
    .in('booking_id', bookingIds)
    .in('status', ['PENDING', 'FAILED'])
    .order('due_date', { ascending: true });

  const { data: plans } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('id, booking_id, provider, next_due_date, installment_amount, currency')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  const bookingMap = new Map<string, any>();
  for (const booking of filteredBookings || []) {
    bookingMap.set(booking.id, booking);
  }

  const participantsByBooking = new Map<string, any[]>();
  for (const participant of participants || []) {
    const list = participantsByBooking.get(participant.booking_id) ?? [];
    list.push(participant);
    participantsByBooking.set(participant.booking_id, list);
  }

  const paymentsByBooking = new Map<string, any[]>();
  for (const payment of payments || []) {
    const list = paymentsByBooking.get(payment.booking_id) ?? [];
    list.push(payment);
    paymentsByBooking.set(payment.booking_id, list);
  }

  const installmentsByBooking = new Map<string, any[]>();
  for (const installment of installments || []) {
    const list = installmentsByBooking.get(installment.booking_id) ?? [];
    list.push(installment);
    installmentsByBooking.set(installment.booking_id, list);
  }

  const plansByBooking = new Map<string, any>();
  for (const plan of plans || []) {
    if (!plansByBooking.has(plan.booking_id)) {
      plansByBooking.set(plan.booking_id, plan);
    }
  }

  const headers = [
    'participante_nombre',
    'titular_reserva',
    'grupo_familiar',
    'reserva_tipo',
    'responsable_grupo',
    'documento_tipo',
    'documento_numero',
    'fecha_nacimiento',
    'sexo',
    'pais_origen',
    'telefono',
    'email',
    'alimentacion',
    'tipo_alojamiento',
    'iglesia_final',
    'iglesia_catalogo',
    'iglesia_escrita',
    'tipo_registro',
    'medio_pago',
    'pasarela_pago',
    'metodo_pago',
    'valor_pagado_total',
    'valor_pagado_prorrateado',
    'fecha_ultimo_pago',
    'proximo_pago_fecha',
    'proximo_pago_monto',
    'proximo_pago_moneda',
    'cuotas_pendientes',
    'proximos_pagos',
  ];

  const records: Array<Record<string, unknown>> = [];

  for (const [bookingId, list] of participantsByBooking) {
    const booking = bookingMap.get(bookingId);
    if (!booking) continue;

    const participantCount = list.length || 0;
    const primaryId = resolvePrimaryParticipantId(list, booking);
    const primaryParticipant = list.find((p) => p.id === primaryId);
    const responsable = primaryParticipant?.full_name || booking?.contact_name || '';
    const reservaTipo = participantCount > 1 ? 'GRUPO' : 'INDIVIDUAL';
    const grupoFamiliar = bookingId ? String(bookingId).slice(0, 8).toUpperCase() : '';

    const totalPaid = Number(booking.total_paid || 0);
    const perParticipant = participantCount ? totalPaid / participantCount : totalPaid;

    const paymentRows = paymentsByBooking.get(bookingId) ?? [];
    const lastPayment = paymentRows.length ? paymentRows[0] : null;
    const plan = plansByBooking.get(bookingId);
    const paymentMeta = resolvePaymentMeta(booking, lastPayment, plan);

    const pendingInstallments = installmentsByBooking.get(bookingId) ?? [];
    const nextInstallment = pendingInstallments.find((item) => item.due_date) || pendingInstallments[0];
    const nextDueDate = nextInstallment?.due_date || plan?.next_due_date || '';
    const nextAmount = nextInstallment?.amount ?? plan?.installment_amount ?? '';
    const nextCurrency = nextInstallment?.currency ?? plan?.currency ?? booking?.currency ?? '';
    const pendingCount = pendingInstallments.length;
    const upcomingSummary = buildUpcomingSummary(pendingInstallments);

    const churchName = booking?.church?.name || '';
    const churchInput = booking?.contact_church || '';
    const iglesiaFinal = resolveChurchFinal(booking);

    for (const participant of list) {
      const docType = participant.document_type || booking?.contact_document_type || '';
      const docNumber = participant.document_number || booking?.contact_document_number || '';
      const birthdate = participant.birthdate || '';
      const gender = participant.gender || '';
      const nationality = participant.nationality || booking?.contact_country || '';
      const diet = formatDietLabel(participant.diet_type);
      const lodging = formatLodgingLabel(participant.package_type);

      records.push({
        participante_nombre: participant.full_name ?? '',
        titular_reserva: booking?.contact_name ?? '',
        grupo_familiar: grupoFamiliar,
        reserva_tipo: reservaTipo,
        responsable_grupo: responsable,
        documento_tipo: docType,
        documento_numero: docNumber,
        fecha_nacimiento: birthdate,
        sexo: gender,
        pais_origen: nationality,
        telefono: booking?.contact_phone ?? '',
        email: participant.email ?? booking?.contact_email ?? '',
        alimentacion: diet,
        tipo_alojamiento: lodging,
        iglesia_final: iglesiaFinal,
        iglesia_catalogo: churchName,
        iglesia_escrita: churchInput,
        tipo_registro: resolveRegistrationType(booking),
        medio_pago: paymentMeta.medio,
        pasarela_pago: paymentMeta.pasarela,
        metodo_pago: paymentMeta.metodo,
        valor_pagado_total: totalPaid,
        valor_pagado_prorrateado: perParticipant,
        fecha_ultimo_pago: lastPayment?.created_at || '',
        proximo_pago_fecha: nextDueDate,
        proximo_pago_monto: nextAmount,
        proximo_pago_moneda: nextCurrency,
        cuotas_pendientes: pendingCount,
        proximos_pagos: upcomingSummary,
      });
    }
  }

  if (format === 'json') {
    return new Response(JSON.stringify(records), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const csv = [
    headers.join(','),
    ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(',')),
  ].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="cumbre-participantes.csv"',
    },
  });
};
