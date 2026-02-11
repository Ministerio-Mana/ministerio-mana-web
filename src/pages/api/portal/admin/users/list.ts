import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const GET: APIRoute = async ({ request, clientAddress }) => {
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

    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    // Get Creator Profile
    const { data: creatorProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('church_id, role, country')
        .eq('user_id', user.id)
        .single();

    if (!creatorProfile) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const { role: creatorRole, church_id: creatorChurchId, country: creatorCountry } = creatorProfile;

    // Allowed roles to view list
    const allowedViewers = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'];
    if (!allowedViewers.includes(creatorRole)) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    let query = supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name, full_name, email, role, church_id, updated_at, country')
        .order('updated_at', { ascending: false });

    // Scoping Logic
    if (creatorRole === 'admin') {
        // Admins cannot see Superadmins
        query = query.neq('role', 'superadmin');
    } else if (creatorRole === 'national_pastor') {
        // Scope by Country
        if (!creatorCountry) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('country', creatorCountry);
    } else if (creatorRole === 'pastor' || creatorRole === 'local_collaborator') {
        // Scope by Church
        if (!creatorChurchId) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('church_id', creatorChurchId);
    }
    // Superadmin sees everything (no scope applied)

    const { data: users, error } = await query.limit(100);

    if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, users }), { status: 200 });
};
