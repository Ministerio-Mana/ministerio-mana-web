import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import {
    ensureUserProfile,
    listUserMemberships,
    isAdminRole,
    resolveEffectivePortalRole,
    resolveEffectiveChurchId,
} from '@lib/portalAuth';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { getRoleCapabilities, isCountryScopedRole, isNationalScopedRole, isRegionalScopedRole } from '@lib/portalRbac';

export const GET: APIRoute = async ({ request, clientAddress }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    const creatorProfile = await ensureUserProfile(user);

    if (!creatorProfile) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const {
        role: creatorRole,
        church_id: creatorChurchId,
        portal_church_id: creatorPortalChurchId,
        country: creatorCountry,
        region_id: creatorRegionId,
    } = creatorProfile as any;

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
    const effectiveRole = resolveEffectivePortalRole(creatorRole, memberships);
    const effectiveChurchId = resolveEffectiveChurchId(creatorChurchId || creatorPortalChurchId || null, memberships);
    const capabilities = getRoleCapabilities(effectiveRole);

    if (!capabilities.can_manage_users) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    let query = supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name, full_name, email, role, church_id, portal_church_id, region_id, church_name, city, country, created_at, updated_at')
        .order('updated_at', { ascending: false });

    // Scoping Logic
    if (effectiveRole === 'admin') {
        // Admins cannot see Superadmins
        query = query.neq('role', 'superadmin');
    } else if (isRegionalScopedRole(effectiveRole)) {
        // Regional scoped roles
        if (!creatorRegionId) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('region_id', creatorRegionId);
    } else if (isNationalScopedRole(effectiveRole) || isCountryScopedRole(effectiveRole)) {
        // National scoped roles
        if (!creatorCountry) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.eq('country', creatorCountry);
    } else if (effectiveRole === 'pastor' || effectiveRole === 'local_collaborator') {
        // Scope by Church
        if (!effectiveChurchId) {
            return new Response(JSON.stringify({ ok: true, users: [] }), { status: 200 });
        }
        query = query.or(`church_id.eq.${effectiveChurchId},portal_church_id.eq.${effectiveChurchId}`);
    }
    // Superadmin sees everything (no scope applied)

    const { data: users, error } = await query.limit(200);

    if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }

    const churchIds = Array.from(new Set((users || [])
        .map((profile: any) => profile?.church_id || profile?.portal_church_id || null)
        .filter(Boolean)));
    const regionIds = Array.from(new Set((users || [])
        .map((profile: any) => profile?.region_id || null)
        .filter(Boolean)));
    const churchMap = new Map<string, any>();
    const regionMap = new Map<string, any>();
    if (churchIds.length) {
        const { data: churches, error: churchesError } = await supabaseAdmin
            .from('churches')
            .select('id, name, city, country')
            .in('id', churchIds);
        if (churchesError) {
            console.error('[portal.admin.users.list] churches error', churchesError);
        } else {
            (churches || []).forEach((church: any) => {
                if (!church?.id) return;
                churchMap.set(church.id, church);
            });
        }
    }
    if (regionIds.length) {
        const { data: regions, error: regionsError } = await supabaseAdmin
            .from('regions')
            .select('id, country, code, name, is_active')
            .in('id', regionIds);
        if (regionsError) {
            if (regionsError.code !== '42P01') {
                console.error('[portal.admin.users.list] regions error', regionsError);
            }
        } else {
            (regions || []).forEach((region: any) => {
                if (!region?.id) return;
                regionMap.set(region.id, region);
            });
        }
    }

    const authUsersByEmail = new Map<string, any>();
    let page = 1;
    const perPage = 200;
    while (page <= 10) {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (authError) {
            console.error('[portal.admin.users.list] auth list error', authError);
            break;
        }
        const authUsers = authData?.users || [];
        authUsers.forEach((authUser: any) => {
            const email = String(authUser?.email || '').toLowerCase();
            if (!email) return;
            authUsersByEmail.set(email, authUser);
        });
        if (authUsers.length < perPage) break;
        page += 1;
    }

    const now = Date.now();
    const enrichedUsers = (users || []).map((profile: any) => {
        const email = String(profile?.email || '').toLowerCase();
        const authUser = authUsersByEmail.get(email);
        const invitedAt = authUser?.invited_at || null;
        const emailConfirmedAt = authUser?.email_confirmed_at || null;
        const lastSignInAt = authUser?.last_sign_in_at || null;
        const bannedUntil = authUser?.banned_until || null;
        const isBlocked = bannedUntil ? new Date(bannedUntil).getTime() > now : false;

        let accessStatus = 'pending';
        if (isBlocked) {
            accessStatus = 'blocked';
        } else if (!authUser) {
            accessStatus = 'unknown';
        } else if (!emailConfirmedAt && invitedAt) {
            accessStatus = 'invited';
        } else if (!emailConfirmedAt) {
            accessStatus = 'pending';
        } else if (lastSignInAt) {
            accessStatus = 'active';
        } else {
            accessStatus = 'confirmed';
        }

        const resolvedChurchId = profile?.church_id || profile?.portal_church_id || null;
        return {
            ...profile,
            church: resolvedChurchId ? (churchMap.get(resolvedChurchId) || null) : null,
            region: profile?.region_id ? (regionMap.get(profile.region_id) || null) : null,
            full_name: profile?.full_name
                || authUser?.user_metadata?.full_name
                || [authUser?.user_metadata?.first_name, authUser?.user_metadata?.last_name].filter(Boolean).join(' ')
                || null,
            access_status: accessStatus,
            invited_at: invitedAt,
            email_confirmed_at: emailConfirmedAt,
            last_sign_in_at: lastSignInAt,
            is_blocked: isBlocked,
        };
    });

    return new Response(JSON.stringify({ ok: true, users: enrichedUsers }), { status: 200 });
};
