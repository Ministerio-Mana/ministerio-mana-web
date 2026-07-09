import type { APIRoute } from 'astro';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { generateAuthActionLink } from '@lib/authMailer';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { resolveBaseUrl } from '@lib/url';

export const prerender = false;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
    },
  });
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function isFutureTimestamp(value: unknown): boolean {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > Date.now();
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const user = await getUserFromRequest(request);
  if (!user?.email) return json({ ok: false, error: 'No autorizado' }, 401);

  const actorProfile = await ensureUserProfile(user);
  if (!actorProfile || !isAdminRole(actorProfile.role)) {
    return json({ ok: false, error: 'No autorizado' }, 403);
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.access-link',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) return json({ ok: false, error: 'No autorizado' }, 403);

  const rateAllowed = await enforceRateLimit(`portal.admin.access-link:${user.id}`, 600, 10);
  if (!rateAllowed) {
    void logSecurityEvent({
      type: 'rate_limited',
      identifier: 'portal.admin.access-link',
      ip: ipCheck.ip,
      detail: 'Límite de enlaces manuales alcanzado',
      meta: { actor_user_id: user.id },
    });
    return json({ ok: false, error: 'Espera unos minutos antes de generar otro enlace' }, 429);
  }

  const payload = await request.json().catch(() => null);
  const email = String(payload?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return json({ ok: false, error: 'Email requerido' }, 400);
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, role')
    .eq('email', email)
    .maybeSingle();
  if (targetProfileError) {
    console.error('[portal.admin.access-link] profile error', targetProfileError);
    return json({ ok: false, error: 'No se pudo validar el usuario' }, 500);
  }
  if (!targetProfile?.user_id) return json({ ok: false, error: 'Usuario no encontrado' }, 404);

  const protectedTargetRoles = new Set(['superadmin', 'admin', 'finance']);
  if (actorProfile.role !== 'superadmin' && protectedTargetRoles.has(String(targetProfile.role || 'user'))) {
    return json({ ok: false, error: 'No autorizado para ese usuario' }, 403);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(targetProfile.user_id);
  if (authError || !authData?.user) {
    console.error('[portal.admin.access-link] auth user error', authError);
    return json({ ok: false, error: 'No se encontró la cuenta de acceso' }, 404);
  }

  const authUser = authData.user;
  if (String(authUser.email || '').trim().toLowerCase() !== email) {
    return json({ ok: false, error: 'El correo del perfil no coincide con la cuenta de acceso' }, 409);
  }
  const isSelfServiceDeleted = Boolean(
    isFutureTimestamp((authUser as typeof authUser & { banned_until?: string | null }).banned_until)
    && authUser.user_metadata?.account_deleted_at
    && authUser.user_metadata?.account_deleted_by === 'self_service',
  );
  if (isSelfServiceDeleted) {
    return json({ ok: false, error: 'La cuenta fue eliminada y debe restaurarse antes' }, 409);
  }

  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(request);
  } catch {
    return json({ ok: false, error: 'Host no permitido' }, 400);
  }

  const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;
  const generated = await generateAuthActionLink({ kind: 'recovery', email, redirectTo });
  if (!generated.ok || !generated.actionUrl) {
    return json({ ok: false, error: generated.error || 'No se pudo generar el enlace' }, 500);
  }

  void logSecurityEvent({
    type: 'maintenance',
    identifier: 'portal.admin.access-link.generated',
    ip: ipCheck.ip,
    detail: 'Enlace manual de acceso generado por administrador',
    meta: {
      actor_user_id: user.id,
      target_user_id: targetProfile.user_id,
      target_email: maskEmail(email),
    },
  });

  return json({ ok: true, actionUrl: generated.actionUrl });
};
