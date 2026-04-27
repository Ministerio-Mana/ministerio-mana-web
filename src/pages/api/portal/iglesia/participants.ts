import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess, listAccessibleChurchIds } from '@lib/portalScope';
import { resolveParticipantPackagesForExport } from '@lib/cumbrePackageResolution';

export const prerender = false;

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
  return normalizeName(value).includes('responsable');
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

function calculateAgeFromBirthdate(raw: unknown): number | null {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function resolveRegistrationType(booking: any): string {
  const method = String(booking?.payment_method || '').toLowerCase();
  return method === 'cash' || method === 'manual' || booking?.source === 'portal-iglesia'
    ? 'LOCAL'
    : 'ONLINE';
}

function resolveChurchFinal(booking: any): string {
  const catalog = normalizeText(booking?.church?.name);
  if (catalog) return catalog;
  const typed = normalizeText(booking?.contact_church);
  if (typed) return typed;
  return 'Ministerio Mana Virtual';
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
    const denied = mapPortalAccessError(access.reason, 'Acceso denegado a participantes');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const requestedChurch = url.searchParams.get('churchId');
  let targetChurch = access.isAdmin ? requestedChurch : access.allowedChurchId;
  let scopedChurchIds: string[] = [];

  if (!access.isAdmin && !access.allowedChurchId) {
    scopedChurchIds = await listAccessibleChurchIds(access);
    if (requestedChurch) {
      const isAllowedChurch = await isChurchAllowedForAccess(requestedChurch, access);
      if (!isAllowedChurch) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      targetChurch = requestedChurch;
    }
  }

  let bookingsQuery = supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_document_type, contact_document_number, contact_country, contact_city, contact_church, church_id, source, status, total_amount, total_paid, currency, payment_method, created_at, church:churches(id, name, city, country)')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (targetChurch) {
    bookingsQuery = bookingsQuery.eq('church_id', targetChurch);
  } else if (!access.isAdmin) {
    if (!scopedChurchIds.length) {
      return new Response(JSON.stringify({ ok: true, participants: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    bookingsQuery = bookingsQuery.in('church_id', scopedChurchIds);
  }

  const { data: bookings, error: bookingsError } = await bookingsQuery;
  if (bookingsError) {
    console.error('[portal.iglesia.participants] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar participantes' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const enrolledBookings = (bookings || []).filter((booking: any) => {
    const totalPaid = Number(booking.total_paid || 0);
    return totalPaid > 0 || booking.status === 'DEPOSIT_OK' || booking.status === 'PAID';
  });
  const bookingIds = enrolledBookings.map((booking: any) => booking.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, participants: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: participants, error: participantsError } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, relationship, birthdate, gender, nationality, document_type, document_number, diet_type, package_type, email, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true });

  if (participantsError) {
    console.error('[portal.iglesia.participants] participants error', participantsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar participantes' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: payments } = await supabaseAdmin
    .from('cumbre_payments')
    .select('id, booking_id, amount, currency, status, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  const { data: installments } = await supabaseAdmin
    .from('cumbre_installments')
    .select('id, booking_id, due_date, amount, currency, status')
    .in('booking_id', bookingIds);

  const paidStatuses = new Set(['APPROVED', 'PAID']);
  const lastPaymentByBooking = new Map<string, any>();
  for (const payment of payments || []) {
    const bookingId = String(payment.booking_id || '');
    const status = String(payment.status || '').toUpperCase();
    if (!bookingId || !paidStatuses.has(status) || lastPaymentByBooking.has(bookingId)) continue;
    lastPaymentByBooking.set(bookingId, payment);
  }

  const nextInstallmentByBooking = new Map<string, any>();
  for (const installment of installments || []) {
    const bookingId = String(installment.booking_id || '');
    const status = String(installment.status || '').toUpperCase();
    if (!bookingId || !['PENDING', 'FAILED', 'OVERDUE'].includes(status)) continue;
    const dueTime = Date.parse(String(installment.due_date || ''));
    const existing = nextInstallmentByBooking.get(bookingId);
    const existingDueTime = Date.parse(String(existing?.due_date || ''));
    if (!existing || (Number.isFinite(dueTime) && (!Number.isFinite(existingDueTime) || dueTime < existingDueTime))) {
      nextInstallmentByBooking.set(bookingId, installment);
    }
  }

  const bookingMap = new Map<string, any>();
  for (const booking of enrolledBookings || []) {
    bookingMap.set(booking.id, booking);
  }

  const participantsByBooking = new Map<string, any[]>();
  for (const participant of participants || []) {
    const list = participantsByBooking.get(participant.booking_id) ?? [];
    list.push(participant);
    participantsByBooking.set(participant.booking_id, list);
  }

  const rows: any[] = [];
  for (const [bookingId, list] of participantsByBooking) {
    const booking = bookingMap.get(bookingId);
    if (!booking) continue;

    const primaryId = resolvePrimaryParticipantId(list, booking);
    const primaryParticipant = list.find((participant) => participant.id === primaryId);
    const packageResolution = resolveParticipantPackagesForExport(booking, list);
    const participantCount = list.length;
    const totalAmount = Number(booking.total_amount || 0);
    const totalPaid = Number(booking.total_paid || 0);
    const pendingAmount = Math.max(0, totalAmount - totalPaid);
    const lastPayment = lastPaymentByBooking.get(String(bookingId)) || null;
    const nextInstallment = nextInstallmentByBooking.get(String(bookingId)) || null;
    const paymentMethod = String(booking.payment_method || '').toLowerCase();
    const isManualPayment = paymentMethod === 'cash'
      || paymentMethod === 'manual'
      || booking.source === 'portal-iglesia';

    for (const participant of list) {
      const packageInfo = packageResolution.get(String(participant.id || ''));
      const resolvedPackageType = packageInfo?.packageType ?? participant.package_type;
      const birthdate = participant.birthdate || '';
      rows.push({
        participant_id: participant.id,
        booking_id: bookingId,
        booking_ref: String(bookingId).slice(0, 8).toUpperCase(),
        participant_name: participant.full_name || '',
        titular_reserva: booking.contact_name || '',
        responsable_grupo: primaryParticipant?.full_name || booking.contact_name || '',
        is_payment_owner: Boolean(primaryId && participant.id === primaryId),
        reserva_tipo: participantCount > 1 ? 'GRUPO' : 'INDIVIDUAL',
        document_type: participant.document_type || booking.contact_document_type || '',
        document_number: participant.document_number || booking.contact_document_number || '',
        birthdate,
        age: calculateAgeFromBirthdate(birthdate),
        gender: participant.gender || '',
        nationality: participant.nationality || booking.contact_country || '',
        city: booking.contact_city || '',
        phone: booking.contact_phone || '',
        email: participant.email || booking.contact_email || '',
        diet_type: participant.diet_type || '',
        diet_label: formatDietLabel(participant.diet_type),
        package_type: resolvedPackageType,
        package_label: formatLodgingLabel(resolvedPackageType),
        package_original_type: participant.package_type || '',
        package_issue: packageInfo?.issue || '',
        church_final: resolveChurchFinal(booking),
        church_catalog: booking.church?.name || '',
        church_input: booking.contact_church || '',
        registration_type: resolveRegistrationType(booking),
        booking_status: booking.status || '',
        participant_count: participantCount,
        total_amount: totalAmount,
        total_paid: totalPaid,
        pending_amount: pendingAmount,
        currency: booking.currency || '',
        payment_type: isManualPayment ? 'Físico' : 'Online',
        is_paid_full: booking.status === 'PAID' || totalPaid >= totalAmount,
        last_payment_amount: lastPayment ? Number(lastPayment.amount || 0) : null,
        last_payment_currency: lastPayment?.currency || booking.currency || '',
        last_payment_at: lastPayment?.created_at || '',
        next_due_amount: nextInstallment ? Number(nextInstallment.amount || 0) : null,
        next_due_currency: nextInstallment?.currency || booking.currency || '',
        next_due_date: nextInstallment?.due_date || '',
        created_at: booking.created_at || '',
      });
    }
  }

  rows.sort((a, b) => {
    const ta = Date.parse(String(a.created_at || ''));
    const tb = Date.parse(String(b.created_at || ''));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return String(a.participant_name || '').localeCompare(String(b.participant_name || ''));
  });

  return new Response(JSON.stringify({ ok: true, participants: rows }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
