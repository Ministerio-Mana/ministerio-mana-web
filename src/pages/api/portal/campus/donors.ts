import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { MISIONEROS } from '@data/misioneros';

export const prerender = false;

const CAMPUS_STATUSES = ['PAID', 'APPROVED'];

const donationSelect = [
    'id',
    'donor_name',
    'donor_email',
    'donor_phone',
    'amount',
    'currency',
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

function normalizeMissionaryName(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isMissingColumnError(error: any): boolean {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function getAmountPerMissionary(donation: any): number | null {
    const raw = donation?.raw_event;
    const value = raw?.amountPerMissionary ?? raw?.amount_per_missionary;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getMissionarySlugs(donation: any): string[] {
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
    return {
        id: donation.id,
        created_at: donation.created_at,
        reference: donation.reference,
        provider: donation.provider,
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
    };
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
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
    }

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
    }

    let userProfile: { user_id?: string; role?: string; full_name?: string | null } | null = null;
    if (user) {
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('user_id, role, full_name')
            .eq('user_id', user.id)
            .single();
        userProfile = profile ?? null;
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
        // Primary scope: strict ownership by missionary_id.
        const byId = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .in('status', CAMPUS_STATUSES)
            .eq('missionary_id', user.id)
            .order('created_at', { ascending: false })
            .limit(200);
        if (byId.error) {
            error = byId.error;
        } else {
            donations = byId.data || [];
        }

        // Fallback scope: legacy rows where only missionary_name was saved.
        const fullName = String(userProfile?.full_name || '').trim();
        if (!error && fullName) {
            const byName = await supabaseAdmin
                .from('donations')
                .select(donationSelect)
                .in('status', CAMPUS_STATUSES)
                .ilike('missionary_name', `%${fullName}%`)
                .order('created_at', { ascending: false })
                .limit(200);
            if (byName.error) {
                error = byName.error;
            } else {
                const dedupe = new Set(donations.map((d) => d.id));
                (byName.data || []).forEach((row: any) => {
                    if (!dedupe.has(row.id)) donations.push(row);
                });
                donations.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                donations = donations.slice(0, 200);
            }
        }

        const missionarySlug = MISIONEROS.find((m) => (
            normalizeMissionaryName(m.nombre) === normalizeMissionaryName(fullName)
        ))?.slug;
        if (!error && missionarySlug) {
            const byRawEvent = await supabaseAdmin
                .from('donations')
                .select(donationSelect)
                .in('status', CAMPUS_STATUSES)
                .contains('raw_event', { missionaries: [missionarySlug] })
                .order('created_at', { ascending: false })
                .limit(200);
            if (byRawEvent.error) {
                error = byRawEvent.error;
            } else {
                const dedupe = new Set(donations.map((d) => d.id));
                (byRawEvent.data || []).forEach((row: any) => {
                    if (!dedupe.has(row.id)) donations.push(row);
                });
                donations.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                donations = donations.slice(0, 200);
            }
        }
    } else {
        // Admins/Superadmins: Campus-only view. The global donations ledger lives in /portal/donations.
        const campusRows = await loadCampusDonationsBase();
        error = campusRows.error;
        donations = campusRows.data || [];
    }

    if (error) {
        console.error('[campus.donors] Error:', error);
        return new Response(JSON.stringify({ ok: false, error: 'Failed to load donors' }), { status: 500 });
    }

    // Group donations by donor
    const donorMap = new Map();

    donations.forEach((donation) => {
        const donorKey = donation.donor_email || donation.donor_name || 'unknown';

        if (!donorMap.has(donorKey)) {
            donorMap.set(donorKey, {
                name: donation.donor_name || 'Donante Anónimo',
                email: donation.donor_email,
                phone: donation.donor_phone,
                // Only include amounts for admins
                totalAmount: isAdmin ? donation.amount : null,
                currency: isAdmin ? donation.currency : null,
                donationCount: 1,
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
            if (isAdmin) {
                existing.totalAmount = (existing.totalAmount || 0) + (donation.amount || 0);
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

    const donors = Array.from(donorMap.values());

    // Calculate stats (only for admins)
    let stats = null;
    if (isAdmin) {
        const totalDonors = donors.length;
        const totalAmount = donors.reduce((sum, d) => sum + (d.totalAmount || 0), 0);

        // Count unique missionaries
        const uniqueMissionaries = new Set();
        donations.forEach(d => {
            if (d.missionary_id) uniqueMissionaries.add(d.missionary_id);
            getMissionarySlugs(d).forEach((slug) => uniqueMissionaries.add(slug));
        });

        stats = {
            totalDonors,
            totalAmount,
            currency: donations[0]?.currency || 'USD',
            activeMissionaries: uniqueMissionaries.size
        };
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
