import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { isMicrosoftEventsWriteEnabled, uploadMicrosoftEventDocument } from '@lib/microsoftGraph';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MIRROR_BYTES = 4 * 1024 * 1024;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
  });
}

function slugify(value: string) {
  return String(value || 'evento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'evento';
}

function buildEventFolder(event: { id: string; title?: string | null; slug?: string | null }) {
  return `${slugify(String(event.slug || event.title || 'evento'))}-${event.id.slice(0, 8)}`;
}

function isDocumentsSchemaMissing(error: any) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

async function mirrorExportToOneDrive(params: {
  event: { id: string; title?: string | null; slug?: string | null };
  actorUserId: string;
  content: Uint8Array;
}) {
  if (!supabaseAdmin || !isMicrosoftEventsWriteEnabled() || params.content.byteLength > MAX_MIRROR_BYTES) return null;
  const storedName = 'inscripciones.xlsx';
  const originalName = 'Inscripciones.xlsx';
  const existing = await supabaseAdmin
    .from('event_documents')
    .select('id')
    .eq('event_id', params.event.id)
    .eq('stored_name', storedName)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    if (!isDocumentsSchemaMissing(existing.error)) console.error('[event.export] document lookup failed', existing.error);
    return null;
  }

  try {
    const uploaded = await uploadMicrosoftEventDocument({
      eventFolder: buildEventFolder(params.event),
      fileName: storedName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: params.content,
    });
    const record = {
      status: 'READY',
      original_name: originalName,
      stored_name: storedName,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: params.content.byteLength,
      sharepoint_drive_id: uploaded.drive.id,
      sharepoint_item_id: uploaded.item.id,
      sharepoint_web_url: uploaded.item.webUrl,
      sharepoint_etag: uploaded.item.eTag,
      error_code: null,
      updated_at: new Date().toISOString(),
    };
    const write = existing.data?.id
      ? await supabaseAdmin.from('event_documents').update(record).eq('id', existing.data.id)
      : await supabaseAdmin.from('event_documents').insert({ ...record, event_id: params.event.id, uploaded_by: params.actorUserId });
    if (write.error) {
      console.error('[event.export] document registration failed', write.error);
      return null;
    }
    return uploaded.item.webUrl;
  } catch (error) {
    console.error('[event.export] OneDrive mirror failed', error);
    return null;
  }
}

function safeCell(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function formatDate(value: unknown) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(date);
}

function readCustomFields(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  const fields = source.custom_fields && typeof source.custom_fields === 'object' && !Array.isArray(source.custom_fields)
    ? source.custom_fields as Record<string, any>
    : {};
  return Object.entries(fields)
    .map(([id, field]) => ({
      id,
      label: String(field?.label || id).trim().slice(0, 120),
      value: Array.isArray(field?.value) ? field.value.join(' · ') : field?.value,
    }))
    .filter((field) => field.label);
}

async function loadAllRegistrations(eventId: string) {
  if (!supabaseAdmin) return { data: [], error: new Error('Server Config Error') };
  const rows: any[] = [];
  const pageSize = 1_000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const result = await supabaseAdmin
      .from('event_registrations')
      .select('id,contact_name,contact_email,contact_phone,quantity,total_amount,currency,status,created_at,confirmed_at,form_responses')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (result.error) return { data: [], error: result.error };
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) break;
  }
  return { data: rows, error: null };
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error || 'No autorizado.' }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'La exportación requiere una cuenta individual.' }, 403);
  }
  const allowed = await enforceRateLimit(`event-export:${ctx.userId}`, 300, 12, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas exportaciones. Intenta más tarde.' }, 429);

  const eventId = String(url.searchParams.get('event_id') || '').trim();
  if (!UUID_PATTERN.test(eventId)) return json({ ok: false, error: 'Evento inválido.' }, 400);
  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id,title,slug,scope,church_id,region_id,country')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event?.id) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permiso para exportar este evento.' }, 403);
  }

  const registrationsResult = await loadAllRegistrations(event.id);
  if (registrationsResult.error) return json({ ok: false, error: 'No se pudieron consultar las inscripciones.' }, 500);

  const customColumns = new Map<string, string>();
  for (const registration of registrationsResult.data) {
    for (const field of readCustomFields(registration.form_responses)) {
      if (!customColumns.has(field.id)) customColumns.set(field.id, field.label);
    }
  }
  const columns = [
    ['contact_name', 'Nombre completo'],
    ['contact_email', 'Correo'],
    ['contact_phone', 'WhatsApp o teléfono'],
    ['church', 'Iglesia o congregación'],
    ['whatsapp_updates', 'Autoriza recordatorios WhatsApp'],
    ['quantity', 'Asistentes'],
    ['status', 'Estado'],
    ['total_amount', 'Total'],
    ['currency', 'Moneda'],
    ['created_at', 'Fecha de inscripción'],
    ['confirmed_at', 'Fecha de confirmación'],
    ...[...customColumns.entries()].map(([id, label]) => [`custom_${id}`, label]),
  ] as Array<[string, string]>;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ministerio Maná';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Inscripciones');
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns = columns.map(([key, header]) => ({ key, header, width: Math.max(14, Math.min(42, header.length + 5)) }));

  for (const registration of registrationsResult.data) {
    const answers = registration.form_responses && typeof registration.form_responses === 'object'
      ? registration.form_responses as Record<string, any>
      : {};
    const customAnswers = new Map(readCustomFields(answers).map((field) => [field.id, field.value]));
    const row: Record<string, string | number> = {
      contact_name: safeCell(registration.contact_name),
      contact_email: safeCell(registration.contact_email),
      contact_phone: safeCell(registration.contact_phone),
      church: safeCell(answers.church),
      whatsapp_updates: answers.whatsapp_updates === true ? 'Sí' : answers.whatsapp_updates === false ? 'No' : '',
      quantity: Number(registration.quantity || 0),
      status: safeCell(registration.status),
      total_amount: Number(registration.total_amount || 0),
      currency: safeCell(registration.currency),
      created_at: safeCell(formatDate(registration.created_at)),
      confirmed_at: safeCell(formatDate(registration.confirmed_at)),
    };
    for (const [id] of customColumns) row[`custom_${id}`] = safeCell(customAnswers.get(id));
    sheet.addRow(row);
  }

  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF293C74' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    if (index % 2 === 0) sheet.getRow(index).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
  }
  sheet.columns.forEach((column) => {
    if (!column?.eachCell) return;
    let longest = String(column.header || '').length;
    column.eachCell({ includeEmpty: true }, (cell) => { longest = Math.max(longest, String(cell.value || '').length); });
    column.width = Math.max(14, Math.min(42, longest + 2));
  });

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  const filename = `inscripciones-${slugify(event.title)}.xlsx`;
  const oneDriveUrl = await mirrorExportToOneDrive({ event, actorUserId: ctx.userId, content: bytes });
  void supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: event.id,
    action: 'EVENT_REGISTRATIONS_EXPORTED',
    after_data: { registrations: registrationsResult.data.length, custom_fields: customColumns.size },
  });
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'x-event-export-onedrive': oneDriveUrl ? 'updated' : 'unavailable',
    },
  });
};
