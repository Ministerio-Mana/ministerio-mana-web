import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import {
  getPortalChurchAccessContext,
  mapPortalAccessError,
  type PortalChurchRole,
} from '@lib/portalAccess';

export const prerender = false;

const BAN_DURATION = '876000h'; // 100 years

const LIFECYCLE_ALLOWED_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
];

const ALLOWED_ACTIONS = new Set(['block', 'unblock', 'delete', 'restore']);

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toStringSafe(value: unknown): string {
  return String(value || '').trim();
}

function normalizeAction(value: unknown): string {
  return toStringSafe(value).toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function updateUserBanState(
  userId: string,
  userMetadata: Record<string, unknown>,
  banDuration: string,
) {
  return supabaseAdmin!.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
    user_metadata: userMetadata,
  });
}

async function unbanUser(
  userId: string,
  userMetadata: Record<string, unknown>,
): Promise<Error | null> {
  const candidates = ['none', '0s', '0'];
  for (const duration of candidates) {
    const { error } = await updateUserBanState(userId, userMetadata, duration);
    if (!error) return null;
  }
  return new Error('No se pudo desbloquear el usuario');
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) {
    return json({ ok: false, error: 'Supabase no configurado' }, 500);
  }

  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: LIFECYCLE_ALLOWED_ROLES,
    allowPasswordSession: false,
  });

  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'No autorizado para gestionar usuarios');
    return json({ ok: false, error: denied.error }, denied.status);
  }

  const actorRole = String(access.role || 'user');
  if (actorRole !== 'superadmin') {
    return json({ ok: false, error: 'Solo superadmin puede gestionar ciclo de vida de cuentas' }, 403);
  }

  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.users.lifecycle',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return json({ ok: false, error: 'No autorizado' }, 403);
  }

  const payload = await request.json().catch(() => null);
  const userId = toStringSafe(payload?.userId);
  const action = normalizeAction(payload?.action);
  const reason = toStringSafe(payload?.reason).slice(0, 300);

  if (!isUuid(userId)) {
    return json({ ok: false, error: 'Usuario inválido' }, 400);
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return json({ ok: false, error: 'Acción inválida' }, 400);
  }
  if (!access.userId) {
    return json({ ok: false, error: 'No se pudo validar sesión actual' }, 401);
  }
  if (['block', 'delete'].includes(action) && userId === access.userId) {
    return json({ ok: false, error: 'No puedes aplicar esta acción sobre tu propia cuenta' }, 403);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role, email')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('[portal.admin.users.lifecycle] profile error', profileError);
    return json({ ok: false, error: 'No se pudo validar el perfil objetivo' }, 500);
  }
  if (!profile?.user_id) {
    return json({ ok: false, error: 'Usuario no encontrado' }, 404);
  }
  if (String(profile.role || '') === 'superadmin') {
    return json({ ok: false, error: 'No se pueden gestionar cuentas superadmin desde este flujo' }, 403);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError || !authData?.user) {
    console.error('[portal.admin.users.lifecycle] auth user error', authError);
    return json({ ok: false, error: 'No se pudo validar el usuario de acceso' }, 500);
  }

  const existingMetadata = (authData.user.user_metadata || {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();

  if (action === 'delete') {
    const deletedMetadata = {
      ...existingMetadata,
      account_deleted_at: nowIso,
      account_deleted_by: 'admin_panel',
      account_delete_reason: reason || null,
    };
    const { error } = await updateUserBanState(userId, deletedMetadata, BAN_DURATION);
    if (error) {
      console.error('[portal.admin.users.lifecycle] delete ban error', error);
      return json({ ok: false, error: 'No se pudo eliminar la cuenta' }, 500);
    }

    const [membershipUpdate, regionalUpdate] = await Promise.all([
      supabaseAdmin
        .from('church_memberships')
        .update({ status: 'inactive', updated_at: nowIso })
        .eq('user_id', userId)
        .neq('status', 'inactive'),
      supabaseAdmin
        .from('region_leadership_assignments')
        .update({ status: 'inactive', updated_at: nowIso })
        .eq('user_id', userId)
        .eq('status', 'active'),
    ]);

    if (membershipUpdate.error && membershipUpdate.error.code !== 'PGRST116') {
      console.error('[portal.admin.users.lifecycle] membership cleanup error', membershipUpdate.error);
    }
    if (
      regionalUpdate.error
      && !['PGRST116', '42P01', '42703'].includes(regionalUpdate.error.code || '')
    ) {
      console.error('[portal.admin.users.lifecycle] regional cleanup error', regionalUpdate.error);
    }

    return json({ ok: true, action, user_id: userId });
  }

  if (action === 'block') {
    const { error } = await updateUserBanState(userId, existingMetadata, BAN_DURATION);
    if (error) {
      console.error('[portal.admin.users.lifecycle] block error', error);
      return json({ ok: false, error: 'No se pudo bloquear la cuenta' }, 500);
    }
    return json({ ok: true, action, user_id: userId });
  }

  if (action === 'restore') {
    const restoredMetadata = {
      ...existingMetadata,
      account_deleted_at: null,
      account_deleted_by: null,
      account_delete_reason: null,
    };
    const unbanError = await unbanUser(userId, restoredMetadata);
    if (unbanError) {
      console.error('[portal.admin.users.lifecycle] restore error', unbanError);
      return json({ ok: false, error: 'No se pudo restaurar la cuenta' }, 500);
    }
    return json({ ok: true, action, user_id: userId });
  }

  const unbanError = await unbanUser(userId, existingMetadata);
  if (unbanError) {
    console.error('[portal.admin.users.lifecycle] unblock error', unbanError);
    return json({ ok: false, error: 'No se pudo desbloquear la cuenta' }, 500);
  }
  return json({ ok: true, action, user_id: userId });
};
