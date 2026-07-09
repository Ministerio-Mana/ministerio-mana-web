const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

function getSupabaseRestConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;

  return {
    endpoint: `${url}/rest/v1/security_throttle`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  } as const;
}

async function cleanupOldEntries(conf: ReturnType<typeof getSupabaseRestConfig>) {
  if (!conf) return;
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  try {
    await fetch(`${conf.endpoint}?created_at=lt.${encodeURIComponent(cutoff)}`, {
      method: 'DELETE',
      headers: conf.headers,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[rateLimit] cleanup failed', error);
    }
  }
}

export async function enforceRateLimit(
  identifier: string,
  windowSeconds = WINDOW_SECONDS,
  maxAttempts = MAX_ATTEMPTS,
  options: { failOpen?: boolean } = {},
): Promise<boolean> {
  const failOpen = options.failOpen ?? true;
  const conf = getSupabaseRestConfig();
  if (!conf) return failOpen;

  try {
    // record attempt
    await fetch(conf.endpoint, {
      method: 'POST',
      headers: conf.headers,
      body: JSON.stringify({ identifier }),
    });

    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const res = await fetch(`${conf.endpoint}?select=identifier&identifier=eq.${encodeURIComponent(identifier)}&created_at=gte.${encodeURIComponent(since)}`, {
      method: 'GET',
      headers: { ...conf.headers, Prefer: 'count=exact' },
    });

    if (!res.ok) return failOpen;

    let count = 0;
    const contentRange = res.headers.get('content-range') || res.headers.get('Content-Range');
    if (contentRange) {
      const parts = contentRange.split('/');
      const total = parts[1];
      count = Number(total) || 0;
    }
    if (!count) {
      const data = await res.json();
      count = Array.isArray(data) ? data.length : 0;
    }

    // Trigger async cleanup roughly once every 20 hits
    if (Math.random() < 0.05) {
      void cleanupOldEntries(conf);
    }

    return count <= maxAttempts;
  } catch (error) {
    console.error('[rateLimit] error', error);
    return failOpen;
  }
}
