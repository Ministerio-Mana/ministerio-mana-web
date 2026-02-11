import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { sendAuthLink } from '@lib/authMailer';
import { checkLeakedPassword, formatPasswordErrors, validatePasswordStrength } from '@lib/passwordSecurity';
import { normalizeCountryRegion } from '@lib/normalization';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const POST: APIRoute = async ({ request, clientAddress }) => {
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

    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    // Get Creator Profile to check Role + Church + Country
    const { data: creatorProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('church_id, role, country')
        .eq('user_id', user.id)
        .single();

    if (!creatorProfile) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
    }

    const { role: creatorRole } = creatorProfile;

    // Roles allowed to create users
    const allowedCreators = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'];
    if (!allowedCreators.includes(creatorRole)) {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear usuarios' }), { status: 403 });
    }

    const body = await request.json();
    const { email, password, firstName, lastName, role, churchId, country } = body;

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
    const targetRole = role || 'user';
    let allowedTargetRoles: string[] = [];

    if (creatorRole === 'superadmin') {
        allowedTargetRoles = ['superadmin', 'admin', 'national_pastor', 'campus_missionary', 'pastor', 'local_collaborator', 'user'];
    } else if (creatorRole === 'admin') {
        allowedTargetRoles = ['national_pastor', 'campus_missionary', 'pastor', 'local_collaborator', 'user'];
    } else if (creatorRole === 'national_pastor') {
        allowedTargetRoles = ['campus_missionary', 'pastor', 'local_collaborator', 'user'];
    } else if (creatorRole === 'pastor') {
        allowedTargetRoles = ['local_collaborator', 'user'];
    } else if (creatorRole === 'local_collaborator') {
        allowedTargetRoles = ['user'];
    }

    if (!allowedTargetRoles.includes(targetRole)) {
        return new Response(JSON.stringify({ ok: false, error: `No tienes permiso para crear un usuario con el rol: ${targetRole}` }), { status: 403 });
    }

    const requestedCountry = normalizeCountryRegion(country || '');
    const requestedChurchId = churchId || null;

    // Scope Assignment (Church / Country)
    let targetChurchId: string | null = null;
    let targetCountry: string | null = null;
    let targetChurchName: string | null = null;
    let targetCity: string | null = null;

    const needsChurch = ['pastor', 'local_collaborator'].includes(targetRole);
    const needsCountry = targetRole === 'national_pastor';

    let churchInfo: any = null;
    if (requestedChurchId) {
        const { data: church } = await supabaseAdmin
            .from('churches')
            .select('id, name, city, country')
            .eq('id', requestedChurchId)
            .maybeSingle();
        if (!church?.id) {
            return new Response(JSON.stringify({ ok: false, error: 'Iglesia no encontrada' }), { status: 404 });
        }
        churchInfo = church;
    }

    if (needsCountry) {
        if (creatorRole === 'national_pastor') {
            targetCountry = creatorProfile.country || null;
            if (!targetCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Tu usuario no tiene país asignado.' }), { status: 400 });
            }
        } else {
            if (!requestedCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país para el pastor nacional.' }), { status: 400 });
            }
            targetCountry = requestedCountry;
        }
    }

    if (needsChurch) {
        if (creatorRole === 'pastor' || creatorRole === 'local_collaborator') {
            targetChurchId = creatorProfile.church_id;
            if (!targetChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Error: Tu usuario no tiene una iglesia asignada.' }), { status: 400 });
            }
        } else if (creatorRole === 'national_pastor') {
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
