import { logSecurityEvent } from './securityEvents';

type AdminIpCheck = {
  ok: boolean;
  ip: string | null;
  reason?: string;
};

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
  const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
  return runtimeEnv === 'production';
}

function isTruthy(value?: string): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isAllowlistOptional(): boolean {
  const optional = env('ADMIN_IP_ALLOWLIST_OPTIONAL');
  if (optional != null) return isTruthy(optional);
  const required = env('ADMIN_IP_ALLOWLIST_REQUIRED');
  if (required != null) return !isTruthy(required);
  return false;
}

function normalizeIp(value: string): string {
  let ip = value.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip.includes('.') && ip.includes(':') && !ip.startsWith('[')) {
    ip = ip.split(':')[0];
  }
  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  }
  return ip;
}

function getClientIp(request: Request, clientAddress?: string | null): string | null {
  const headerIp =
    request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip');
  if (headerIp) {
    const first = headerIp.split(',')[0]?.trim();
    return first ? normalizeIp(first) : null;
  }
  if (clientAddress) return normalizeIp(clientAddress);
  return null;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function matchesCidr(ip: string, cidr: string): boolean {
  const [base, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  if (!isValidIpv4(ip) || !isValidIpv4(base) || !Number.isFinite(prefix)) return false;
  if (prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  return (ipInt & mask) === (baseInt & mask);
}

function resolveAllowlist(keys: string[]): string[] {
  const values = keys.map((key) => env(key)).filter(Boolean) as string[];
  return values
    .flatMap((value) => value.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ipAllowed(ip: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    if (entry.includes('/')) {
      return matchesCidr(ip, entry);
    }
    return normalizeIp(entry) === ip;
  });
}

export async function enforceAdminIp(params: {
  request: Request;
  clientAddress?: string | null;
  identifier?: string;
  allowlistKeys?: string[];
}): Promise<AdminIpCheck> {
  const allowlist = resolveAllowlist(params.allowlistKeys || ['ADMIN_IP_ALLOWLIST']);
  const ip = getClientIp(params.request, params.clientAddress);
  const optional = isAllowlistOptional();

  if (!isProduction()) {
    return { ok: true, ip };
  }

  if (!allowlist.length) {
    if (optional) {
      void logSecurityEvent({
        type: 'maintenance',
        identifier: params.identifier || 'admin.ip',
        ip,
        detail: 'Allowlist opcional; acceso permitido sin IP allowlist',
        meta: { allowlist_size: 0, optional: true },
      });
      return { ok: true, ip, reason: 'Allowlist opcional' };
    }
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: params.identifier || 'admin.ip',
      ip,
      detail: 'Allowlist de IP no configurada',
      meta: { allowlist_size: 0 },
    });
    return { ok: false, ip, reason: 'Allowlist no configurada' };
  }

  if (!ip || !ipAllowed(ip, allowlist)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: params.identifier || 'admin.ip',
      ip,
      detail: 'IP no permitida',
      meta: { allowlist_size: allowlist.length },
    });
    return { ok: false, ip, reason: 'IP no permitida' };
  }

  return { ok: true, ip };
}
