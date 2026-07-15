import type { APIRoute } from 'astro';
import ExcelJS from 'exceljs';
import { MISIONEROS } from '@data/misioneros';
import { applyFinanceScopeFilter, getFinanceAccessContext } from '@lib/financeAccess';
import { loadCampusAllocationsByDonationIds } from '@lib/campusDonationAllocations';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const CAMPUS_STATUSES = ['PAID', 'APPROVED'];
const PAGE_SIZE = 500;

const exportSelect = [
  'id',
  'donor_name',
  'donor_email',
  'donor_phone',
  'amount',
  'currency',
  'is_recurring',
  'created_at',
  'missionary_id',
  'missionary_name',
  'campus',
  'status',
  'reference',
  'provider',
  'payment_domain',
  'donation_type',
  'source',
  'raw_event',
].join(', ');

type AllocationRow = {
  missionary_slug: string;
  missionary_name: string;
  missionary_id: string | null;
  amount: number;
  currency: string;
};

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
    },
  });
}

function normalizeCurrency(value: unknown): string {
  return String(value || '').trim().toUpperCase() || 'COP';
}

function isRecurring(donation: any): boolean {
  return donation?.is_recurring === true
    || donation?.is_recurring === 'true'
    || donation?.raw_event?.frequency === 'monthly'
    || donation?.raw_event?.mode === 'subscription'
    || Boolean(donation?.raw_event?.metadata?.campus_subscription_id);
}

function missionaryName(slug: string, fallback = ''): string {
  return MISIONEROS.find((missionary) => missionary.slug === slug)?.nombre || fallback || slug || 'Sin asignar';
}

function legacyAllocations(donation: any): AllocationRow[] {
  const raw = donation?.raw_event || {};
  const currency = normalizeCurrency(donation?.currency);
  const total = Number(donation?.amount || 0);
  const matches = Array.isArray(raw?.missionaryMatches) ? raw.missionaryMatches : [];
  const slugs = Array.isArray(raw?.missionaries)
    ? raw.missionaries.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const normalizedMatches = matches
    .map((item: any) => ({
      slug: String(item?.slug || '').trim(),
      name: String(item?.name || '').trim(),
      id: String(item?.userId || '').trim() || null,
    }))
    .filter((item: any) => item.slug || item.name || item.id);
  const candidates = normalizedMatches.length
    ? normalizedMatches
    : slugs.map((slug: string) => ({ slug, name: missionaryName(slug), id: null }));
  const savedNames = String(donation?.missionary_name || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fallbackCandidates = candidates.length
    ? candidates
    : savedNames.map((name) => ({ slug: '', name, id: donation?.missionary_id || null }));
  const finalCandidates = fallbackCandidates.length
    ? fallbackCandidates
    : [{ slug: '', name: 'Sin asignar', id: donation?.missionary_id || null }];
  const rawPerMissionary = Number(raw?.amountPerMissionary ?? raw?.amount_per_missionary);
  const amountPerMissionary = Number.isFinite(rawPerMissionary) && rawPerMissionary > 0
    ? rawPerMissionary
    : finalCandidates.length > 1
      ? total / finalCandidates.length
      : total;

  return finalCandidates.map((candidate: any) => ({
    missionary_slug: candidate.slug,
    missionary_name: missionaryName(candidate.slug, candidate.name),
    missionary_id: candidate.id,
    amount: amountPerMissionary,
    currency,
  }));
}

async function loadAllCampusDonations(access: any): Promise<{ data: any[]; error: any }> {
  if (!supabaseAdmin) return { data: [], error: new Error('Supabase no configurado') };
  const rows: any[] = [];
  for (let offset = 0; offset < 10_000; offset += PAGE_SIZE) {
    const result = await applyFinanceScopeFilter(
      supabaseAdmin.from('donations').select(exportSelect),
      access,
    )
      .in('status', CAMPUS_STATUSES)
      .or('payment_domain.eq.CAMPUS,donation_type.eq.campus,source.ilike.%campus%,campus.ilike.%Campus%')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

function styleSheet(sheet: ExcelJS.Worksheet, currencyColumns: string[] = []) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF293C74' } };
    cell.alignment = { vertical: 'middle' };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });
  currencyColumns.forEach((key) => {
    sheet.getColumn(key).numFmt = '#,##0.00';
    sheet.getColumn(key).alignment = { horizontal: 'right', vertical: 'top' };
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);

  const financeContext = await getFinanceAccessContext(request);
  if (!financeContext.ok) {
    return json({
      ok: false,
      error: financeContext.access.hasInvalidAssignments
        ? 'El alcance financiero está incompleto.'
        : 'No tienes acceso financiero para exportar Campus.',
    }, financeContext.status || 403);
  }

  const requestedMissionary = String(url.searchParams.get('missionary') || '').trim();
  if (requestedMissionary && !MISIONEROS.some((missionary) => missionary.slug === requestedMissionary)) {
    return json({ ok: false, error: 'Misionero Campus no válido.' }, 400);
  }

  const loaded = await loadAllCampusDonations(financeContext.access);
  if (loaded.error) {
    console.error('[portal.campus.export] donation query failed', loaded.error);
    return json({ ok: false, error: 'No se pudo preparar el histórico de Campus.' }, 500);
  }

  const allocationMap = new Map<string, any[]>();
  const donationIds = loaded.data.map((donation) => String(donation.id || '')).filter(Boolean);
  for (let index = 0; index < donationIds.length; index += 200) {
    const lookup = await loadCampusAllocationsByDonationIds(donationIds.slice(index, index + 200));
    lookup.allocationsByDonationId.forEach((rows, donationId) => allocationMap.set(donationId, rows));
  }

  const contributionRows = loaded.data.flatMap((donation) => {
    const storedAllocations = allocationMap.get(String(donation.id)) || [];
    const allocations: AllocationRow[] = storedAllocations.length
      ? storedAllocations.map((allocation: any) => ({
          missionary_slug: String(allocation.missionary_slug || '').trim(),
          missionary_name: String(allocation.missionary_name || '').trim() || missionaryName(allocation.missionary_slug),
          missionary_id: allocation.missionary_id || null,
          amount: Number(allocation.amount || 0),
          currency: normalizeCurrency(allocation.currency || donation.currency),
        }))
      : legacyAllocations(donation);

    return allocations
      .filter((allocation) => !requestedMissionary || allocation.missionary_slug === requestedMissionary)
      .map((allocation) => ({ donation, allocation }));
  });

  const summary = new Map<string, {
    slug: string;
    name: string;
    donationIds: Set<string>;
    donors: Set<string>;
    cop: number;
    usd: number;
    lastDonation: string | null;
  }>();
  contributionRows.forEach(({ donation, allocation }) => {
    const key = allocation.missionary_slug || allocation.missionary_name || 'sin-asignar';
    if (!summary.has(key)) {
      summary.set(key, {
        slug: allocation.missionary_slug,
        name: allocation.missionary_name || 'Sin asignar',
        donationIds: new Set(),
        donors: new Set(),
        cop: 0,
        usd: 0,
        lastDonation: null,
      });
    }
    const item = summary.get(key)!;
    item.donationIds.add(String(donation.id));
    item.donors.add(String(donation.donor_email || donation.donor_phone || donation.donor_name || donation.id).toLowerCase());
    if (allocation.currency === 'USD') item.usd += allocation.amount;
    else if (allocation.currency === 'COP') item.cop += allocation.amount;
    if (!item.lastDonation || new Date(donation.created_at) > new Date(item.lastDonation)) item.lastDonation = donation.created_at;
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ministerio Maná';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet('Resumen por misionero');
  summarySheet.columns = [
    { header: 'Misionero', key: 'missionary', width: 28 },
    { header: 'Aportes', key: 'contributions', width: 12 },
    { header: 'Donantes únicos', key: 'donors', width: 18 },
    { header: 'Total COP', key: 'cop', width: 18 },
    { header: 'Total USD', key: 'usd', width: 18 },
    { header: 'Último aporte', key: 'lastDonation', width: 18 },
  ];
  Array.from(summary.values())
    .sort((left, right) => left.name.localeCompare(right.name, 'es'))
    .forEach((item) => summarySheet.addRow({
      missionary: item.name,
      contributions: item.donationIds.size,
      donors: item.donors.size,
      cop: item.cop,
      usd: item.usd,
      lastDonation: item.lastDonation ? new Date(item.lastDonation) : null,
    }));
  summarySheet.getColumn('lastDonation').numFmt = 'dd/mm/yyyy';
  styleSheet(summarySheet, ['cop', 'usd']);

  const contributionsSheet = workbook.addWorksheet('Aportes');
  contributionsSheet.columns = [
    { header: 'Fecha', key: 'date', width: 18 },
    { header: 'Misionero', key: 'missionary', width: 28 },
    { header: 'Donante', key: 'donor', width: 28 },
    { header: 'Correo', key: 'email', width: 32 },
    { header: 'Teléfono', key: 'phone', width: 20 },
    { header: 'Frecuencia', key: 'frequency', width: 16 },
    { header: 'Proveedor', key: 'provider', width: 14 },
    { header: 'Moneda', key: 'currency', width: 12 },
    { header: 'Total del pago', key: 'paymentAmount', width: 18 },
    { header: 'Asignado al misionero', key: 'allocatedAmount', width: 24 },
    { header: 'Referencia', key: 'reference', width: 34 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Campus', key: 'campus', width: 24 },
  ];
  contributionRows.forEach(({ donation, allocation }) => contributionsSheet.addRow({
    date: donation.created_at ? new Date(donation.created_at) : null,
    missionary: allocation.missionary_name,
    donor: donation.donor_name || 'Donante anónimo',
    email: donation.donor_email || '',
    phone: donation.donor_phone || '',
    frequency: isRecurring(donation) ? 'Mensual' : 'Una vez',
    provider: String(donation.provider || '').toUpperCase(),
    currency: normalizeCurrency(donation.currency),
    paymentAmount: Number(donation.amount || 0),
    allocatedAmount: allocation.amount,
    reference: donation.reference || '',
    status: donation.status || '',
    campus: donation.campus || '',
  }));
  contributionsSheet.getColumn('date').numFmt = 'dd/mm/yyyy hh:mm';
  styleSheet(contributionsSheet, ['paymentAmount', 'allocatedAmount']);

  const donorMap = new Map<string, any>();
  contributionRows.forEach(({ donation, allocation }) => {
    const donorKey = String(donation.donor_email || donation.donor_phone || donation.donor_name || donation.id).toLowerCase();
    const key = `${allocation.missionary_slug || allocation.missionary_name}:${donorKey}`;
    if (!donorMap.has(key)) {
      donorMap.set(key, {
        missionary: allocation.missionary_name,
        donor: donation.donor_name || 'Donante anónimo',
        email: donation.donor_email || '',
        phone: donation.donor_phone || '',
        contributions: 0,
        cop: 0,
        usd: 0,
        lastDonation: null,
      });
    }
    const item = donorMap.get(key);
    item.contributions += 1;
    if (allocation.currency === 'USD') item.usd += allocation.amount;
    else if (allocation.currency === 'COP') item.cop += allocation.amount;
    if (!item.lastDonation || new Date(donation.created_at) > new Date(item.lastDonation)) item.lastDonation = donation.created_at;
  });

  const donorsSheet = workbook.addWorksheet('Donantes');
  donorsSheet.columns = [
    { header: 'Misionero', key: 'missionary', width: 28 },
    { header: 'Donante', key: 'donor', width: 28 },
    { header: 'Correo', key: 'email', width: 32 },
    { header: 'Teléfono', key: 'phone', width: 20 },
    { header: 'Número de aportes', key: 'contributions', width: 20 },
    { header: 'Total COP', key: 'cop', width: 18 },
    { header: 'Total USD', key: 'usd', width: 18 },
    { header: 'Último aporte', key: 'lastDonation', width: 18 },
  ];
  Array.from(donorMap.values())
    .sort((left, right) => left.missionary.localeCompare(right.missionary, 'es') || left.donor.localeCompare(right.donor, 'es'))
    .forEach((item) => donorsSheet.addRow({ ...item, lastDonation: item.lastDonation ? new Date(item.lastDonation) : null }));
  donorsSheet.getColumn('lastDonation').numFmt = 'dd/mm/yyyy';
  styleSheet(donorsSheet, ['cop', 'usd']);

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  const suffix = requestedMissionary || 'general';
  const fileName = `campus-informe-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
};
