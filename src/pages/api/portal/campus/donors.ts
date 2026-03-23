import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

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

    const donationSelect = 'id, donor_name, donor_email, donor_phone, amount, currency, created_at, missionary_id, missionary_name, campus, status';

    let donations: any[] = [];
    let error: any = null;

    if (isCampusMissionary && user?.id) {
        // Primary scope: strict ownership by missionary_id.
        const byId = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .eq('status', 'APPROVED')
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
                .eq('status', 'APPROVED')
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
    } else {
        // Admins/Superadmins: global view.
        const globalRows = await supabaseAdmin
            .from('donations')
            .select(donationSelect)
            .eq('status', 'APPROVED')
            .order('created_at', { ascending: false })
            .limit(200);
        error = globalRows.error;
        donations = globalRows.data || [];
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
                    name: donation.missionary_name
                },
                campus: donation.campus
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
