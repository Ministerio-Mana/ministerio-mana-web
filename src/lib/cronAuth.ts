import { timingSafeEqual } from 'node:crypto';

export type CronAuthorizationOptions = {
  secrets: Array<string | null | undefined>;
  production: boolean;
  allowWithoutSecretInDevelopment?: boolean;
  allowQueryTokenInDevelopment?: boolean;
};

function normalizeSecrets(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function safeSecretEqual(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function isCronRequestAuthorized(
  request: Request,
  options: CronAuthorizationOptions,
): boolean {
  const secrets = normalizeSecrets(options.secrets);
  if (!secrets.length) {
    return !options.production && options.allowWithoutSecretInDevelopment !== false;
  }

  const matches = (candidate: string | null | undefined) => (
    secrets.some((secret) => safeSecretEqual(candidate, secret))
  );

  if (matches(request.headers.get('x-cron-secret'))) return true;

  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
  if (matches(bearer)) return true;

  if (!options.production && options.allowQueryTokenInDevelopment) {
    return matches(new URL(request.url).searchParams.get('token'));
  }

  return false;
}
