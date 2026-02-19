import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { resolveBaseUrl } from '@lib/url';
import { sendAuthLink } from '@lib/authMailer';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import {
  getPortalChurchAccessContext,
  mapPortalAccessError,
  type PortalChurchRole,
} from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { normalizeCountryRegion } from '@lib/normalization';

export const prerender = false;

const RESET_ALLOWED_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
  'national_pastor',
  'regional_pastor',
  'pastor',
  'local_collaborator',
];

function sameCountry(left?: string | null, right?: string | null): boolean {
  return normalizeCountryRegion(left || '') === normalizeCountryRegion(right || '');
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: RESET_ALLOWED_ROLES,
    allowPasswordSession: true,
  });

  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'No autorizado');
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (access.isAdmin) {
    const ipCheck = await enforceAdminIp({
      request,
      clientAddress,
      identifier: 'portal.admin.reset-password',
      allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
    });
    if (!ipCheck.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Email requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const email = String(payload.email).trim().toLowerCase();
  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, role, country, region_id, church_id, portal_church_id')
    .eq('email', email)
    .maybeSingle();

  if (targetProfileError) {
    console.error('[portal.admin.reset] profile error', targetProfileError);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar usuario' }), {
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

  const actorRole = String(access.role || 'user');
  const targetRole = String(targetProfile.role || 'user');
  const targetChurchId = String(targetProfile.church_id || targetProfile.portal_church_id || '').trim() || null;

  if (actorRole !== 'superadmin' && targetRole === 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese usuario' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!access.isAdmin && (targetRole === 'admin' || targetRole === 'superadmin')) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese usuario' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!access.isAdmin) {
    let allowed = false;

    if (access.allowedChurchId) {
      allowed = Boolean(targetChurchId && targetChurchId === access.allowedChurchId);
    } else if (access.isRegional) {
      if (targetProfile.region_id && access.allowedRegionIds.includes(targetProfile.region_id)) {
        allowed = true;
      }
      if (!allowed && targetChurchId) {
        allowed = await isChurchAllowedForAccess(targetChurchId, access);
      }
      if (!allowed && access.allowedCountry && targetProfile.country) {
        allowed = sameCountry(targetProfile.country, access.allowedCountry);
      }
    } else if (access.isNational) {
      if (targetChurchId) {
        allowed = await isChurchAllowedForAccess(targetChurchId, access);
      }
      if (!allowed && access.allowedCountry && targetProfile.country) {
        allowed = sameCountry(targetProfile.country, access.allowedCountry);
      }
    }

    if (!allowed) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese usuario' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  const baseUrl = resolveBaseUrl(request);
  const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;

  const result = await sendAuthLink({ kind: 'recovery', email, redirectTo });
  if (!result.ok) {
    console.error('[portal.admin.reset] error', result.error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
