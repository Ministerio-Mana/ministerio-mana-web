import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { MISIONEROS } from '@data/misioneros';
import {
    attachCampusAllocationsToDonations,
    loadCampusAllocationsByDonationIds,
    loadCampusAllocationsForMissionary,
    loadCampusAllocationsForMissionarySlug,
} from '@lib/campusDonationAllocations';

export const prerender = false;

const CAMPUS_STATUSES = ['PAID', 'APPROVED'];

const donationSelect = [
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
    'raw_event',
].join(', ');

const campusDonationSelect = [
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
    'project_name',
    'source',
    'raw_event',
].join(', ');

function isMissingColumnError(error: any): boolean {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function resolveCampusMissionarySlug(profile: any): string | null {
    const explicitSlug = String(profile?.campus_missionary_slug || '').trim();
    if (explicitSlug && MISIONEROS.some((missionary) => missionary.slug === explicitSlug)) {
        return explicitSlug;
    }
    return null;
}

function mergeAllocationMaps(maps: Map<string, any[]>[]): Map<string, any[]> {
    const merged = new Map<string, any[]>();
    const seen = new Set<string>();

    maps.forEach((map) => {
        map.forEach((rows, donationId) => {
            const current = merged.get(donationId) || [];
            rows.forEach((row) => {
                const key = row?.id
                    || `${row?.donation_id || donationId}:${row?.missionary_slug || ''}:${row?.missionary_id || ''}:${row?.amount || ''}:${row?.currency || ''}`;
                if (seen.has(key)) return;
                seen.add(key);
                current.push(row);
            });
            merged.set(donationId, current);
        });
    });

    return merged;
}

function getCampusAllocations(donation: any): any[] {
    return Array.isArray(donation?._campusAllocations) ? donation._campusAllocations : [];
}

function isRecurringDonation(donation: any): boolean {
    if (donation?.is_recurring === true || donation?.is_recurring === 'true') return true;
    const raw = donation?.raw_event;
    return (
        raw?.frequency === 'monthly'
        || raw?.mode === 'subscription'
        || Boolean(raw?.metadata?.campus_subscription_id)
    );
}

function addDonationAmount(
    totalsByCurrency: Record<string, number>,
    donation: any,
): Record<string, number> {
    const currency = String(donation?.currency || '').trim().toUpperCase();
    const amount = Number(donation?.amount || 0);
    if (!currency || !Number.isFinite(amount)) return totalsByCurrency;
    totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
    return totalsByCurrency;
}

function getAmountPerMissionary(donation: any): number | null {
    const allocations = getCampusAllocations(donation);
    if (allocations.length > 0) {
        const amounts = allocations
            .map((allocation) => Number(allocation?.amount || 0))
            .filter((amount) => Number.isFinite(amount) && amount > 0);
        if (!amounts.length) return null;
        return amounts.every((amount) => amount === amounts[0]) ? amounts[0] : null;
    }

    const raw = donation?.raw_event;
    const value = raw?.amountPerMissionary ?? raw?.amount_per_missionary;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getMissionarySlugs(donation: any): string[] {
    const allocations = getCampusAllocations(donation);
    if (allocations.length > 0) {
        return allocations
            .map((allocation) => String(allocation?.missionary_slug || '').trim())
            .filter(Boolean);
    }

    const raw = donation?.raw_event;
    if (Array.isArray(raw?.missionaries)) {
        return raw.missionaries.map((item: unknown) => String(item || '').trim()).filter(Boolean);
    }
    return [];
}

function getMissionaryNamesFromSlugs(slugs: string[]): string[] {
    return slugs.map((slug) => MISIONEROS.find((m) => m.slug === slug)?.nombre || slug);
}

function getMissionaryNames(donation: any): string[] {
    const allocations = getCampusAllocations(donation);
    if (allocations.length > 0) {
        return allocations
            .map((allocation) => String(allocation?.missionary_name || '').trim())
            .filter(Boolean);
    }

    const rawMatches = donation?.raw_event?.missionaryMatches;
    if (Array.isArray(rawMatches)) {
        const fromMatches = rawMatches
            .map((item: any) => String(item?.name || '').trim())
            .filter(Boolean);
        if (fromMatches.length) return fromMatches;
    }

    const fromSlugs = getMissionaryNamesFromSlugs(getMissionarySlugs(donation));
    if (fromSlugs.length) return fromSlugs;

    const savedName = String(donation?.missionary_name || '').trim();
    if (!savedName) return [];
    return savedName.split(',').map((item) => item.trim()).filter(Boolean);
}

function toCampusDonationClientRow(donation: any, isAdmin: boolean) {
    const missionaryNames = getMissionaryNames(donation);
    const amountPerMissionary = getAmountPerMissionary(donation);
    const allocations = getCampusAllocations(donation);
    return {
        id: donation.id,
        created_at: donation.created_at,
        frequency: isRecurringDonation(donation) ? 'recurring' : 'one_time',
        reference: isAdmin ? donation.reference : null,
        provider: isAdmin ? donation.provider : null,
        campus: donation.campus,
        missionary: {
            id: donation.missionary_id,
            name: missionaryNames.join(', ') || donation.missionary_name || null,
            names: missionaryNames,
            slugs: getMissionarySlugs(donation),
        },
        amount: isAdmin ? donation.amount : null,
        amountPerMissionary: isAdmin ? amountPerMissionary : null,
        currency: isAdmin ? donation.currency : null,
        allocations: isAdmin
            ? allocations.map((allocation) => ({
                missionary_slug: allocation.missionary_slug,
                missionary_name: allocation.missionary_name,
                missionary_id: allocation.missionary_id,
                amount: allocation.amount,
                currency: allocation.currency,
            }))
            : [],
    };
}

async function loadCampusDonationsByIds(donationIds: string[]) {
    if (!supabaseAdmin || donationIds.length === 0) return { data: [], error: null };
    const ids = Array.from(new Set(donationIds.filter(Boolean)));

    let result = await supabaseAdmin
        .from('donations')
        .select(campusDonationSelect)
        .in('id', ids)
        .in('status', CAMPUS_STATUSES)
        .order('created_at', { ascending: false })
        .limit(300);

    if (result.error && isMissingColumnError(result.error)) {
        result = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .in('id', ids)
            .in('status', CAMPUS_STATUSES)
            .order('created_at', { ascending: false })
            .limit(300);
    }

    return result;
}

function mergeDonationRows(current: any[], rows: any[]): any[] {
    const byId = new Map<string, any>();
    current.forEach((row) => {
        if (row?.id) byId.set(String(row.id), row);
    });
    rows.forEach((row) => {
        if (!row?.id || byId.has(String(row.id))) return;
        byId.set(String(row.id), row);
    });

    return Array.from(byId.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 200);
}

async function loadCampusDonationsBase() {
    if (!supabaseAdmin) return { data: [], error: null };

    let query = supabaseAdmin
        .from('donations')
        .select(campusDonationSelect)
        .in('status', CAMPUS_STATUSES)
        .or('payment_domain.eq.CAMPUS,donation_type.eq.campus,source.ilike.%campus%,campus.ilike.%Campus%')
        .order('created_at', { ascending: false })
        .limit(300);

    let result = await query;
    if (result.error && isMissingColumnError(result.error)) {
        result = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .in('status', CAMPUS_STATUSES)
            .or('donation_type.eq.campus,source.ilike.%campus%,campus.ilike.%Campus%')
            .order('created_at', { ascending: false })
            .limit(300);
    }

    if (result.error && isMissingColumnError(result.error)) {
        result = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .in('status', CAMPUS_STATUSES)
            .ilike('campus', '%Campus%')
            .order('created_at', { ascending: false })
            .limit(300);
    }
    return result;
}

export const GET: APIRoute = async ({ request }) => {
    const startedAt = Date.now();
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
    }

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
    }

    let userProfile: { user_id?: string; role?: string; full_name?: string | null; campus_missionary_slug?: string | null } | null = null;
    if (user) {
        let profileResult = await supabaseAdmin
            .from('user_profiles')
            .select('user_id, role, full_name, campus_missionary_slug')
            .eq('user_id', user.id)
            .single();
        if (profileResult.error && isMissingColumnError(profileResult.error)) {
            profileResult = await supabaseAdmin
                .from('user_profiles')
                .select('user_id, role, full_name')
                .eq('user_id', user.id)
                .single();
        }
        userProfile = profileResult.data ?? null;
    }

    if (!userProfile && !passwordSession) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const role = passwordSession ? 'superadmin' : (userProfile?.role || 'user');

    // Only campus missionaries and admins can access this endpoint
    const allowedRoles = ['campus_missionary', 'admin', 'superadmin'];
    if (!allowedRoles.includes(role)) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const isAdmin = role === 'admin' || role === 'superadmin';
    const isCampusMissionary = role === 'campus_missionary';

    let donations: any[] = [];
    let error: any = null;

    if (isCampusMissionary && user?.id) {
        const missionarySlug = resolveCampusMissionarySlug(userProfile);
        const allocationScope = await loadCampusAllocationsForMissionary(user.id, 200);
        const slugAllocationScope = missionarySlug
            ? await loadCampusAllocationsForMissionarySlug(missionarySlug, 200)
            : { available: allocationScope.available, donationIds: [], allocationsByDonationId: new Map() };
        const allocationDonationIds = Array.from(new Set([
            ...(allocationScope.donationIds || []),
            ...(slugAllocationScope.donationIds || []),
        ].filter(Boolean)));
        const allocationsByDonationId = mergeAllocationMaps([
            allocationScope.allocationsByDonationId,
            slugAllocationScope.allocationsByDonationId,
        ]);

        if ((allocationScope.available || slugAllocationScope.available) && allocationDonationIds.length > 0) {
            const byAllocation = await loadCampusDonationsByIds(allocationDonationIds);
            if (byAllocation.error) {
                error = byAllocation.error;
            } else {
                donations = attachCampusAllocationsToDonations(
                    byAllocation.data || [],
                    allocationsByDonationId,
                );
            }
        }

        // Primary scope: strict ownership by missionary_id.
        const byId = !error ? await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .in('status', CAMPUS_STATUSES)
            .eq('missionary_id', user.id)
            .order('created_at', { ascending: false })
            .limit(200) : { data: [], error: null };
        if (byId.error) {
            error = byId.error;
        } else {
            donations = mergeDonationRows(donations, byId.data || []);
        }

        // Fallback scope: legacy rows whose raw event still stores the immutable user id.
        if (!error) {
            const byRawEvent = await supabaseAdmin
                .from('donations')
                .select(donationSelect)
                .in('status', CAMPUS_STATUSES)
                .contains('raw_event', { missionaryMatches: [{ userId: user.id }] })
                .order('created_at', { ascending: false })
                .limit(200);
            if (byRawEvent.error) {
                error = byRawEvent.error;
            } else {
                donations = mergeDonationRows(donations, byRawEvent.data || []);
            }
        }
    } else {
        // Admins/Superadmins: Campus-only view. The global donations ledger lives in /portal/donations.
        const campusRows = await loadCampusDonationsBase();
        error = campusRows.error;
        donations = campusRows.data || [];
        if (!error && donations.length > 0) {
            const allocationLookup = await loadCampusAllocationsByDonationIds(donations.map((donation) => donation.id));
            donations = attachCampusAllocationsToDonations(donations, allocationLookup.allocationsByDonationId);
        }
    }

    if (error) {
        console.error('[campus.donors] Error:', {
            elapsedMs: Date.now() - startedAt,
            message: error?.message || String(error),
            code: error?.code,
        });
        return new Response(JSON.stringify({ ok: false, error: 'Failed to load donors' }), { status: 500 });
    }

    // Group donations by donor
    const donorMap = new Map();

    donations.forEach((donation) => {
        const normalizedEmail = String(donation.donor_email || '').trim().toLowerCase();
        const normalizedPhone = String(donation.donor_phone || '').replace(/\D/g, '');
        const donorKey = normalizedEmail
            ? `email:${normalizedEmail}`
            : normalizedPhone
                ? `phone:${normalizedPhone}`
                : `donation:${donation.id}`;
        const recurring = isRecurringDonation(donation);

        if (!donorMap.has(donorKey)) {
            donorMap.set(donorKey, {
                name: donation.donor_name || 'Donante Anónimo',
                email: donation.donor_email,
                phone: donation.donor_phone,
                totalsByCurrency: isAdmin ? addDonationAmount({}, donation) : null,
                donationCount: 1,
                recurringDonationCount: recurring ? 1 : 0,
                oneTimeDonationCount: recurring ? 0 : 1,
                lastDonation: donation.created_at,
                missionary: {
                    id: donation.missionary_id,
                    name: getMissionaryNames(donation).join(', ') || donation.missionary_name
                },
                campus: donation.campus,
                donations: [toCampusDonationClientRow(donation, isAdmin)]
            });
        } else {
            const existing = donorMap.get(donorKey);
            existing.donationCount += 1;
            existing.recurringDonationCount += recurring ? 1 : 0;
            existing.oneTimeDonationCount += recurring ? 0 : 1;
            if (isAdmin) {
                addDonationAmount(existing.totalsByCurrency, donation);
            }
            // Update last donation if more recent
            if (new Date(donation.created_at) > new Date(existing.lastDonation)) {
                existing.lastDonation = donation.created_at;
            }
            existing.donations.push(toCampusDonationClientRow(donation, isAdmin));
            const latestMissionary = getMissionaryNames(donation).join(', ') || donation.missionary_name;
            if (latestMissionary) {
                existing.missionary = {
                    id: donation.missionary_id,
                    name: latestMissionary,
                };
            }
        }
    });

    const donors = Array.from(donorMap.values()).map((donor) => ({
        ...donor,
        givingType: donor.recurringDonationCount > 0 ? 'recurring' : 'one_time',
    }));

    const totalsByCurrency = isAdmin
        ? donations.reduce((totals, donation) => addDonationAmount(totals, donation), {})
        : null;
    const uniqueMissionaries = new Set();
    if (isAdmin) {
        donations.forEach(donation => {
            if (donation.missionary_id) uniqueMissionaries.add(donation.missionary_id);
            getMissionarySlugs(donation).forEach((slug) => uniqueMissionaries.add(slug));
        });
    }
    const stats = {
        totalDonors: donors.length,
        recurringDonors: donors.filter((donor) => donor.givingType === 'recurring').length,
        oneTimeDonors: donors.filter((donor) => donor.givingType === 'one_time').length,
        totalsByCurrency,
        activeMissionaries: isAdmin ? uniqueMissionaries.size : null,
    };

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 2500) {
        console.warn('[campus.donors] slow response', {
            elapsedMs,
            role,
            donationCount: donations.length,
            donorCount: donors.length,
            isAdmin,
            isCampusMissionary,
        });
    }

    return new Response(JSON.stringify({
        ok: true,
        donors,
        stats,
        isAdmin,
        isCampusMissionary
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
