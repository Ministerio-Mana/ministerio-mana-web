import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { getPrice, isValidPackageType, type Currency, type PackageType } from '@lib/cumbre2026';

export const prerender = false;

type AuditRow = {
  booking_id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  church_name: string;
  contact_church: string;
  currency: string;
  status: string;
  total_amount: number;
  total_paid: number;
  expected_total_amount: number;
  difference: number;
  participant_count: number;
  package_summary: string;
  issue: string;
  created_at: string;
};

type ParticipantAuditRow = AuditRow & {
  participant_id: string;
  participant_name: string;
  participant_relationship: string;
  participant_document_type: string;
  participant_document_number: string;
  participant_birthdate: string;
  participant_age: number | '';
  participant_package_type: string;
  participant_package_label: string;
  participant_expected_price: number | '';
  participant_issue: string;
  suggested_action: string;
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const str = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[,\n\r"]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeCurrency(raw: unknown): Currency {
  return String(raw || '').trim().toUpperCase() === 'USD' ? 'USD' : 'COP';
}

function roundCurrency(amount: number, currency: Currency): number {
  return currency === 'COP'
    ? Math.round(amount)
    : Math.round(amount * 100) / 100;
}

function packageLabel(value: string): string {
  if (value === 'lodging') return 'Con alojamiento';
  if (value === 'no_lodging') return 'Sin alojamiento';
  if (value === 'child_0_7') return 'Nino 0-4';
  if (value === 'child_7_13') return 'Nino 5-10';
  return value || 'SIN_PAQUETE';
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

function packageTypeByChildAge(age: number | null): PackageType | null {
  if (age === null) return null;
  if (age <= 4) return 'child_0_7';
  if (age <= 10) return 'child_7_13';
  return null;
}

function amountsMatch(a: number, b: number, currency: Currency): boolean {
  const tolerance = currency === 'COP' ? 1 : 0.01;
  return Math.abs(a - b) <= tolerance;
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.cumbre.package-audit',
  });

  if (!guard.ok) {
    return new Response(JSON.stringify({ ok: false, error: guard.error || 'No autorizado' }), {
      status: guard.status,
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
  const limitRaw = Number(url.searchParams.get('limit') || 2000);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 5000) : 2000;
  const includeOk = url.searchParams.get('includeOk') === '1';
  const format = String(url.searchParams.get('format') || 'json').toLowerCase();
  const scope = String(url.searchParams.get('scope') || 'bookings').toLowerCase();

  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('cumbre_bookings')
    .select('id, contact_name, contact_email, contact_phone, contact_church, currency, status, total_amount, total_paid, created_at, church:churches(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (bookingsError) {
    console.error('[portal.admin.cumbre.package-audit] bookings error', bookingsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar reservas' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bookingIds = (bookings || []).map((booking: any) => booking.id);
  if (!bookingIds.length) {
    return new Response(JSON.stringify({ ok: true, rows: [], summary: { checked: 0, issues: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: participants, error: participantsError } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id, booking_id, full_name, relationship, document_type, document_number, birthdate, package_type')
    .in('booking_id', bookingIds);

  if (participantsError) {
    console.error('[portal.admin.cumbre.package-audit] participants error', participantsError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar participantes' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const participantsByBooking = new Map<string, any[]>();
  for (const participant of participants || []) {
    const list = participantsByBooking.get(participant.booking_id) ?? [];
    list.push(participant);
    participantsByBooking.set(participant.booking_id, list);
  }

  const rows: AuditRow[] = [];
  const participantRows: ParticipantAuditRow[] = [];

  for (const booking of bookings || []) {
    const currency = normalizeCurrency(booking.currency);
    const bookingParticipants = participantsByBooking.get(booking.id) ?? [];
    const packageCounts = new Map<string, number>();
    let expectedTotal = 0;
    let invalidPackageCount = 0;

    for (const participant of bookingParticipants) {
      const packageType = String(participant.package_type || '').trim() as PackageType;
      const key = isValidPackageType(packageType) ? packageType : 'invalid';
      packageCounts.set(key, (packageCounts.get(key) ?? 0) + 1);
      if (isValidPackageType(packageType)) {
        expectedTotal += getPrice(currency, packageType);
      } else {
        invalidPackageCount += 1;
      }
    }

    const totalAmount = Number(booking.total_amount || 0);
    const normalizedExpected = roundCurrency(expectedTotal, currency);
    const difference = roundCurrency(totalAmount - normalizedExpected, currency);
    const issues: string[] = [];

    if (!bookingParticipants.length) issues.push('SIN_PARTICIPANTES');
    if (invalidPackageCount > 0) issues.push('PAQUETE_INVALIDO');
    if (difference !== 0) issues.push('TOTAL_NO_CUADRA_CON_PAQUETES');

    const packageSummary = Array.from(packageCounts.entries())
      .map(([key, count]) => `${packageLabel(key)}: ${count}`)
      .join(' | ');

    const baseRow: AuditRow = {
      booking_id: booking.id,
      contact_name: booking.contact_name || '',
      contact_email: booking.contact_email || '',
      contact_phone: booking.contact_phone || '',
      church_name: booking.church?.name || '',
      contact_church: booking.contact_church || '',
      currency,
      status: booking.status || '',
      total_amount: totalAmount,
      total_paid: Number(booking.total_paid || 0),
      expected_total_amount: normalizedExpected,
      difference,
      participant_count: bookingParticipants.length,
      package_summary: packageSummary,
      issue: issues.join(',') || 'OK',
      created_at: booking.created_at || '',
    };

    if (includeOk || issues.length) {
      rows.push(baseRow);
    }

    const lodgingDelta = getPrice(currency, 'lodging') - getPrice(currency, 'no_lodging');
    const lodgingParticipants = bookingParticipants.filter((participant) => participant?.package_type === 'lodging');
    let suspectedNoLodgingCount = 0;

    if (difference < 0 && lodgingDelta > 0 && lodgingParticipants.length > 0) {
      const rounded = Math.round(Math.abs(difference) / lodgingDelta);
      if (
        rounded > 0
        && rounded <= lodgingParticipants.length
        && amountsMatch(difference + (lodgingDelta * rounded), 0, currency)
      ) {
        suspectedNoLodgingCount = rounded;
      }
    }

    for (const participant of bookingParticipants) {
      const packageType = String(participant.package_type || '').trim() as PackageType;
      const validPackage = isValidPackageType(packageType);
      const age = calculateAgeFromBirthdate(participant.birthdate);
      const childPackage = packageTypeByChildAge(age);
      const participantIssues: string[] = [];
      const suggestions: string[] = [];

      if (!validPackage) {
        participantIssues.push('PAQUETE_INVALIDO');
        suggestions.push('Corregir package_type antes de exportar');
      }

      if (validPackage && childPackage && packageType !== childPackage) {
        participantIssues.push('EDAD_NO_CUADRA_CON_PAQUETE');
        suggestions.push(`Por edad deberia ser ${childPackage}`);
      }

      if (difference !== 0) {
        participantIssues.push('RESERVA_TOTAL_NO_CUADRA');
      }

      if (validPackage && packageType === 'lodging' && suspectedNoLodgingCount > 0) {
        participantIssues.push('CANDIDATO_CON_DEBIO_SER_SIN_ALOJAMIENTO');
        if (suspectedNoLodgingCount === lodgingParticipants.length) {
          suggestions.push('El total sugiere cambiar este participante a no_lodging si confirma sin alojamiento');
        } else {
          suggestions.push(`El total sugiere que ${suspectedNoLodgingCount} de ${lodgingParticipants.length} con alojamiento deberia ser sin alojamiento`);
        }
      } else if (difference !== 0) {
        suggestions.push('Revisar paquetes, participantes y total de la reserva');
      }

      if (!includeOk && !participantIssues.length) continue;

      participantRows.push({
        ...baseRow,
        participant_id: participant.id || '',
        participant_name: participant.full_name || '',
        participant_relationship: participant.relationship || '',
        participant_document_type: participant.document_type || '',
        participant_document_number: participant.document_number || '',
        participant_birthdate: participant.birthdate || '',
        participant_age: age ?? '',
        participant_package_type: validPackage ? packageType : String(participant.package_type || ''),
        participant_package_label: packageLabel(String(participant.package_type || '')),
        participant_expected_price: validPackage ? getPrice(currency, packageType) : '',
        participant_issue: participantIssues.join(',') || 'OK',
        suggested_action: Array.from(new Set(suggestions)).join(' | '),
      });
    }
  }

  const summary = {
    checked: bookings?.length || 0,
    issues: rows.filter((row) => row.issue !== 'OK').length,
    participant_issues: participantRows.filter((row) => row.participant_issue !== 'OK').length,
    returned: rows.length,
    participant_rows_returned: participantRows.length,
  };

  if (format === 'csv') {
    const bookingHeaders = [
      'booking_id',
      'contact_name',
      'contact_email',
      'contact_phone',
      'church_name',
      'contact_church',
      'currency',
      'status',
      'total_amount',
      'total_paid',
      'expected_total_amount',
      'difference',
      'participant_count',
      'package_summary',
      'issue',
      'created_at',
    ];
    const participantHeaders = [
      ...bookingHeaders,
      'participant_id',
      'participant_name',
      'participant_relationship',
      'participant_document_type',
      'participant_document_number',
      'participant_birthdate',
      'participant_age',
      'participant_package_type',
      'participant_package_label',
      'participant_expected_price',
      'participant_issue',
      'suggested_action',
    ];
    const headers = scope === 'participants' ? participantHeaders : bookingHeaders;
    const exportRows = scope === 'participants' ? participantRows : rows;
    const csv = [
      headers.join(','),
      ...exportRows.map((row) => headers.map((header) => csvEscape((row as any)[header])).join(',')),
    ].join('\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="cumbre-package-audit-${scope === 'participants' ? 'participants' : 'bookings'}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify({ ok: true, rows, participant_rows: participantRows, summary }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
