import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const GET: APIRoute = async ({ request, clientAddress }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    const creatorProfile = await ensureUserProfile(user);

    if (!creatorProfile) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const { role: creatorRole, church_id: creatorChurchId, country: creatorCountry } = creatorProfile;

    if (isAdminRole(creatorRole)) {
        const ipCheck = await enforceAdminIp({
            request,
            clientAddress,
            identifier: 'portal.admin.users.list',
            allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
        });
        if (!ipCheck.ok) {
            return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
                status: 403,
                headers: { 'content-type': 'application/json' }
            });
        }
    }

    const memberships = await listUserMemberships(user.id);
    const activeMembership = memberships.find((m: any) =>
        ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    const hasAdminMembership = activeMembership?.role === 'church_admin';
    const hasMemberMembership = activeMembership?.role === 'church_member';
    let effectiveRole = creatorRole;
    if (!['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'].includes(creatorRole)) {
        if (hasAdminMembership) {
            effectiveRole = 'pastor';
        } else if (hasMemberMembership) {
            effectiveRole = 'local_collaborator';
        }
    }
    const effectiveChurchId = creatorChurchId || activeMembership?.church?.id || null;

    // Allowed roles to view list
    const allowedViewers = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'];
    if (!allowedViewers.includes(effectiveRole)) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    let query = supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name, full_name, email, role, church_id, updated_at, country')
        .order('updated_at', { ascending: false });

    // Scoping Logic
    if (effectiveRole === 'admin') {
        // Admins cannot see Superadmins
        query = query.neq('role', 'superadmin');
    } else if (effectiveRole === 'national_pastor') {
        // Scope by Country
        if (!creatorCountry) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('country', creatorCountry);
    } else if (effectiveRole === 'pastor' || effectiveRole === 'local_collaborator') {
        // Scope by Church
        if (!effectiveChurchId) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('church_id', effectiveChurchId);
    }
    // Superadmin sees everything (no scope applied)

    const { data: users, error } = await query.limit(100);

    if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, users }), { status: 200 });
};
