import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { resolveBaseUrl } from '@lib/url';
import { sendAuthLink } from '@lib/authMailer';
import { enforceAdminIp } from '@lib/adminIpAllowlist';

export const prerender = false;

type ResetContext = {
  ok: boolean;
  role: string | null;
  country: string | null;
  churchId: string | null;
};

async function getResetContext(request: Request): Promise<ResetContext> {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile) {
      return { ok: false, role: null, country: null, churchId: null };
    }

    const memberships = await listUserMemberships(user.id);
    const activeMembership = memberships.find((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );

    let effectiveRole = profile.role || 'user';
    if (!['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'].includes(effectiveRole)) {
      if (activeMembership?.role === 'church_admin') {
        effectiveRole = 'pastor';
      } else if (activeMembership?.role === 'church_member') {
        effectiveRole = 'local_collaborator';
      }
    }

    if (!['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator'].includes(effectiveRole)) {
      return { ok: false, role: null, country: null, churchId: null };
    }

    return {
      ok: true,
      role: effectiveRole,
      country: profile.country || null,
      churchId: profile.church_id || activeMembership?.church?.id || null,
    };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null, country: null, churchId: null };
  }
  return { ok: true, role: 'superadmin', country: null, churchId: null };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getResetContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (ctx.role === 'superadmin' || ctx.role === 'admin') {
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
    .select('user_id, email, role, church_id, country')
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

  if (ctx.role === 'admin' && targetProfile.role === 'superadmin') {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese usuario' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (ctx.role === 'national_pastor') {
    if (!ctx.country || !targetProfile.country || targetProfile.country !== ctx.country) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado para ese usuario' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  if (ctx.role === 'pastor' || ctx.role === 'local_collaborator') {
    if (!ctx.churchId || !targetProfile.church_id || targetProfile.church_id !== ctx.churchId) {
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
