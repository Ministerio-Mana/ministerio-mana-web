import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sendAuthLink } from '@lib/authMailer';
import { checkLeakedPassword, formatPasswordErrors, validatePasswordStrength } from '@lib/passwordSecurity';
import { normalizeCountryRegion } from '@lib/normalization';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';
import { MISIONEROS } from '@data/misioneros';
import {
  getPortalChurchAccessContext,
  mapPortalAccessError,
  type PortalChurchRole,
} from '@lib/portalAccess';
import {
  getRoleCapabilities,
  canCreateRole,
  getCreatableRoles,
  isRegionalScopedRole,
  needsChurchForRole,
  needsCountryForRole,
} from '@lib/portalRbac';
import { resolveBaseUrl } from '@lib/url';
import {
  financeAssignmentScopeLabel,
  normalizeFinanceAssignmentInput,
  type NormalizedFinanceAssignment,
} from '@lib/financeAssignments';
import { resolvePortalCountryFromDatabase } from '@lib/portalGeographyServer';

const MANAGEMENT_ALLOWED_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
  'national_pastor',
  'national_collaborator',
  'regional_pastor',
  'regional_collaborator',
  'pastor',
  'local_collaborator',
  'leader',
];

function sameCountry(left?: string | null, right?: string | null): boolean {
  return normalizeCountryRegion(left || '') === normalizeCountryRegion(right || '');
}

function isMissingColumnError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function isUniqueViolation(error: any): boolean {
  return String(error?.code || '') === '23505';
}

function isValidCampusMissionarySlug(value: string): boolean {
  return MISIONEROS.some((missionary) => missionary.slug === value);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
  }

  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(request);
  } catch (error) {
    console.warn('[create-user] Invalid host for base URL:', error);
    return new Response(JSON.stringify({ ok: false, error: 'Host no permitido' }), { status: 400 });
  }

  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: MANAGEMENT_ALLOWED_ROLES,
    allowPasswordSession: false,
  });

  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'No autorizado para crear usuarios');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const effectiveRole = String(access.role || 'user');

  const capabilities = getRoleCapabilities(effectiveRole);
  if (!capabilities.can_create_users) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear usuarios' }), { status: 403 });
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.users.create',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const creatableRoles = getCreatableRoles(effectiveRole);
  if (!creatableRoles.length) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear usuarios' }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const {
    email,
    password,
    firstName,
    lastName,
    role,
    churchId,
    country,
    regionId,
    campusMissionarySlug,
    financeScopeType,
    financeScopeId,
    financeScopeKey,
  } = body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedFirstName = String(firstName || '').trim();
  const normalizedLastName = String(lastName || '').trim();
  const fullName = `${normalizedFirstName} ${normalizedLastName}`.trim();
  const initialPassword = typeof password === 'string' ? password : '';
  const hasInitialPassword = initialPassword.length > 0;

  if (!normalizedEmail || !normalizedFirstName || !normalizedLastName) {
    return new Response(JSON.stringify({ ok: false, error: 'Faltan campos requeridos' }), { status: 400 });
  }

  if (access.email && normalizedEmail === access.email) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'No puedes crear otro usuario con el mismo correo de tu sesión actual.',
    }), { status: 409 });
  }

  const { data: existingProfilesByEmail, error: existingProfilesByEmailError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, role')
    .eq('email', normalizedEmail)
    .limit(5);

  if (existingProfilesByEmailError) {
    console.error('[create-user] existing profile lookup failed', existingProfilesByEmailError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar si el correo ya existe' }), { status: 500 });
  }

  if ((existingProfilesByEmail || []).length > 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Ese correo ya existe en el Portal. Usa la edición de rol o Reenviar acceso; no crees otro usuario con el mismo correo.',
    }), { status: 409 });
  }

  let existingUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  try {
    existingUser = await findAuthUserByEmail(normalizedEmail);
  } catch (error) {
    console.error('[create-user] user lookup failed', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el usuario destino' }), { status: 500 });
  }

  if (hasInitialPassword && existingUser?.id) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Ese correo ya existe en autenticación. Deja la contraseña vacía para enviar acceso si no tiene perfil, o usa Reenviar acceso si ya aparece en usuarios.',
    }), { status: 409 });
  }

  if (hasInitialPassword) {
    const strength = validatePasswordStrength(initialPassword);
    if (!strength.ok) {
      return new Response(JSON.stringify({ ok: false, error: formatPasswordErrors(strength.errors) }), { status: 400 });
    }

    const leaked = await checkLeakedPassword(initialPassword);
    if (leaked.leaked) {
      return new Response(JSON.stringify({ ok: false, error: 'Esta contraseña aparece en filtraciones conocidas. Elige otra.' }), { status: 400 });
    }
    if (!leaked.checked && leaked.error) {
      console.warn('[create-user] HIBP check failed:', leaked.error);
    }
  }

  const targetRole = String(role || 'user');
  const isFinanceOnboarding = targetRole === 'finance';
  if (isFinanceOnboarding && effectiveRole !== 'superadmin') {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Solo superadmin puede crear una cuenta del equipo financiero.',
    }), { status: 403 });
  }
  if (!canCreateRole(effectiveRole, targetRole)) {
    return new Response(JSON.stringify({ ok: false, error: `No tienes permiso para crear un usuario con el rol: ${targetRole}` }), { status: 403 });
  }

  let financeAssignmentInput: Omit<NormalizedFinanceAssignment, 'userId'> | null = null;
  if (isFinanceOnboarding) {
    const normalizedFinance = normalizeFinanceAssignmentInput({
      userId: '00000000-0000-4000-8000-000000000000',
      scopeType: financeScopeType,
      scopeId: financeScopeId,
      scopeKey: financeScopeKey,
    });
    if (!normalizedFinance.ok) {
      return new Response(JSON.stringify({ ok: false, error: normalizedFinance.error }), { status: 400 });
    }
    financeAssignmentInput = {
      scopeType: normalizedFinance.value.scopeType,
      scopeId: normalizedFinance.value.scopeId,
      scopeKey: normalizedFinance.value.scopeKey,
    };

    if (financeAssignmentInput.scopeType === 'country') {
      const resolvedFinanceCountry = await resolvePortalCountryFromDatabase(financeAssignmentInput.scopeKey);
      if (!resolvedFinanceCountry.ok) {
        console.error('[create-user] finance country catalog failed', resolvedFinanceCountry.error);
        return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el país financiero.' }), { status: 500 });
      }
      if (!resolvedFinanceCountry.country) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país disponible en el Portal.' }), { status: 400 });
      }
    }

    const readiness = await supabaseAdmin
      .from('portal_role_assignments')
      .select('id', { head: true })
      .limit(1);
    if (readiness.error) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Los alcances financieros todavía no están disponibles. Verifica la migración financiera antes de crear esta cuenta.',
      }), { status: 409 });
    }
  }
  const requestedCampusMissionarySlug = String(campusMissionarySlug || '').trim();
  if (targetRole === 'campus_missionary' && !requestedCampusMissionarySlug) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona el misionero Campus que corresponde a esta cuenta' }), { status: 400 });
  }
  if (
    targetRole === 'campus_missionary'
    && requestedCampusMissionarySlug
    && !isValidCampusMissionarySlug(requestedCampusMissionarySlug)
  ) {
    return new Response(JSON.stringify({ ok: false, error: 'Misionero Campus no válido' }), { status: 400 });
  }

  const requestedCountry = normalizeCountryRegion(country || '');
  const requestedChurchId = String(churchId || '').trim() || null;
  const requestedRegionId = String(regionId || '').trim() || null;

  let targetChurchId: string | null = null;
  let targetCountry: string | null = null;
  let targetRegionId: string | null = null;
  let targetChurchName: string | null = null;
  let targetCity: string | null = null;

  const needsChurch = needsChurchForRole(targetRole);
  const needsCountry = needsCountryForRole(targetRole);

  const creatorScopedCountry = access.allowedCountry || access.profile?.country || null;

  let churchInfo: any = null;
  let regionInfo: any = null;
  let financeRegionInfo: any = null;
  let financeChurchInfo: any = null;

  if (financeAssignmentInput?.scopeType === 'region' && financeAssignmentInput.scopeId) {
    const { data: region, error } = await supabaseAdmin
      .from('regions')
      .select('id, country, code, name, is_active')
      .eq('id', financeAssignmentInput.scopeId)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !region?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'La región financiera seleccionada no está disponible.' }), { status: 400 });
    }
    financeRegionInfo = region;
  }

  if (financeAssignmentInput?.scopeType === 'church' && financeAssignmentInput.scopeId) {
    const { data: church, error } = await supabaseAdmin
      .from('churches')
      .select('id, name, city, country')
      .eq('id', financeAssignmentInput.scopeId)
      .maybeSingle();
    if (error || !church?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'La iglesia financiera seleccionada no está disponible.' }), { status: 400 });
    }
    financeChurchInfo = church;
  }

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
    if (access.isRegional || access.isNational) {
      targetCountry = creatorScopedCountry || churchInfo?.country || regionInfo?.country || null;
      if (!targetCountry) {
        return new Response(JSON.stringify({ ok: false, error: 'Tu usuario no tiene país asignado.' }), { status: 400 });
      }
    } else {
      if (isRegionalScopedRole(targetRole) && regionInfo?.country) {
        targetCountry = regionInfo.country;
      } else {
        if (!requestedCountry) {
          return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país para este rol.' }), { status: 400 });
        }
        const resolvedCountry = await resolvePortalCountryFromDatabase(requestedCountry);
        if (!resolvedCountry.ok) {
          console.error('[create-user] country catalog failed', resolvedCountry.error);
          return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el país.' }), { status: 500 });
        }
        if (!resolvedCountry.country) {
          return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país disponible en el Portal.' }), { status: 400 });
        }
        targetCountry = resolvedCountry.country;
      }
    }
  }

  if (needsChurch) {
    if (access.allowedChurchId) {
      targetChurchId = access.allowedChurchId;
      if (requestedChurchId && requestedChurchId !== targetChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
      }
      if (!churchInfo || churchInfo.id !== targetChurchId) {
        const { data: church } = await supabaseAdmin
          .from('churches')
          .select('id, name, city, country, region_id')
          .eq('id', targetChurchId)
          .maybeSingle();
        churchInfo = church || null;
      }
    } else if (access.isRegional) {
      if (!requestedChurchId || !churchInfo?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
      }

      const churchRegionId = String(churchInfo.region_id || '').trim() || null;
      const inRegionScope = churchRegionId ? access.allowedRegionIds.includes(churchRegionId) : false;

      if (!inRegionScope) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
      }

      targetChurchId = churchInfo.id;
    } else if (access.isNational) {
      if (!requestedChurchId || !churchInfo?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
      }
      if (!creatorScopedCountry || !sameCountry(churchInfo.country, creatorScopedCountry)) {
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
    if (access.isRegional) {
      if (requestedRegionId) {
        if (!access.allowedRegionIds.includes(requestedRegionId)) {
          return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esa región.' }), { status: 403 });
        }
        targetRegionId = requestedRegionId;
      } else if (churchInfo?.region_id && access.allowedRegionIds.includes(churchInfo.region_id)) {
        targetRegionId = churchInfo.region_id;
      } else if (access.allowedRegionIds.length === 1) {
        targetRegionId = access.allowedRegionIds[0];
      } else {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una región dentro de tu alcance.' }), { status: 400 });
      }
    } else {
      targetRegionId = requestedRegionId || churchInfo?.region_id || null;
      if (!targetRegionId) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una región para este rol.' }), { status: 400 });
      }
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
      if (targetCountry && !sameCountry(targetCountry, regionInfo.country)) {
        return new Response(JSON.stringify({ ok: false, error: 'La región no coincide con el país seleccionado.' }), { status: 400 });
      }
      targetCountry = regionInfo.country;
    }

    if (access.isNational && creatorScopedCountry && targetCountry && !sameCountry(targetCountry, creatorScopedCountry)) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esa región.' }), { status: 403 });
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

  const resolvedCampusMissionarySlug = targetRole === 'campus_missionary'
    ? requestedCampusMissionarySlug
    : null;
  let campusSlugOwnerUserId: string | null = null;

  if (resolvedCampusMissionarySlug) {
    const { data: slugOwner, error: slugOwnerError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('campus_missionary_slug', resolvedCampusMissionarySlug)
      .maybeSingle();

    if (slugOwnerError && !isMissingColumnError(slugOwnerError)) {
      console.error('[create-user] campus slug owner check error', slugOwnerError);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el misionero Campus' }), { status: 500 });
    }

    campusSlugOwnerUserId = slugOwner?.user_id ? String(slugOwner.user_id) : null;
  }

  let userId: string | null = null;
  const activationRedirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;
  let accessEmailSent = false;
  let accessEmailMethod: string | null = null;
  let accessEmailError: string | null = null;

  if (hasInitialPassword) {
    if (campusSlugOwnerUserId) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Ese misionero Campus ya está asignado a otro usuario.',
      }), { status: 409 });
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: initialPassword,
      email_confirm: true,
      user_metadata: {
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        full_name: fullName,
      },
    });

    if (authError) {
      return new Response(JSON.stringify({ ok: false, error: authError.message }), { status: 400 });
    }

    if (!authData.user) {
      return new Response(JSON.stringify({ ok: false, error: 'Failed to create user' }), { status: 500 });
    }
    userId = authData.user.id;
  } else {
    if (campusSlugOwnerUserId && campusSlugOwnerUserId !== String(existingUser?.id || '')) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Ese misionero Campus ya está asignado a otro usuario.',
      }), { status: 409 });
    }

    const linkResult = await sendAuthLink({
      kind: existingUser?.id ? 'recovery' : 'invite',
      email: normalizedEmail,
      redirectTo: activationRedirectTo,
    });

    if (!linkResult.ok) {
      console.error('[create-user] invite link error', linkResult.error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar invitación' }), { status: 500 });
    }

    userId = existingUser?.id || linkResult.userId || null;
    accessEmailSent = true;
    accessEmailMethod = linkResult.method;
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear usuario' }), { status: 500 });
    }
  }

  let financeAssignmentCreated = false;
  let financeAssignmentId: string | null = null;
  let financeAssignmentError: string | null = null;
  if (financeAssignmentInput && userId) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('portal_role_assignments')
      .insert({
        user_id: userId,
        role: 'finance',
        scope_type: financeAssignmentInput.scopeType,
        scope_id: financeAssignmentInput.scopeId,
        scope_key: financeAssignmentInput.scopeKey,
        status: 'active',
        created_by: access.userId,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (assignmentError) {
      console.error('[create-user] finance assignment error', assignmentError);
      financeAssignmentError = 'La cuenta se creó, pero no se pudo activar su alcance financiero.';
    } else {
      financeAssignmentCreated = true;
      financeAssignmentId = assignment?.id || null;
    }
  }

  const profilePayload: Record<string, unknown> = {
    user_id: userId,
    email: normalizedEmail,
    first_name: normalizedFirstName,
    last_name: normalizedLastName,
    full_name: fullName,
    role: isFinanceOnboarding && !financeAssignmentCreated ? 'user' : targetRole,
    church_id: targetChurchId,
    church_name: targetChurchName,
    city: targetCity,
    country: targetCountry,
    region_id: targetRegionId,
    updated_at: new Date().toISOString(),
  };
  if (resolvedCampusMissionarySlug) {
    profilePayload.campus_missionary_slug = resolvedCampusMissionarySlug;
  }

  let { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert(profilePayload, { onConflict: 'user_id' });

  if (profileError && resolvedCampusMissionarySlug && isMissingColumnError(profileError)) {
    delete profilePayload.campus_missionary_slug;
    const fallback = await supabaseAdmin
      .from('user_profiles')
      .upsert(profilePayload, { onConflict: 'user_id' });
    profileError = fallback.error;
  }

  if (profileError) {
    console.error('Profile Error', profileError);
    if (financeAssignmentId) {
      await supabaseAdmin.from('portal_role_assignments').delete().eq('id', financeAssignmentId);
    }
    if (isUniqueViolation(profileError)) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Ese correo o misionero Campus ya está asignado a otro usuario.',
      }), { status: 409 });
    }
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar el perfil del usuario' }), { status: 500 });
  }

  if (hasInitialPassword) {
    try {
      const emailResult = await sendAuthLink({
        kind: 'recovery',
        email: normalizedEmail,
        redirectTo: activationRedirectTo,
      });

      accessEmailSent = emailResult.ok;
      accessEmailMethod = emailResult.method;
      accessEmailError = emailResult.ok ? null : emailResult.error || 'No se pudo enviar el correo';
      if (!emailResult.ok) {
        console.warn('[create-user] access email not sent:', emailResult.error);
      }
    } catch (emailErr) {
      console.error('[create-user] Email error:', emailErr);
      accessEmailSent = false;
      accessEmailError = emailErr instanceof Error ? emailErr.message : 'No se pudo enviar el correo';
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    userId,
    inviteSent: !hasInitialPassword,
    accessEmailSent,
    accessEmailMethod,
    accessEmailError,
    campusMissionarySlug: resolvedCampusMissionarySlug,
    financeAssignmentCreated,
    financeAssignmentError,
    financeScopeLabel: financeAssignmentInput
      ? financeAssignmentScopeLabel({
          scopeType: financeAssignmentInput.scopeType,
          scopeKey: financeAssignmentInput.scopeKey,
          regionLabel: financeRegionInfo
            ? [financeRegionInfo.code, financeRegionInfo.name, financeRegionInfo.country].filter(Boolean).join(' · ')
            : null,
          churchLabel: financeChurchInfo
            ? [financeChurchInfo.name, financeChurchInfo.city, financeChurchInfo.country].filter(Boolean).join(' · ')
            : null,
        })
      : null,
  }), { status: 200 });
};
