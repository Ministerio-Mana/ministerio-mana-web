import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';

export const prerender = false;

type ExportRecord = Record<string, unknown>;

type ExportOptions = {
  from?: string | null;
  to?: string | null;
  typeFilter?: string | null;
};

const TEXT_COLUMNS = new Set(['documento_numero', 'telefono', 'grupo_familiar']);
const NUMERIC_COLUMNS = new Set([
  'valor_pagado_total',
  'valor_pagado_prorrateado',
  'proximo_pago_monto',
  'cuotas_pendientes',
]);

const HEADER_LABELS: Record<string, string> = {
  participante_nombre: 'participante_nombre',
  titular_reserva: 'titular_reserva',
  grupo_familiar: 'grupo_familiar',
  reserva_tipo: 'reserva_tipo',
  responsable_grupo: 'responsable_grupo',
  documento_tipo: 'documento_tipo',
  documento_numero: 'documento_numero',
  fecha_nacimiento: 'fecha_nacimiento',
  sexo: 'sexo',
  pais_origen: 'pais_origen',
  telefono: 'telefono',
  email: 'email',
  alimentacion: 'alimentacion',
  tipo_alojamiento: 'tipo_alojamiento',
  iglesia_final: 'iglesia_final',
  iglesia_catalogo: 'iglesia_catalogo',
  iglesia_escrita: 'iglesia_escrita',
  tipo_registro: 'tipo_registro',
  valor_pagado_total: 'valor_pagado_total',
  valor_pagado_prorrateado: 'valor_pagado_prorrateado',
  fecha_ultimo_pago: 'fecha_ultimo_pago',
  proximo_pago_fecha: 'proximo_pago_fecha',
  proximo_pago_monto: 'proximo_pago_monto',
  proximo_pago_moneda: 'proximo_pago_moneda',
  cuotas_pendientes: 'cuotas_pendientes',
  proximos_pagos: 'proximos_pagos',
};

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
  return 'Ministerio Mana Virtual';
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

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function sanitizeSheetName(value: string): string {
  const cleaned = value
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 31) || 'participantes';
}

function normalizeCellValue(value: unknown, header: string): string | number {
  if (TEXT_COLUMNS.has(header)) {
    if (value === null || value === undefined) return '';
    return String(value);
  }
  if (NUMERIC_COLUMNS.has(header)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : '';
  }
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

async function buildWorkbook(records: ExportRecord[], headers: string[], sheetName: string): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ministerio Mana';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.columns = headers.map((header) => ({
    header: HEADER_LABELS[header] || header,
    key: header,
    width: Math.max(12, (HEADER_LABELS[header] || header).length + 2),
  }));

  for (const record of records) {
    const rowValues = headers.map((header) => normalizeCellValue(record[header], header));
    worksheet.addRow(rowValues);
  }

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3C88' } };
  headerRow.eachCell((cell) => {
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    if (rowIndex % 2 === 0) {
      const row = worksheet.getRow(rowIndex);
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  }

  worksheet.columns.forEach((column) => {
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value;
      const cellText = cellValue === null || cellValue === undefined ? '' : String(cellValue);
      if (cellText.length > maxLength) maxLength = cellText.length;
    });
    column.width = Math.min(50, Math.max(12, maxLength + 2));
  });

  return workbook.xlsx.writeBuffer();
}

async function loadExportRecords(targetChurch: string, options: ExportOptions) {
  const baseSelect = 'id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, source, status, total_amount, total_paid, currency, created_at';
  const extendedSelect = `${baseSelect}, payment_method`;

  let { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select(`${extendedSelect}, church:churches(id, name)`)
    .eq('church_id', targetChurch)
    .order('created_at', { ascending: false });

  if (bookingsError && bookingsError.code === '42703') {
    const fallback = await supabaseAdmin
      .from('cumbre_bookings')
      .select(`${baseSelect}, church:churches(id, name)`)
      .eq('church_id', targetChurch)
      .order('created_at', { ascending: false });
    bookings = fallback.data;
    bookingsError = fallback.error;
  }

  if (bookingsError) {
    console.error('[portal.iglesia.export.participants] booking error', bookingsError);
    throw new Error('No se pudo cargar reservas');
  }

  const enrolledBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });

  const typeFilter = options.typeFilter ? options.typeFilter.toUpperCase() : '';
  const filteredBookings = typeFilter
    ? enrolledBookings.filter((booking: any) => resolveRegistrationType(booking) === typeFilter)
    : enrolledBookings;

  const bookingIds = filteredBookings.map((row: any) => row.id);
  if (!bookingIds.length) return { records: [], headers: [] };

  const { data: participants } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, relationship, birthdate, gender, nationality, document_type, document_number, diet_type, package_type, email')
    .in('booking_id', bookingIds);

  let paymentQuery = supabaseAdmin
    .from('cumbre_payments')
    .select('id, booking_id, amount, currency, status, created_at')
    .in('booking_id', bookingIds)
    .eq('status', 'APPROVED')
    .order('created_at', { ascending: false });
  if (options.from) paymentQuery = paymentQuery.gte('created_at', options.from);
  if (options.to) paymentQuery = paymentQuery.lte('created_at', options.to);
  const { data: payments } = await paymentQuery;

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, due_date, amount, currency, status')
    .in('booking_id', bookingIds)
    .in('status', ['PENDING', 'FAILED'])
    .order('due_date', { ascending: true });

  const { data: plans } = await supabaseAdmin
    .from('cumbre_payment_plans')
    .select('id, booking_id, next_due_date, installment_amount, currency')
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
    'valor_pagado_total',
    'valor_pagado_prorrateado',
    'fecha_ultimo_pago',
    'proximo_pago_fecha',
    'proximo_pago_monto',
    'proximo_pago_moneda',
    'cuotas_pendientes',
    'proximos_pagos',
  ];

  const records: ExportRecord[] = [];

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

    const pendingInstallments = installmentsByBooking.get(bookingId) ?? [];
    const nextInstallment = pendingInstallments.find((item) => item.due_date) || pendingInstallments[0];
    const plan = plansByBooking.get(bookingId);
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

  return { headers, records };
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request);
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a exportación');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  const profileChurch = access.profile?.portal_church_id || access.profile?.church_id || null;
  let targetChurch = access.isAdmin ? (requestedChurch || profileChurch) : access.allowedChurchId;
  const requiresScopedChurchSelection = !access.isAdmin && !access.allowedChurchId;
  if (requiresScopedChurchSelection) {
    if (!requestedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const isAllowedChurch = await isChurchAllowedForAccess(requestedChurch, access);
    if (!isAllowedChurch) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    targetChurch = requestedChurch;
  }

  if (!targetChurch) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const rawFormat = normalizeText(url.searchParams.get('format'));
  const format = rawFormat ? rawFormat.toLowerCase() : 'xlsx';
  const options: ExportOptions = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    typeFilter: url.searchParams.get('type'),
  };

  const { data: churchInfo, error: churchError } = await supabaseAdmin
    .from('churches')
    .select('id, name')
    .eq('id', targetChurch)
    .maybeSingle();
  if (churchError) {
    console.error('[portal.iglesia.export.participants] church error', churchError);
  }

  let exportData: { headers: string[]; records: ExportRecord[] };
  try {
    exportData = await loadExportRecords(targetChurch, options);
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo exportar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { headers, records } = exportData;
  if (!records.length) {
    if (format === 'json') {
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (format === 'csv') {
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'text/csv; charset=utf-8' },
      });
    }
    const emptyWorkbook = await buildWorkbook([], headers.length ? headers : Object.keys(HEADER_LABELS), 'participantes');
    return new Response(emptyWorkbook, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="cumbre-participantes.xlsx"',
      },
    });
  }

  if (format === 'json') {
    return new Response(JSON.stringify(records), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  if (format === 'csv') {
    const csv = [
      headers.join(','),
      ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(',')),
    ].join('\n');

    const csvName = churchInfo?.name
      ? `cumbre-participantes-${slugify(churchInfo.name)}.csv`
      : 'cumbre-participantes.csv';

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvName}"`,
      },
    });
  }

  const workbook = await buildWorkbook(records, headers, 'participantes');
  const xlsxName = churchInfo?.name
    ? `cumbre-participantes-${slugify(churchInfo.name)}.xlsx`
    : 'cumbre-participantes.xlsx';

  return new Response(workbook, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${xlsxName}"`,
    },
  });
};
