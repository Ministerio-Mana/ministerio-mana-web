import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { sendAuthLink } from '@lib/authMailer';
import { checkLeakedPassword, formatPasswordErrors, validatePasswordStrength } from '@lib/passwordSecurity';
import { normalizeCountryRegion } from '@lib/normalization';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { listUserMemberships, isAdminRole, resolveEffectivePortalRole, resolveEffectiveChurchId } from '@lib/portalAuth';
import {
    getRoleCapabilities,
    canCreateRole,
    getCreatableRoles,
    isCountryScopedRole,
    isNationalScopedRole,
    isRegionalScopedRole,
    needsChurchForRole,
    needsCountryForRole,
} from '@lib/portalRbac';

export const POST: APIRoute = async ({ request, clientAddress }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    // Get Creator Profile to check Role + Church + Country
    const { data: creatorProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('church_id, portal_church_id, region_id, role, country')
        .eq('user_id', user.id)
        .single();

    if (!creatorProfile) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const { role: creatorRole } = creatorProfile;

    if (isAdminRole(creatorRole)) {
        const ipCheck = await enforceAdminIp({
            request,
            clientAddress,
            identifier: 'portal.admin.users.create',
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
    const capabilities = getRoleCapabilities(effectiveRole);
    if (!capabilities.can_create_users) {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear usuarios' }), { status: 403 });
    }
    const creatableRoles = getCreatableRoles(effectiveRole);
    if (!creatableRoles.length) {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear usuarios' }), { status: 403 });
    }

    const body = await request.json();
    const { email, password, firstName, lastName, role, churchId, country, regionId } = body;

    if (!email || !password || !firstName || !lastName) {
        return new Response(JSON.stringify({ ok: false, error: 'Faltan campos requeridos' }), { status: 400 });
    }

    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
        return new Response(JSON.stringify({ ok: false, error: formatPasswordErrors(strength.errors) }), { status: 400 });
    }

    const leaked = await checkLeakedPassword(password);
    if (leaked.leaked) {
        return new Response(JSON.stringify({ ok: false, error: 'Esta contraseña aparece en filtraciones conocidas. Elige otra.' }), { status: 400 });
    }
    if (!leaked.checked && leaked.error) {
        console.warn('[create-user] HIBP check failed:', leaked.error);
    }

    // Role Hierarchy Validation
    const targetRole = String(role || 'user');
    if (!canCreateRole(effectiveRole, targetRole)) {
        return new Response(JSON.stringify({ ok: false, error: `No tienes permiso para crear un usuario con el rol: ${targetRole}` }), { status: 403 });
    }

    const requestedCountry = normalizeCountryRegion(country || '');
    const requestedChurchId = churchId || null;
    const requestedRegionId = String(regionId || '').trim() || null;

    // Scope Assignment (Church / Country)
    let targetChurchId: string | null = null;
    let targetCountry: string | null = null;
    let targetRegionId: string | null = null;
    let targetChurchName: string | null = null;
    let targetCity: string | null = null;

    const needsChurch = needsChurchForRole(targetRole);
    const needsCountry = needsCountryForRole(targetRole);

    let churchInfo: any = null;
    let regionInfo: any = null;

    if (requestedRegionId) {
        const { data: region } = await supabaseAdmin
            .from('regions')
            .select('id, country, code, name')
            .eq('id', requestedRegionId)
            .maybeSingle();
        if (!region?.id) {
            return new Response(JSON.stringify({ ok: false, error: 'Región no encontrada' }), { status: 404 });
        }
        regionInfo = region;
    }

    if (requestedChurchId) {
        const { data: church } = await supabaseAdmin
            .from('churches')
            .select('id, name, city, country, region_id')
            .eq('id', requestedChurchId)
            .maybeSingle();
        if (!church?.id) {
            return new Response(JSON.stringify({ ok: false, error: 'Iglesia no encontrada' }), { status: 404 });
        }
        churchInfo = church;
    }

    if (needsCountry) {
        if (isRegionalScopedRole(effectiveRole)) {
            targetCountry = creatorProfile.country || churchInfo?.country || null;
            if (!targetCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Tu usuario no tiene país asignado.' }), { status: 400 });
            }
        } else if (isCountryScopedRole(effectiveRole)) {
            targetCountry = creatorProfile.country || null;
            if (!targetCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Tu usuario no tiene país asignado.' }), { status: 400 });
            }
        } else {
            // Admin/superadmin: permite deducir país desde región para roles regionales.
            if (isRegionalScopedRole(targetRole) && regionInfo?.country) {
                targetCountry = regionInfo.country;
            } else {
                if (!requestedCountry) {
                    return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país para este rol.' }), { status: 400 });
                }
                targetCountry = requestedCountry;
            }
        }
    }

    if (needsChurch) {
        if (effectiveRole === 'pastor' || effectiveRole === 'local_collaborator') {
            targetChurchId = resolveEffectiveChurchId(
                creatorProfile.church_id || creatorProfile.portal_church_id || null,
                memberships,
            );
            if (!targetChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Error: Tu usuario no tiene una iglesia asignada.' }), { status: 400 });
            }
        } else if (isRegionalScopedRole(effectiveRole)) {
            if (!requestedChurchId || !churchInfo?.id) {
                return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
            }
            if (!creatorProfile.region_id) {
                return new Response(JSON.stringify({ ok: false, error: 'Tu usuario no tiene región asignada.' }), { status: 400 });
            }
            if (!churchInfo.region_id || churchInfo.region_id !== creatorProfile.region_id) {
                return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
            }
            targetChurchId = churchInfo.id;
        } else if (isCountryScopedRole(effectiveRole) || isNationalScopedRole(effectiveRole)) {
            if (!requestedChurchId || !churchInfo?.id) {
                return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
            }
            if (creatorProfile.country && churchInfo.country !== creatorProfile.country) {
                return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
            }
            targetChurchId = churchInfo.id;
        } else {
            if (!requestedChurchId || !churchInfo?.id) {
                return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
            }
            targetChurchId = churchInfo.id;
        }
    }

    if (isRegionalScopedRole(targetRole)) {
        targetRegionId = requestedRegionId || churchInfo?.region_id || creatorProfile.region_id || null;
        if (!targetRegionId) {
            return new Response(JSON.stringify({ ok: false, error: 'Selecciona una región para este rol.' }), { status: 400 });
        }
        if (!regionInfo && targetRegionId) {
            const { data: region } = await supabaseAdmin
                .from('regions')
                .select('id, country, code, name')
                .eq('id', targetRegionId)
                .maybeSingle();
            regionInfo = region || null;
        }
        if (regionInfo?.country) {
            if (targetCountry && normalizeCountryRegion(targetCountry) !== normalizeCountryRegion(regionInfo.country)) {
                return new Response(JSON.stringify({ ok: false, error: 'La región no coincide con el país seleccionado.' }), { status: 400 });
            }
            targetCountry = regionInfo.country;
        }
    } else if (churchInfo?.region_id) {
        targetRegionId = churchInfo.region_id;
    }

    if (churchInfo?.id) {
        targetChurchName = churchInfo.name || null;
        targetCity = churchInfo.city || null;
        if (!targetCountry) {
            targetCountry = churchInfo.country || null;
        }
    }

    // Backend Check: Ensure email doesn't exist already (Supabase createUser handles this, but good to check Profile)

    // Create Auth User
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm
        user_metadata: {
            first_name: firstName,
            last_name: lastName,
            full_name: `${firstName} ${lastName}`.trim()
        }
    });

    if (authError) {
        return new Response(JSON.stringify({ ok: false, error: authError.message }), { status: 400 });
    }

    if (!authData.user) {
        return new Response(JSON.stringify({ ok: false, error: 'Failed to create user' }), { status: 500 });
    }

    // Create Profile
    const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .upsert({
            user_id: authData.user.id,
            email: email,
            first_name: firstName,
            last_name: lastName,
            role: targetRole,
            church_id: targetChurchId,
            church_name: targetChurchName,
            city: targetCity,
            country: targetCountry, // Assign country if applicable
            region_id: targetRegionId,
            updated_at: new Date().toISOString()
        });

    if (profileError) {
        console.error('Profile Error', profileError);
    }

    // Send Welcome Email via SendGrid (Magic Link for existing user since we just created them)
    try {
        const emailResult = await sendAuthLink({
            kind: 'magiclink',
            email: email,
            redirectTo: `${new URL(request.url).origin}/portal`
        });

        if (!emailResult.ok) {
            console.warn('[create-user] Email not sent:', emailResult.error);
        }
    } catch (emailErr) {
        console.error('[create-user] Email error:', emailErr);
    }

    return new Response(JSON.stringify({ ok: true, userId: authData.user.id }), { status: 200 });
};
