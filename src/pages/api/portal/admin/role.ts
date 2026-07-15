import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { MISIONEROS } from '@data/misioneros';
import { getPortalRoleDefinition } from '@lib/portalRbac';
import { resolvePortalCountryFromDatabase } from '@lib/portalGeographyServer';
import { isFinanceUuid } from '@lib/financeScope';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null, userId: null };
    }
    return { ok: true, role: profile.role, userId: user.id };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null, userId: null };
  }
  return { ok: true, role: 'superadmin', userId: null };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.role',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAdminContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (ctx.role !== 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'Solo superadmin puede actualizar este rol' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!isFinanceUuid(String(payload?.userId || '')) || !payload?.role) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const desiredRole = String(payload.role);
  const roleDefinition = getPortalRoleDefinition(desiredRole);
  if (!roleDefinition || desiredRole === 'finance' || roleDefinition.legacy) {
    return new Response(JSON.stringify({
      ok: false,
      error: desiredRole === 'finance'
        ? 'Finanzas se asigna como permiso adicional con alcance desde el botón Finanzas.'
        : 'Selecciona un rol principal activo.',
    }), {
      status: desiredRole === 'finance' ? 409 : 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const requestedCampusMissionarySlug = String(payload.campusMissionarySlug || '').trim();
  if (
    desiredRole === 'campus_missionary'
    && !MISIONEROS.some((missionary) => missionary.slug === requestedCampusMissionarySlug)
  ) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona un misionero Campus válido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role, country, city, church_id, portal_church_id, region_id, campus_missionary_slug')
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (targetProfileError) {
    console.error('[portal.admin.role] target fetch error', targetProfileError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el usuario' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!targetProfile?.user_id) {
    return new Response(JSON.stringify({ ok: false, error: 'Usuario no encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (ctx.userId && targetProfile.user_id === ctx.userId && desiredRole !== 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'No puedes quitarte el rol superadmin a ti mismo' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const requestedCountry = String(payload.country || '').trim();
  const requestedRegionId = String(payload.regionId || '').trim().toLowerCase();
  const requestedChurchId = String(payload.churchId || '').trim().toLowerCase();
  let resolvedCountry: string | null = null;
  let resolvedRegionId: string | null = null;
  let resolvedChurchId: string | null = null;
  let resolvedChurchName: string | null = null;
  let resolvedCity: string | null = null;

  if (roleDefinition.scope === 'country') {
    const country = await resolvePortalCountryFromDatabase(requestedCountry);
    if (!country.ok) {
      console.error('[portal.admin.role] country catalog failed', country.error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el país.' }), { status: 500 });
    }
    if (!country.country) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona un país disponible en el Portal.' }), { status: 400 });
    }
    resolvedCountry = country.country;
  }

  if (roleDefinition.scope === 'region') {
    if (!isFinanceUuid(requestedRegionId)) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una región válida.' }), { status: 400 });
    }
    const { data: region, error: regionError } = await supabaseAdmin
      .from('regions')
      .select('id,country,is_active')
      .eq('id', requestedRegionId)
      .eq('is_active', true)
      .maybeSingle();
    if (regionError || !region?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'La región seleccionada no está disponible.' }), { status: 400 });
    }
    resolvedRegionId = region.id;
    resolvedCountry = region.country || null;
  }

  if (roleDefinition.scope === 'church') {
    if (!isFinanceUuid(requestedChurchId)) {
      return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia válida.' }), { status: 400 });
    }
    const { data: church, error: churchError } = await supabaseAdmin
      .from('churches')
      .select('id,name,city,country,region_id')
      .eq('id', requestedChurchId)
      .maybeSingle();
    if (churchError || !church?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'La iglesia seleccionada no está disponible.' }), { status: 400 });
    }
    resolvedChurchId = church.id;
    resolvedChurchName = church.name || null;
    resolvedCity = church.city || null;
    resolvedCountry = church.country || null;
    resolvedRegionId = church.region_id || null;
  }

  const updatePayload: Record<string, unknown> = {
    role: desiredRole,
    campus_missionary_slug: desiredRole === 'campus_missionary' ? requestedCampusMissionarySlug : null,
    church_id: resolvedChurchId,
    portal_church_id: null,
    church_name: resolvedChurchName,
    region_id: resolvedRegionId,
    country: resolvedCountry || targetProfile.country || null,
    city: resolvedCity || (roleDefinition.scope === 'church' ? null : targetProfile.city || null),
    updated_at: new Date().toISOString(),
  };
  if (desiredRole === 'campus_missionary') {
    const { data: slugOwner, error: slugOwnerError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('campus_missionary_slug', requestedCampusMissionarySlug)
      .neq('user_id', targetProfile.user_id)
      .maybeSingle();
    if (slugOwnerError) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el misionero Campus' }), { status: 500 });
    }
    if (slugOwner?.user_id) {
      return new Response(JSON.stringify({ ok: false, error: 'Ese misionero Campus ya está asociado a otra cuenta' }), { status: 409 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updatePayload)
    .eq('user_id', payload.userId)
    .select('user_id, role, country, city, church_id, portal_church_id, church_name, region_id, campus_missionary_slug')
    .single();

  if (error) {
    console.error('[portal.admin.role] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  void logSecurityEvent({
    type: 'admin_action',
    identifier: 'portal-primary-role-updated',
    detail: desiredRole,
    meta: {
      actor_user_id: ctx.userId,
      target_user_id: targetProfile.user_id,
      previous_role: targetProfile.role,
      next_role: desiredRole,
      country: resolvedCountry,
      region_id: resolvedRegionId,
      church_id: resolvedChurchId,
    },
  });

  return new Response(JSON.stringify({ ok: true, user: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
