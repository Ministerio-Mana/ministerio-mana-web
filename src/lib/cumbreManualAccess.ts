import crypto from 'node:crypto';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { getPortalAdminContext } from '@lib/portalAdminGuard';

type CumbreManualAccess = {
  ok: boolean;
  status: number;
  error: string | null;
  userId: string | null;
  email: string | null;
  mode: 'portal' | 'service' | null;
};

function env(key: string): string {
  return String(import.meta.env?.[key] ?? process.env?.[key] ?? '').trim();
}

function safeEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function authorizeCumbreManualAccess(params: {
  request: Request;
  clientAddress?: string | null;
  identifier: string;
}): Promise<CumbreManualAccess> {
  const ipCheck = await enforceAdminIp({
    request: params.request,
    clientAddress: params.clientAddress || undefined,
    identifier: params.identifier,
    allowlistKeys: ['CUMBRE_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) {
    return { ok: false, status: 403, error: 'No autorizado', userId: null, email: null, mode: null };
  }

  const portal = await getPortalAdminContext(params.request);
  if (
    portal.ok
    && portal.role === 'superadmin'
    && !portal.isPasswordSession
    && portal.userId
    && portal.email
  ) {
    return {
      ok: true,
      status: 200,
      error: null,
      userId: portal.userId,
      email: portal.email,
      mode: 'portal',
    };
  }

  const serviceSecret = env('CUMBRE_MANUAL_SECRET');
  const headerSecret = String(params.request.headers.get('x-admin-secret') || '').trim();
  if (safeEqual(headerSecret, serviceSecret)) {
    return {
      ok: true,
      status: 200,
      error: null,
      userId: null,
      email: null,
      mode: 'service',
    };
  }

  return {
    ok: false,
    status: portal.ok ? 403 : 401,
    error: 'Esta operación requiere una cuenta superadmin individual.',
    userId: null,
    email: null,
    mode: null,
  };
}
