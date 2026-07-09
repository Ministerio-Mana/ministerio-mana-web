window.addEventListener('DOMContentLoaded', () => {
  const loginCard = document.getElementById('login-card');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (loginCard?.animate && !reduceMotion) {
    loginCard.animate([
      { opacity: 0, transform: 'translateY(16px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], {
      duration: 520,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });
  }
});

const magicForm = document.getElementById('magic-link-form');
const passwordForm = document.getElementById('password-form');
const magicEmailInput = document.getElementById('magic-email');
const passwordEmailInput = document.getElementById('password-email');
const passwordInput = document.getElementById('login-password');
const toggleMagicBtn = document.getElementById('btn-toggle-magic');
const cancelMagicBtn = document.getElementById('btn-cancel-magic');
const togglePasswordViewBtn = document.getElementById('toggle-password-view');
const passkeyBtn = document.getElementById('btn-passkey');
const oauthGoogleBtn = document.getElementById('btn-oauth-google');
const oauthFacebookBtn = document.getElementById('btn-oauth-facebook');

const statusContainer = document.getElementById('login-status-container');
const statusEl = document.getElementById('login-status');
const statusIcon = document.getElementById('login-status-icon');
const statusWrapper = document.getElementById('login-status-wrapper');

const TURNSTILE_RENDER_WAIT_MS = 3000;
const TURNSTILE_SCRIPT_BASE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TURNSTILE_SCRIPT_SRC = `${TURNSTILE_SCRIPT_BASE}?render=explicit`;
const REQUEST_TIMEOUT_MS = 15000;
let supabaseClientPromise = null;
let turnstileScriptPromise = null;
let turnstileRenderPromise = null;
let turnstileWidgetId = null;
let turnstileToken = '';

function makeTimeoutError(label) {
  const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
  error.name = 'TimeoutError';
  return error;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(makeTimeoutError(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (err) {
    if (err?.name === 'AbortError') throw makeTimeoutError(label);
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeSafePortalPath(value) {
  const fallback = '/portal';
  const next = value || fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;

  try {
    const parsed = new URL(next, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function getSafeNextPath() {
  const params = new URLSearchParams(window.location.search);
  return normalizeSafePortalPath(params.get('next'));
}

function buildActivationRedirectTo() {
  return `${window.location.origin}/portal/activar?next=${encodeURIComponent(getSafeNextPath())}`;
}

function syncReturnLinks() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get('reason') || '';
  const registerLink = document.querySelector('a[href^="/portal/registro"]');
  if (!registerLink) return;
  const registerUrl = new URL('/portal/registro', window.location.origin);
  registerUrl.searchParams.set('next', getSafeNextPath());
  if (reason) registerUrl.searchParams.set('reason', reason);
  registerLink.href = `${registerUrl.pathname}${registerUrl.search}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskEmailHint(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!domain) return null;
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

async function waitForTurnstileReady(widget, timeoutMs = TURNSTILE_RENDER_WAIT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (typeof window.turnstile?.render === 'function' || readTurnstileTokenField(widget)) return true;
    await sleep(120);
  }
  return false;
}

function readTurnstileTokenField(widget) {
  const selectors = 'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]';
  const inWidget = widget?.querySelector?.(selectors);
  if (inWidget?.value) return String(inWidget.value).trim();
  const inDocument = document.querySelector(selectors);
  if (inDocument?.value) return String(inDocument.value).trim();
  return '';
}

function ensureTurnstileScriptLoaded() {
  if (window.turnstile) return Promise.resolve(true);

  const widget = document.querySelector('.cf-turnstile');
  if (!widget?.getAttribute('data-sitekey')) return Promise.resolve(false);

  if (turnstileScriptPromise) return turnstileScriptPromise;

  const existingScript = Array.from(document.scripts).find((script) => script.src.startsWith(TURNSTILE_SCRIPT_BASE));
  if (existingScript) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve(true);
        return;
      }
      existingScript.addEventListener('load', () => resolve(true), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('No cargó Cloudflare Turnstile.')), { once: true });
      window.setTimeout(() => resolve(Boolean(window.turnstile)), TURNSTILE_RENDER_WAIT_MS);
    });
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener('error', () => reject(new Error('No cargó Cloudflare Turnstile.')), { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

async function ensureTurnstileRendered() {
  const widget = document.querySelector('.cf-turnstile');
  const siteKey = widget?.getAttribute('data-sitekey') || '';
  if (!widget || !siteKey) return false;
  if (turnstileWidgetId !== null || readTurnstileTokenField(widget)) return true;
  if (turnstileRenderPromise) return turnstileRenderPromise;

  turnstileRenderPromise = (async () => {
    const scriptLoaded = await ensureTurnstileScriptLoaded();
    if (!scriptLoaded && !window.turnstile) return false;

    const apiReady = await waitForTurnstileReady(widget, TURNSTILE_RENDER_WAIT_MS);
    if (!apiReady || typeof window.turnstile?.render !== 'function') return false;
    if (turnstileWidgetId !== null || readTurnstileTokenField(widget)) return true;

    turnstileToken = '';
    try {
      turnstileWidgetId = window.turnstile.render(widget, {
        sitekey: siteKey,
        appearance: widget.getAttribute('data-appearance') || 'always',
        theme: widget.getAttribute('data-theme') || 'light',
        callback: (token) => {
          turnstileToken = String(token || '').trim();
        },
        'expired-callback': () => {
          turnstileToken = '';
        },
        'timeout-callback': () => {
          turnstileToken = '';
        },
        'error-callback': () => {
          turnstileToken = '';
        },
      });
      widget.setAttribute('data-turnstile-rendered', 'true');
      return turnstileWidgetId !== null && turnstileWidgetId !== undefined;
    } catch (error) {
      turnstileWidgetId = null;
      console.warn('[Turnstile] Explicit render failed:', error);
      return Boolean(readTurnstileTokenField(widget));
    }
  })().finally(() => {
    turnstileRenderPromise = null;
  });

  return turnstileRenderPromise;
}

function warmTurnstile() {
  void ensureTurnstileRendered().catch((error) => {
    console.warn('[Turnstile] Warmup failed:', error);
  });
}

function resetTurnstile() {
  turnstileToken = '';
  if (turnstileWidgetId === null || typeof window.turnstile?.reset !== 'function') return;
  try {
    window.turnstile.reset(turnstileWidgetId);
  } catch (error) {
    console.warn('[Turnstile] Reset failed:', error);
  }
}

async function getTurnstileTokenIfRequired() {
  const widget = document.querySelector('.cf-turnstile');

  // If no widget in HTML, it's not enabled
  if (!widget) return { ok: true, bypass: true, token: '', reason: 'widget_absent' };

  // If widget exists but has no data-sitekey, it wasn't configured properly (env var missing)
  // In this case, bypass the check instead of blocking the user
  const siteKey = widget.getAttribute('data-sitekey');
  if (!siteKey) {
    console.warn('[Turnstile] Widget rendered without site key.');
    return { ok: false, error: 'Captcha no configurado. Recarga la pagina o contacta soporte.', reason: 'sitekey_missing' };
  }

  try {
    const rendered = await ensureTurnstileRendered();
    if (!rendered && !readTurnstileTokenField(widget)) {
      return {
        ok: false,
        error: 'No cargó el captcha (Cloudflare). Revisa la conexión, recarga e intenta de nuevo.',
        reason: 'widget_not_rendered',
      };
    }
  } catch (err) {
    console.warn('[Turnstile] Script failed to load.', err);
    return {
      ok: false,
      error: 'No cargó el captcha (Cloudflare). Revisa la conexión, recarga e intenta de nuevo.',
      reason: 'script_not_loaded',
    };
  }

  // If widget has key but did not render, do NOT bypass.
  // Backend requires captcha in production, so sending empty token causes hard failure.
  if (turnstileWidgetId === null && !readTurnstileTokenField(widget)) {
    await waitForTurnstileReady(widget, TURNSTILE_RENDER_WAIT_MS);
  }

  if (turnstileWidgetId === null && !readTurnstileTokenField(widget)) {
    console.warn('[Turnstile] Widget has site key but failed to render.');
    return {
      ok: false,
      error: 'No cargó el captcha (Cloudflare). Desactiva bloqueadores/Brave Shields, recarga e intenta de nuevo.',
      reason: 'widget_not_rendered',
    };
  }

  // Widget is configured AND rendered, so validation is required
  let token = turnstileToken || readTurnstileTokenField(widget);
  if (!token && turnstileWidgetId !== null && typeof window.turnstile?.getResponse === 'function') {
    try {
      token = String(window.turnstile.getResponse(turnstileWidgetId) || '').trim();
    } catch (error) {
      console.warn('[Turnstile] Could not read response:', error);
    }
  }
  if (!token) {
    return { ok: false, error: 'Completa la verificación antes de continuar.', reason: 'token_missing' };
  }

  return { ok: true, token, reason: 'ok' };
}

async function verifyTurnstileToken(token) {
  if (!token) return { ok: false, error: 'Captcha requerido.' };
  try {
    const { res, data } = await fetchJsonWithTimeout('/api/turnstile/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    }, 10000, 'La verificación del captcha');
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || 'Captcha inválido. Intenta de nuevo.' };
    }
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'No pudimos validar el captcha. Intenta de nuevo.' };
  }
}

async function verifyTurnstileTokenStrict(token, context = 'generic') {
  if (!token) return { ok: false, error: 'Captcha requerido.' };
  const result = await verifyTurnstileToken(token);
  if (!result.ok) {
    console.warn(`[Turnstile] Verify failed (${context}):`, result.error);
  }
  return result;
}

function showStatus(msg, type = 'loading') {
  if (!statusContainer || !statusEl || !statusIcon || !statusWrapper) return;
  statusContainer.classList.remove('hidden');
  statusEl.textContent = msg;

  // Update icon
  statusIcon.className = type === 'error'
    ? 'w-2 h-2 rounded-full bg-red-500'
    : type === 'success'
      ? 'w-2 h-2 rounded-full bg-green-500'
      : 'w-2 h-2 rounded-full bg-blue-500 animate-ping';

  // Update wrapper and text styles
  if (type === 'error') {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-red-50 border border-red-200';
    statusEl.className = 'text-sm font-semibold text-red-700';
  } else if (type === 'success') {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-green-50 border border-green-200';
    statusEl.className = 'text-sm font-semibold text-green-700';
  } else {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-blue-50 border border-blue-200';
    statusEl.className = 'text-sm font-semibold text-blue-700';
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (statusContainer.animate && !reduceMotion) {
    statusContainer.animate([
      { opacity: 0, transform: 'scale(0.94)' },
      { opacity: 1, transform: 'scale(1)' },
    ], {
      duration: 260,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
  }
}

function resolveLoginErrorMessage(err) {
  const raw = String(err?.message || '').trim();
  if (!raw) return 'No se pudo iniciar sesión. Intenta de nuevo.';
  if (/tard[oó] demasiado|timeout|aborted/i.test(raw)) return 'La conexión tardó demasiado. Revisa la señal y vuelve a intentar.';
  if (/invalid login credentials/i.test(raw)) return 'Contraseña incorrecta o usuario no encontrado.';
  if (/email not confirmed/i.test(raw)) return 'Debes confirmar tu correo para ingresar.';
  if (/captcha requerido|captcha invalido|captcha token|captcha verification/i.test(raw)) {
    return 'No se pudo validar el captcha. Recarga la página y vuelve a intentarlo.';
  }
  return raw;
}

function getLoginErrorMessage(err) {
  if (!err) return 'Unknown login error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Unknown login error';
  return String(err);
}

async function reportPortalLoginError(identifier, err, meta = {}) {
  try {
    await fetchJsonWithTimeout('/api/portal/client-error', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier,
        message: getLoginErrorMessage(err),
        meta: {
          route: window.location.pathname,
          ...meta,
        },
      }),
    }, 8000, 'El reporte de error');
  } catch {
    // no-op
  }
}

function reportCaptchaGuardBlock(context, captcha = {}, extraMeta = {}) {
  void reportPortalLoginError(
    'portal.ingresar.captcha.blocked',
    new Error(captcha?.error || 'Captcha guard blocked request'),
    {
      context,
      reason: captcha?.reason || 'unknown',
      hasBypass: Boolean(captcha?.bypass),
      hasToken: Boolean(captcha?.token),
      ...extraMeta,
    },
  );
}

async function loadSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import('@lib/supabaseBrowser')
      .then(({ getSupabaseBrowserClient }) => getSupabaseBrowserClient())
      .catch((err) => {
        supabaseClientPromise = null;
        throw err;
      });
  }
  return supabaseClientPromise;
}

async function getSupabaseClientOrShowError() {
  try {
    return await loadSupabaseClient();
  } catch (err) {
    console.error('Supabase client not available:', err);
    showStatus('El portal no está configurado. Escríbenos por WhatsApp.', 'error');
    return null;
  }
}

function warmSupabaseClient() {
  void loadSupabaseClient().catch(() => {});
}

function buildSupabasePasswordPayload(email, password, captcha = {}) {
  const payload = { email, password };
  if (captcha?.token && !captcha?.bypass) {
    payload.options = { captchaToken: captcha.token };
  }
  return payload;
}

async function startOAuth(provider, label, btn) {
  const captcha = await getTurnstileTokenIfRequired();
  if (!captcha.ok) {
    reportCaptchaGuardBlock(`oauth:${provider}`, captcha);
    showStatus(captcha.error || 'Captcha inválido.', 'error');
    resetTurnstile();
    return;
  }
  if (captcha.token && !captcha.bypass) {
    const captchaCheck = await verifyTurnstileTokenStrict(captcha.token, `oauth:${provider}`);
    if (!captchaCheck.ok) {
      reportCaptchaGuardBlock(`oauth:${provider}`, { ...captcha, error: captchaCheck.error, reason: 'server_rejected' });
      showStatus(captchaCheck.error || 'Captcha inválido.', 'error');
      resetTurnstile();
      return;
    }
  }

  const supabase = await getSupabaseClientOrShowError();
  if (!supabase) return;

  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }
  showStatus(`Redirigiendo a ${label}...`, 'loading');

  try {
    const redirectTo = new URL(getSafeNextPath(), window.location.origin).toString();
    const { data, error } = await withTimeout(
      supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      }),
      REQUEST_TIMEOUT_MS,
      `El ingreso con ${label}`,
    );

    if (error) throw error;
    if (data?.url) {
      window.location.href = data.url;
    } else {
      showStatus('No se pudo iniciar la autenticación.', 'error');
    }
  } catch (err) {
    console.error('[oauth] error', err);
    void reportPortalLoginError('portal.ingresar.oauth', err, { provider });
    showStatus('No se pudo iniciar la autenticación. Intenta de nuevo.', 'error');
    resetTurnstile();
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50');
    }
  }
}

toggleMagicBtn?.addEventListener('click', () => {
  passwordForm?.classList.add('hidden');
  magicForm?.classList.remove('hidden');
  if (passwordEmailInput?.value) magicEmailInput.value = passwordEmailInput.value;
  magicForm?.scrollIntoView({ behavior: 'smooth' });
});

cancelMagicBtn?.addEventListener('click', () => {
  magicForm?.classList.add('hidden');
  passwordForm?.classList.remove('hidden');
});

togglePasswordViewBtn?.addEventListener('click', () => {
  if (!passwordInput) return;
  const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
  passwordInput.setAttribute('type', type);
  togglePasswordViewBtn.classList.toggle('text-[#293C74]');
});

oauthGoogleBtn?.addEventListener('click', () => {
  startOAuth('google', 'Google', oauthGoogleBtn);
});

oauthFacebookBtn?.addEventListener('click', () => {
  startOAuth('facebook', 'Facebook', oauthFacebookBtn);
});

magicForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = magicEmailInput?.value?.trim();
  if (!email) return;

  const captcha = await getTurnstileTokenIfRequired();
  if (!captcha.ok) {
    reportCaptchaGuardBlock('recovery-link', captcha, { emailHint: maskEmailHint(email) });
    showStatus(captcha.error || 'Captcha inválido.', 'error');
    resetTurnstile();
    return;
  }

  showStatus('Enviando enlace de restablecimiento...', 'loading');
  const btn = document.getElementById('btn-submit-magic');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }

  try {
    const redirectTo = buildActivationRedirectTo();
    const { res, data: payload } = await fetchJsonWithTimeout('/api/auth/send-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, kind: 'recovery', redirectTo, turnstileToken: captcha.token, enforceTurnstile: true }),
    }, REQUEST_TIMEOUT_MS, 'El envío del enlace');
    if (!res.ok || !payload?.ok) throw new Error(payload?.error || 'Error al enviar enlace.');

    showStatus('¡Enlace enviado! Revisa tu correo para restablecer.', 'success');
    magicEmailInput.value = '';
  } catch (err) {
    void reportPortalLoginError('portal.ingresar.recovery-link', err, { hasCaptcha: Boolean(captcha?.token) });
    showStatus(err?.message || 'Error al enviar enlace.', 'error');
    resetTurnstile();
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50');
    }
  }
});

passwordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = passwordEmailInput?.value?.trim();
  const password = passwordInput?.value?.trim();
  if (!email || !password) return;

  const supabaseLoad = loadSupabaseClient().catch((err) => {
    console.warn('Supabase client warmup failed, trying API fallback if possible:', err);
    return null;
  });

  const captcha = await getTurnstileTokenIfRequired();
  if (!captcha.ok) {
    reportCaptchaGuardBlock('password-login', captcha, { emailHint: maskEmailHint(email) });
    showStatus(captcha.error || 'Captcha inválido.', 'error');
    resetTurnstile();
    return;
  }

  showStatus('Validando contraseña...', 'loading');
  const btn = document.getElementById('btn-submit-password');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }

  try {
    const supabase = await supabaseLoad;
    if (!supabase) {
      // Fallback directly to API if Supabase client is missing
      console.warn('Supabase client missing, trying API login directly.');
      await tryApiLogin(email, password, captcha.token);
      return;
    }

    const supabasePayload = buildSupabasePasswordPayload(email, password, captcha);
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword(supabasePayload),
      REQUEST_TIMEOUT_MS,
      'El inicio de sesión',
    );

    if (error) {
      console.warn('Supabase login failed, trying API fallback...', error.message);
      try {
        await tryApiLogin(email, password, captcha.token);
        return;
      } catch (fallbackErr) {
        console.warn('API fallback failed, keeping Supabase error as source of truth:', fallbackErr?.message || fallbackErr);
        throw error;
      }
    }

    showStatus('Acceso correcto. Entrando...', 'success');
    window.location.href = getSafeNextPath();
  } catch (err) {
    console.error(err);
    void reportPortalLoginError('portal.ingresar.password', err, { hasCaptcha: Boolean(captcha?.token) });
    showStatus(resolveLoginErrorMessage(err), 'error');
    resetTurnstile();
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50');
    }
  }
});

async function tryApiLogin(email, password, token) {
  const { res, data } = await fetchJsonWithTimeout('/api/portal/password-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken: token || '' })
  }, REQUEST_TIMEOUT_MS, 'El ingreso administrativo');

  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Credenciales inválidas');
  }

  showStatus('Acceso administrativo correcto. Entrando...', 'success');
  // Force reload to ensure cookie is picked up
  setTimeout(() => window.location.href = getSafeNextPath(), 500);
}

passkeyBtn?.addEventListener('click', async () => {
  showStatus('Verificando soporte de Passkeys...', 'loading');
  try {
    const captcha = await getTurnstileTokenIfRequired();
    if (!captcha.ok) {
      reportCaptchaGuardBlock('passkey-login', captcha);
      showStatus(captcha.error || 'Captcha inválido.', 'error');
      resetTurnstile();
      return;
    }
    if (captcha.token && !captcha.bypass) {
      const captchaCheck = await verifyTurnstileTokenStrict(captcha.token, 'passkey');
      if (!captchaCheck.ok) {
        reportCaptchaGuardBlock('passkey-login', { ...captcha, error: captchaCheck.error, reason: 'server_rejected' });
        showStatus(captchaCheck.error || 'Captcha inválido.', 'error');
        resetTurnstile();
        return;
      }
    }
    const supabase = await getSupabaseClientOrShowError();
    if (!supabase) return;
    if (typeof supabase.auth.signInWithSSO !== 'function') {
      throw new Error('Passkeys no configurado en esta versión.');
    }
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: 'ministeriomana.com',
      options: {
        redirectTo: new URL(getSafeNextPath(), window.location.origin).toString(),
      },
    });

    if (error) throw error;
    if (data?.url) window.location.href = data.url;
    else throw new Error('Debes configurar Passkeys en tu cuenta primero.');
  } catch (err) {
    void reportPortalLoginError('portal.ingresar.passkey', err);
    showStatus(err?.message || 'Función Beta: Contacta soporte para activar.', 'error');
    setTimeout(() => {
      if (statusContainer) statusContainer.classList.add('hidden');
    }, 3000);
  }
});

[passwordEmailInput, passwordInput, oauthGoogleBtn, oauthFacebookBtn, passkeyBtn].forEach((el) => {
  el?.addEventListener('focus', warmSupabaseClient, { once: true });
  el?.addEventListener('pointerdown', warmSupabaseClient, { once: true, passive: true });
  el?.addEventListener('focus', warmTurnstile, { once: true });
  el?.addEventListener('pointerdown', warmTurnstile, { once: true, passive: true });
});

const scheduleTurnstileWarmup = () => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmTurnstile, { timeout: 1200 });
    return;
  }
  window.setTimeout(warmTurnstile, 250);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleTurnstileWarmup, { once: true });
} else {
  scheduleTurnstileWarmup();
}

syncReturnLinks();
