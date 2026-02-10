import crypto from 'node:crypto';

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.slice(0, 120);
}

export function buildIdempotencyKey(params: {
  request?: Request;
  rawKey?: unknown;
  fallbackSeed?: string | null;
}): string | null {
  const headerKey = params.request?.headers.get('idempotency-key')
    ?? params.request?.headers.get('x-idempotency-key')
    ?? null;
  const directKey = normalizeIdempotencyKey(headerKey ?? params.rawKey);
  if (directKey) return directKey;
  if (!params.fallbackSeed) return null;
  const digest = crypto.createHash('sha256').update(params.fallbackSeed).digest('hex');
  return `auto_${digest}`;
}

export function isSafeTokenCandidate(key: string): boolean {
  return key.length >= 24;
}
