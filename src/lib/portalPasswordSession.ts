import crypto from 'node:crypto';

const COOKIE_NAME = 'portal_admin_session';

type PortalPasswordSession = {
  email: string;
  role: 'superadmin';
  exp: number;
};

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function getSecret(): string | undefined {
  return env('PORTAL_ADMIN_SESSION_SECRET') ?? env('PORTAL_SUPERADMIN_PASSWORD');
}

function signToken(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function encodePayload(session: PortalPasswordSession): string {
  return Buffer.from(JSON.stringify(session)).toString('base64url');
}

function decodePayload(encoded: string): PortalPasswordSession | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    return JSON.parse(json) as PortalPasswordSession;
  } catch {
    return null;
  }
}

export function createPasswordSessionToken(email: string, ttlSeconds = 60 * 60 * 12): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const session: PortalPasswordSession = {
    email: email.toLowerCase(),
    role: 'superadmin',
    exp: Date.now() + ttlSeconds * 1000,
  };
  const payload = encodePayload(session);
  const signature = signToken(payload, secret);
  return `${payload}.${signature}`;
}

export function readPasswordSession(request: Request): PortalPasswordSession | null {
  const secret = getSecret();
  if (!secret) return null;
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((chunk) => chunk.trim());
  const entry = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return null;
  const value = entry.slice(COOKIE_NAME.length + 1);
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = signToken(payload, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const session = decodePayload(payload);
  if (!session) return null;
  if (session.exp < Date.now()) return null;
  return session;
}

export function buildSessionCookie(token: string, ttlSeconds = 60 * 60 * 12) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${ttlSeconds}; SameSite=Lax; Secure; HttpOnly`;
}

export function buildClearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`;
}
