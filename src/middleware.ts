import type { MiddlewareHandler } from 'astro';

type GeoCookie = {
  country: string;
  lang: string;
  ts: number;
};

const GEO_COOKIE_NAME = 'mana_geo';
const GEO_COOKIE_TTL = 60 * 60 * 12; // 12 hours in seconds
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const VERCEL_ENV = process.env.VERCEL_ENV || (import.meta as any)?.env?.VERCEL_ENV;
const IS_VERCEL_PREVIEW = VERCEL_ENV === 'preview';
const SCRIPT_SRC_BASE = [
  "'self'",
  'https://challenges.cloudflare.com',
  'https://js.stripe.com',
  'https://checkout.wompi.co',
  'https://unpkg.com',
];

const FRAME_SRC = [
  "'self'",
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://checkout.stripe.com',
  'https://checkout.wompi.co',
  'https://challenges.cloudflare.com',
];
const HSTS_HEADER = 'max-age=31536000; includeSubDomains; preload';

const ENGLISH_COUNTRIES = new Set([
  'US', 'GB', 'UK', 'AU', 'NZ', 'CA', 'IE',
  'TT', 'JM', 'BZ', 'BB', 'LC', 'GD',
]);

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToBase64(bytes);
}

function parseGeoCookie(value: string | undefined): GeoCookie | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as GeoCookie;
    if (!parsed?.country || !parsed?.lang || !parsed?.ts) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function computeLanguage(code: string): 'es' | 'en' {
  return ENGLISH_COUNTRIES.has(code) ? 'en' : 'es';
}

async function lookupCountry(request: Request): Promise<GeoCookie> {
  const fallback: GeoCookie = {
    country: 'CO',
    lang: 'es',
    ts: Date.now(),
  };

  const cfIpCountry = request.headers.get('cf-ipcountry');
  if (cfIpCountry && cfIpCountry !== 'XX') {
    const country = cfIpCountry.toUpperCase();
    return { country, lang: computeLanguage(country), ts: Date.now() };
  }

  const ip = getRequestIp(request);
  if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168')) {
    return fallback;
  }

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'user-agent': 'ministeriomana.org/geo-middleware' },
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const country = typeof data?.country === 'string' ? data.country.toUpperCase() : 'CO';
    const lang = computeLanguage(country);
    return { country, lang, ts: Date.now() };
  } catch {
    return fallback;
  }
}

function getRequestIp(request: Request): string | undefined {
  const headers = request.headers;
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim();
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  return undefined;
}

function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded && forwarded.split(',')[0]?.trim() === 'https') return true;
  return false;
}

function isLocalhost(request: Request): boolean {
  const host = request.headers.get('host') || new URL(request.url).host;
  return host.startsWith('localhost') || host.startsWith('127.') || host.endsWith('.local');
}

const appMiddleware: MiddlewareHandler = async (context, next) => {
  const { cookies, locals, request } = context;
  const url = new URL(request.url);
  const cumbreOnly =
    (import.meta.env?.PUBLIC_CUMBRE_ONLY ?? process.env?.PUBLIC_CUMBRE_ONLY) === 'true';
  const isSecure = isSecureRequest(request);

  const nonce = createNonce();

  if (cumbreOnly && url.pathname === '/') {
    return Response.redirect(`${url.origin}/eventos/cumbre-mundial-2026`, 302);
  }

  if (IS_PROD && !isSecure && !isLocalhost(request)) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    return new Response(null, {
      status: 308,
      headers: { location: url.toString() },
    });
  }

  let geo = parseGeoCookie(cookies.get(GEO_COOKIE_NAME)?.value);
  const isExpired = geo ? (Date.now() - geo.ts) / 1000 > GEO_COOKIE_TTL : true;

  if (!geo || isExpired) {
    geo = await lookupCountry(request);
    cookies.set(GEO_COOKIE_NAME, JSON.stringify(geo), {
      path: '/',
      maxAge: GEO_COOKIE_TTL,
      sameSite: 'lax',
      httpOnly: false,
      secure: isSecure,
    });
  }

  locals.geo = {
    country: geo.country,
    lang: geo.lang,
  };

  locals.cspNonce = nonce;

  const turnstileSiteKey = import.meta.env?.TURNSTILE_SITE_KEY ?? process.env?.TURNSTILE_SITE_KEY ?? '';
  locals.turnstile = { siteKey: turnstileSiteKey };

  const hasLangCookie = Boolean(cookies.get('lang'));
  if (!hasLangCookie) {
    cookies.set('lang', geo.lang, {
      path: '/',
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const response = await next();

  if (isSecure) {
    response.headers.set('Strict-Transport-Security', HSTS_HEADER);
  }
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  const scriptSrc = [...SCRIPT_SRC_BASE, `'nonce-${nonce}'`];
  if (IS_VERCEL_PREVIEW) {
    scriptSrc.push('https://vercel.live');
  }
  if (!IS_PROD) {
    scriptSrc.push("'unsafe-eval'");
    scriptSrc.push("'unsafe-inline'"); // useful for rapid dev; remove when all inline scripts have nonce
  }

  const connectSrc = [
    "'self'",
    'https://challenges.cloudflare.com',
    'https://api.resend.com',
    'https://checkout.stripe.com',
    'https://checkout.wompi.co',
    'https://js.stripe.com',
  ];
  const frameSrc = [...FRAME_SRC];
  if (IS_VERCEL_PREVIEW) {
    frameSrc.push('https://vercel.live');
  }

  const supabaseUrl = import.meta.env?.SUPABASE_URL
    ?? import.meta.env?.PUBLIC_SUPABASE_URL
    ?? process.env?.SUPABASE_URL
    ?? process.env?.PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const supabaseOrigin = new URL(supabaseUrl).origin;
      connectSrc.push(supabaseOrigin);
      connectSrc.push(supabaseOrigin.replace('https://', 'wss://'));
    } catch {
      // ignore malformed supabase url
    }
  }

  const cspDirectives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://i.ytimg.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    "frame-ancestors 'self'",
    "form-action 'self' https://checkout.stripe.com https://checkout.wompi.co",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  response.headers.set('Content-Security-Policy', cspDirectives);
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  return response;
};
export const onRequest = appMiddleware;
