import { supabaseAdmin } from './supabaseAdmin';

export type CampusDonationAllocationInput = {
  donationId: string;
  missionarySlug: string;
  missionaryName: string;
  missionaryId?: string | null;
  amount: number;
  currency: 'COP' | 'USD' | string;
};

export type CampusDonationAllocationRecord = {
  id?: string;
  donation_id: string;
  missionary_slug: string;
  missionary_name: string;
  missionary_id: string | null;
  amount: number;
  currency: string;
  created_at?: string;
};

export type CampusAllocationLookup = {
  available: boolean;
  allocationsByDonationId: Map<string, CampusDonationAllocationRecord[]>;
};

function isMissingAllocationsTable(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    message.includes('campus_donation_allocations') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function normalizeAllocation(input: CampusDonationAllocationInput) {
  return {
    donation_id: input.donationId,
    missionary_slug: input.missionarySlug,
    missionary_name: input.missionaryName,
    missionary_id: input.missionaryId ?? null,
    amount: input.amount,
    currency: input.currency,
  };
}

function groupByDonationId(rows: CampusDonationAllocationRecord[] = []) {
  const grouped = new Map<string, CampusDonationAllocationRecord[]>();
  rows.forEach((row) => {
    const donationId = String(row?.donation_id || '').trim();
    if (!donationId) return;
    const existing = grouped.get(donationId) || [];
    existing.push(row);
    grouped.set(donationId, existing);
  });
  return grouped;
}

export async function upsertCampusDonationAllocations(
  allocations: CampusDonationAllocationInput[],
): Promise<boolean> {
  if (!supabaseAdmin || allocations.length === 0) return false;

  const rows = allocations
    .filter((allocation) => allocation.donationId && allocation.missionarySlug && allocation.missionaryName)
    .map(normalizeAllocation);
  if (rows.length === 0) return false;

  const { error } = await supabaseAdmin
    .from('campus_donation_allocations')
    .upsert(rows, { onConflict: 'donation_id,missionary_slug' });

  if (!error) return true;
  if (isMissingAllocationsTable(error)) {
    console.warn('[campus.allocations] table missing; falling back to legacy donation scope');
    return false;
  }

  console.error('[campus.allocations] upsert error', error);
  return false;
}

export async function loadCampusAllocationsByDonationIds(
  donationIds: string[],
): Promise<CampusAllocationLookup> {
  if (!supabaseAdmin || donationIds.length === 0) {
    return { available: Boolean(supabaseAdmin), allocationsByDonationId: new Map() };
  }

  const ids = Array.from(new Set(donationIds.filter(Boolean)));
  const { data, error } = await supabaseAdmin
    .from('campus_donation_allocations')
    .select('id, donation_id, missionary_slug, missionary_name, missionary_id, amount, currency, created_at')
    .in('donation_id', ids);

  if (!error) {
    return {
      available: true,
      allocationsByDonationId: groupByDonationId((data || []) as CampusDonationAllocationRecord[]),
    };
  }
  if (isMissingAllocationsTable(error)) {
    return { available: false, allocationsByDonationId: new Map() };
  }

  console.error('[campus.allocations] lookup error', error);
  return { available: false, allocationsByDonationId: new Map() };
}

export async function loadCampusAllocationsForMissionary(
  missionaryId: string,
  limit = 300,
): Promise<CampusAllocationLookup & { donationIds: string[] }> {
  if (!supabaseAdmin || !missionaryId) {
    return { available: Boolean(supabaseAdmin), donationIds: [], allocationsByDonationId: new Map() };
  }

  const { data, error } = await supabaseAdmin
    .from('campus_donation_allocations')
    .select('id, donation_id, missionary_slug, missionary_name, missionary_id, amount, currency, created_at')
    .eq('missionary_id', missionaryId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!error) {
    const rows = (data || []) as CampusDonationAllocationRecord[];
    return {
      available: true,
      donationIds: Array.from(new Set(rows.map((row) => row.donation_id).filter(Boolean))),
      allocationsByDonationId: groupByDonationId(rows),
    };
  }
  if (isMissingAllocationsTable(error)) {
    return { available: false, donationIds: [], allocationsByDonationId: new Map() };
  }

  console.error('[campus.allocations] missionary lookup error', error);
  return { available: false, donationIds: [], allocationsByDonationId: new Map() };
}

export function attachCampusAllocationsToDonations<T extends Record<string, any>>(
  donations: T[],
  allocationsByDonationId: Map<string, CampusDonationAllocationRecord[]>,
): T[] {
  if (!allocationsByDonationId.size) return donations;
  return donations.map((donation) => ({
    ...donation,
    _campusAllocations: allocationsByDonationId.get(String(donation.id)) || [],
  }));
}
