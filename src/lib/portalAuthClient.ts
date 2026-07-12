import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface PortalAuthResult {
    isAuthenticated: boolean;
    token: string | null;
    mode: 'supabase' | 'password' | null;
    user: User | { email: string; role: string } | null;
}

export interface PortalSessionResult {
    auth: PortalAuthResult;
    headers: Record<string, string>;
    response: Response | null;
    data: any | null;
    ok: boolean;
}

const DEBUG_PREFIX = '[PortalAuth]';
const AUTH_TIMEOUT_MS = 8000;
const SESSION_TIMEOUT_MS = 6000;
const PORTAL_SESSION_CACHE_MS = 10000;
let portalSessionCache: { key: string; expiresAt: number; result: PortalSessionResult } | null = null;
let portalSessionPromise: { key: string; promise: Promise<PortalSessionResult> } | null = null;
let supabaseClientPromise: Promise<SupabaseClient | null> | null = null;

function dlog(...args: any[]) {
    if (import.meta.env.DEV || window.location.host.includes('localhost')) {
        console.log(DEBUG_PREFIX, ...args);
    }
}

async function loadSupabaseBrowserClient(): Promise<SupabaseClient | null> {
    if (!supabaseClientPromise) {
        supabaseClientPromise = import('./supabaseBrowser')
            .then(({ getSupabaseBrowserClient }) => getSupabaseBrowserClient())
            .catch((error) => {
                supabaseClientPromise = null;
                throw error;
            });
    }
    return supabaseClientPromise;
}

function warmSupabaseClientSoon() {
    if (typeof window === 'undefined') return;
    const start = () => {
        void loadSupabaseBrowserClient().catch((error) => {
            console.warn(DEBUG_PREFIX, 'Supabase background warmup failed:', error);
        });
    };
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: 3000 });
        return;
    }
    window.setTimeout(start, 1500);
}

function getSupabaseUrlFromEnv(): string | null {
    return import.meta.env?.PUBLIC_SUPABASE_URL
        ?? import.meta.env?.SUPABASE_URL
        ?? null;
}

function getSupabaseStorageKey(): string | null {
    try {
        const url = getSupabaseUrlFromEnv();
        if (!url) return null;
        const host = new URL(url).hostname;
        const ref = host.split('.')[0];
        if (!ref) return null;
        return `sb-${ref}-auth-token`;
    } catch {
        return null;
    }
}

function parseStoredSession(raw: string | null): any | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function isSessionExpired(session: any): boolean {
    const expiresAt = Number(session?.expires_at ?? session?.expiresAt ?? 0);
    if (!Number.isFinite(expiresAt) || !expiresAt) return false;
    const bufferMs = 60 * 1000;
    return expiresAt * 1000 <= Date.now() + bufferMs;
}

function makeTimeoutError(label: string): Error {
    const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
    error.name = 'TimeoutError';
    return error;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: number | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = window.setTimeout(() => reject(makeTimeoutError(label)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

async function fetchJsonWithTimeout(url: string, options: RequestInit = {}, timeoutMs = SESSION_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        return { res, data };
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function getPortalSessionCacheKey(auth: PortalAuthResult): string {
    const userEmail = typeof (auth.user as any)?.email === 'string' ? (auth.user as any).email : '';
    return `${auth.mode || 'none'}:${auth.token || userEmail || 'anonymous'}`;
}

export async function getPortalSession(options: {
    auth?: PortalAuthResult;
    force?: boolean;
    cacheMs?: number;
} = {}): Promise<PortalSessionResult> {
    const auth = options.auth ?? await ensureAuthenticated();
    const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

    if (!auth.isAuthenticated) {
        return {
            auth,
            headers,
            response: null,
            data: null,
            ok: false,
        };
    }

    const cacheKey = getPortalSessionCacheKey(auth);
    const cacheMs = Number.isFinite(options.cacheMs) ? Number(options.cacheMs) : PORTAL_SESSION_CACHE_MS;

    if (!options.force && portalSessionCache?.key === cacheKey && portalSessionCache.expiresAt > Date.now()) {
        return portalSessionCache.result;
    }

    if (!options.force && portalSessionPromise?.key === cacheKey) {
        return portalSessionPromise.promise;
    }

    const promise = fetchJsonWithTimeout('/api/portal/session', {
        headers,
        credentials: 'include',
    }).then(({ res, data }) => {
        const result: PortalSessionResult = {
            auth,
            headers,
            response: res,
            data,
            ok: res.ok && data?.ok !== false,
        };
        if (result.ok && cacheMs > 0) {
            portalSessionCache = {
                key: cacheKey,
                expiresAt: Date.now() + cacheMs,
                result,
            };
        }
        return result;
    }).finally(() => {
        if (portalSessionPromise?.key === cacheKey) {
            portalSessionPromise = null;
        }
    });

    portalSessionPromise = { key: cacheKey, promise };
    return promise;
}

/**
 * Single source of truth for Portal Authentication.
 * Checks Supabase (SDK + LocalStorage) and Legacy Cookies.
 */
export async function ensureAuthenticated(): Promise<PortalAuthResult> {
    dlog('Starting authentication check...');

    // 1. Try LocalStorage first. The API validates the bearer token server-side.
    try {
        const key = getSupabaseStorageKey();
        const sessionObj = parseStoredSession(key ? localStorage.getItem(key) : null);
        if (sessionObj?.access_token) {
            if (!isSessionExpired(sessionObj)) {
                dlog('Authenticated via LocalStorage token');
                warmSupabaseClientSoon();
                return {
                    isAuthenticated: true,
                    token: sessionObj.access_token,
                    mode: 'supabase',
                    user: sessionObj.user || { email: 'recovered@session', role: 'authenticated' },
                };
            }

            const supabase = await loadSupabaseBrowserClient();
            if (supabase && sessionObj.refresh_token) {
                const { data, error } = await withTimeout(
                    supabase.auth.setSession({
                        access_token: sessionObj.access_token,
                        refresh_token: sessionObj.refresh_token,
                    }),
                    AUTH_TIMEOUT_MS,
                    'La restauración de sesión',
                );
                if (!error && data?.session?.access_token) {
                    dlog('Authenticated via LocalStorage (refreshed)');
                    return {
                        isAuthenticated: true,
                        token: data.session.access_token,
                        mode: 'supabase',
                        user: data.session.user,
                    };
                }
            }
            if (key) localStorage.removeItem(key);
        }
    } catch (err) {
        console.error(DEBUG_PREFIX, 'LocalStorage check failed:', err);
    }

    // 2. Try Supabase SDK when storage is empty or needs URL-session handling.
    try {
        const supabase = await loadSupabaseBrowserClient();
        if (supabase) {
            const { data } = await withTimeout(
                supabase.auth.getSession(),
                AUTH_TIMEOUT_MS,
                'La sesión del portal',
            );
            const session = data?.session;
            if (session?.access_token) {
                if (isSessionExpired(session)) {
                    const { data: refreshed, error } = await withTimeout(
                        supabase.auth.refreshSession(),
                        AUTH_TIMEOUT_MS,
                        'La renovación de sesión',
                    );
                    if (!error && refreshed?.session?.access_token) {
                        dlog('Authenticated via Supabase SDK (refreshed)');
                        return {
                            isAuthenticated: true,
                            token: refreshed.session.access_token,
                            mode: 'supabase',
                            user: refreshed.session.user
                        };
                    }
                }
                dlog('Authenticated via Supabase SDK');
                return {
                    isAuthenticated: true,
                    token: session.access_token,
                    mode: 'supabase',
                    user: session.user
                };
            }
        }
    } catch (err) {
        console.warn(DEBUG_PREFIX, 'Supabase SDK check failed:', err);
    }

    // 3. Try Legacy Password Session (Cookie-based)
    try {
        const { res, data } = await fetchJsonWithTimeout('/api/portal/password-session', { credentials: 'include' });
        if (res.ok) {
            if (data?.ok) {
                const legacyUser = data.profile ?? (
                    data.email
                        ? { email: data.email, role: data.role || 'superadmin' }
                        : null
                );
                if (!legacyUser) return {
                    isAuthenticated: false,
                    token: null,
                    mode: null,
                    user: null
                };
                dlog('Authenticated via Password Session Cookie');
                return {
                    isAuthenticated: true,
                    token: null, // No bearer token needed, cookie handles it
                    mode: 'password',
                    user: legacyUser
                };
            }
        }
    } catch (err) {
        console.warn(DEBUG_PREFIX, 'Password session check failed:', err);
    }

    dlog('Authentication failed. No valid session found.');
    return {
        isAuthenticated: false,
        token: null,
        mode: null,
        user: null
    };
}

/**
 * Renews the Supabase session before retrying a request rejected by the API.
 * Password sessions cannot be renewed client-side and are validated as-is.
 */
export async function refreshPortalAuthentication(): Promise<PortalAuthResult> {
    const current = await ensureAuthenticated();
    if (!current.isAuthenticated || current.mode !== 'supabase') return current;

    try {
        const supabase = await loadSupabaseBrowserClient();
        if (!supabase) throw new Error('Supabase no está disponible.');

        const { data, error } = await withTimeout(
            supabase.auth.refreshSession(),
            AUTH_TIMEOUT_MS,
            'La renovación de sesión',
        );
        if (error || !data?.session?.access_token) {
            throw error || new Error('No se pudo renovar la sesión.');
        }

        portalSessionCache = null;
        portalSessionPromise = null;
        return {
            isAuthenticated: true,
            token: data.session.access_token,
            mode: 'supabase',
            user: data.session.user,
        };
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'Supabase session refresh failed:', error);
        portalSessionCache = null;
        portalSessionPromise = null;
        return {
            isAuthenticated: false,
            token: null,
            mode: null,
            user: null,
        };
    }
}

export function redirectToLogin() {
    window.location.href = '/portal/ingresar';
}

export async function signOutPortalSession(): Promise<void> {
    portalSessionCache = null;
    portalSessionPromise = null;

    let storageKey: string | null = null;
    let hasStoredSupabaseSession = false;
    try {
        storageKey = getSupabaseStorageKey();
        hasStoredSupabaseSession = Boolean(storageKey && localStorage.getItem(storageKey));
    } catch {
        storageKey = null;
    }

    try {
        if (hasStoredSupabaseSession) {
            const supabase = await loadSupabaseBrowserClient();
            if (supabase) {
                await withTimeout(
                    supabase.auth.signOut({ scope: 'local' }),
                    AUTH_TIMEOUT_MS,
                    'El cierre de sesión',
                );
            }
        }
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'Supabase logout cleanup failed:', error);
    } finally {
        try {
            if (storageKey) localStorage.removeItem(storageKey);
        } catch {
            // The server-side cookie is still cleared below.
        }
    }

    try {
        await fetchJsonWithTimeout('/api/portal/password-logout', {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
        }, SESSION_TIMEOUT_MS);
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'Password logout cleanup failed:', error);
    }
}
