import { createHash } from 'node:crypto';

const DEFAULT_MIN_LENGTH = 10;
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 5000;

export type PasswordStrengthResult = {
  ok: boolean;
  errors: string[];
};

export type LeakedPasswordResult = {
  leaked: boolean;
  count: number | null;
  checked: boolean;
  error?: string;
};

export function validatePasswordStrength(password: string, minLength = DEFAULT_MIN_LENGTH): PasswordStrengthResult {
  const errors: string[] = [];
  if (!password || password.length < minLength) {
    errors.push(`mínimo ${minLength} caracteres`);
  }
  if (!/[a-z]/.test(password)) errors.push('una minúscula');
  if (!/[A-Z]/.test(password)) errors.push('una mayúscula');
  if (!/[0-9]/.test(password)) errors.push('un número');
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('un símbolo');
  }

  return { ok: errors.length === 0, errors };
}

export function formatPasswordErrors(errors: string[]): string {
  if (!errors.length) return 'Contraseña inválida';
  if (errors.length === 1) return `La contraseña debe incluir ${errors[0]}.`;
  const last = errors[errors.length - 1];
  const rest = errors.slice(0, -1).join(', ');
  return `La contraseña debe incluir ${rest} y ${last}.`;
}

function sha1Hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase();
}

export async function checkLeakedPassword(
  password: string,
  opts: { timeoutMs?: number; strict?: boolean } = {},
): Promise<LeakedPasswordResult> {
  if (!password) {
    return { leaked: false, count: null, checked: false };
  }

  const hash = sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? HIBP_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'ministerio-mana-web',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HIBP error ${res.status}`);
    }

    const body = await res.text();
    const lines = body.split('\n');
    for (const line of lines) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix === suffix) {
        const count = Number.parseInt(countRaw ?? '0', 10);
        return { leaked: true, count: Number.isFinite(count) ? count : null, checked: true };
      }
    }

    return { leaked: false, count: 0, checked: true };
  } catch (err: any) {
    if (opts.strict) throw err;
    return { leaked: false, count: null, checked: false, error: err?.message || 'HIBP error' };
  } finally {
    clearTimeout(timeout);
  }
}
