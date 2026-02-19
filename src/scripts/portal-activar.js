import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

let supabase = null;
try {
  supabase = getSupabaseBrowserClient();
  console.log('[Activar] Supabase client initialized');
} catch (err) {
  console.error('[Activar] Supabase client error:', err);
}

const form = document.getElementById('activate-form');
const password = document.getElementById('password');
const confirm = document.getElementById('password-confirm');
const status = document.getElementById('activate-status');
const statusContainer = document.getElementById('activate-status-container');
const statusWrapper = document.getElementById('activate-status-wrapper');
const statusIcon = document.getElementById('activate-status-icon');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeIcon = document.getElementById('eye-icon');
const eyeOffIcon = document.getElementById('eye-off-icon');
const toggleConfirmBtn = document.getElementById('toggle-password-confirm');
const eyeConfirm = document.getElementById('eye-icon-confirm');
const eyeOffConfirm = document.getElementById('eye-off-icon-confirm');
const guard = document.getElementById('activate-guard');
const retryBtn = document.getElementById('activate-retry');
let hasRecoveryContext = false;

function resetTurnstile() {
  if (window.turnstile && typeof window.turnstile.reset === 'function') {
    window.turnstile.reset();
  }
}

async function verifyTurnstileIfPresent() {
  const widget = document.querySelector('.cf-turnstile');
  if (!widget) return { ok: true, bypass: true, token: '' };

  const token = window.turnstile?.getResponse?.() || '';
  if (!token) {
    return { ok: false, error: 'Completa la verificación antes de continuar.' };
  }

  try {
    const res = await fetch('/api/turnstile/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || 'Captcha inválido. Intenta de nuevo.' };
    }
    return { ok: true, token };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'No pudimos validar el captcha. Intenta de nuevo.' };
  }
}

function showStatus(msg, type = 'loading') {
  if (!status || !statusContainer || !statusWrapper || !statusIcon) return;
  statusContainer.classList.remove('hidden');
  status.textContent = msg;

  // Update icon
  statusIcon.className = type === 'error'
    ? 'w-2 h-2 rounded-full bg-red-500'
    : type === 'success'
      ? 'w-2 h-2 rounded-full bg-green-500'
      : 'w-2 h-2 rounded-full bg-blue-500 animate-ping';

  // Update wrapper and text styles
  if (type === 'error') {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-red-50 border border-red-200';
    status.className = 'text-sm font-semibold text-red-700';
  } else if (type === 'success') {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-green-50 border border-green-200';
    status.className = 'text-sm font-semibold text-green-700';
  } else {
    statusWrapper.className = 'inline-flex items-center gap-2 px-4 py-3 rounded-full bg-blue-50 border border-blue-200';
    status.className = 'text-sm font-semibold text-blue-700';
  }
}


function setFormDisabled(disabled) {
  form?.querySelectorAll('input, button').forEach((el) => {
    if (disabled) {
      el.setAttribute('disabled', 'disabled');
      el.classList.add('opacity-60', 'cursor-not-allowed');
    } else {
      el.removeAttribute('disabled');
      el.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });
}

function setGuardMessage(message) {
  if (!guard) return;
  guard.textContent = message;
  guard.classList.remove('hidden');
}

function showRetry(show) {
  if (!retryBtn) return;
  if (show) {
    retryBtn.classList.remove('hidden');
  } else {
    retryBtn.classList.add('hidden');
  }
}

function parseParams(rawValue) {
  if (!rawValue) return new URLSearchParams();
  const value = rawValue.replace(/^#/, '').replace(/^\?/, '').replace(/^\//, '');
  return new URLSearchParams(value);
}

function getUrlParams() {
  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const hashParams = parseParams(url.hash);
  return { url, searchParams, hashParams };
}

function getTokenParams() {
  const { searchParams, hashParams } = getUrlParams();
  const tokenHash = searchParams.get('token_hash') || hashParams.get('token_hash');
  const token = searchParams.get('token') || hashParams.get('token');
  const accessToken = hashParams.get('access_token') || hashParams.get('/access_token') || searchParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') || hashParams.get('/refresh_token') || searchParams.get('refresh_token');
  const type = hashParams.get('type') || hashParams.get('/type') || searchParams.get('type') || searchParams.get('verification_type');
  const email = searchParams.get('email') || hashParams.get('email') || '';
  const error = hashParams.get('error') || hashParams.get('/error') || searchParams.get('error');
  const errorCode = hashParams.get('error_code') || hashParams.get('/error_code') || searchParams.get('error_code');
  const errorDescription =
    hashParams.get('error_description') || hashParams.get('/error_description') || searchParams.get('error_description');
  return { tokenHash, token, accessToken, refreshToken, type, email, error, errorCode, errorDescription };
}

async function reportActivationIssue(message, meta = {}) {
  try {
    await fetch('/api/portal/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier: 'portal.activar.token',
        message,
        meta,
      }),
      keepalive: true,
    });
  } catch (_err) {
    // No interrumpir UX por errores de auditoria.
  }
}

function normalizeHash() {
  if (window.location.hash && window.location.hash.startsWith('#/')) {
    const cleanHash = window.location.hash.replace('#/', '#');
    const url = new URL(window.location.href);
    history.replaceState({}, document.title, `${url.pathname}${url.search}${cleanHash}`);
  }
}

async function resolveSessionFromUrl() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) return true;

  const { url } = getUrlParams();
  const authCode = url.searchParams.get('code');
  const tokens = getTokenParams();
  const otpType = tokens?.type === 'email_change_current' || tokens?.type === 'email_change_new' ? 'email_change' : tokens?.type;
  const normalizedEmail = String(tokens?.email || '').trim().toLowerCase();

  if (tokens?.tokenHash && otpType) {
    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: tokens.tokenHash,
      type: otpType,
    });
    if (otpData?.session) return true;
    if (otpError) {
      console.warn('[Activar] verifyOtp failed', otpError.message || otpError);
      void reportActivationIssue('verifyOtp(token_hash) failed', {
        otp_type: otpType,
        has_token_hash: true,
        has_token: Boolean(tokens?.token),
        has_email: Boolean(normalizedEmail),
        error: otpError.message || String(otpError),
      });
    }
  }

  if (tokens?.token && otpType && normalizedEmail) {
    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: tokens.token,
      type: otpType,
    });
    if (otpData?.session) return true;
    if (otpError) {
      console.warn('[Activar] verifyOtp(email,token) failed', otpError.message || otpError);
      void reportActivationIssue('verifyOtp(email,token) failed', {
        otp_type: otpType,
        has_token_hash: false,
        has_token: true,
        has_email: true,
        error: otpError.message || String(otpError),
      });
    }
  }

  if (authCode) {
    const { data: codeData, error } = await supabase.auth.exchangeCodeForSession(authCode);
    if (codeData?.session) return true;
    if (error) {
      void reportActivationIssue('exchangeCodeForSession failed', {
        has_code: true,
        has_access_token: Boolean(tokens?.accessToken),
        has_refresh_token: Boolean(tokens?.refreshToken),
        error: error.message || String(error),
      });
    }
    if (error && tokens?.accessToken && tokens?.refreshToken) {
      const { data: tokenData } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (tokenData?.session) return true;
    }
  } else if (tokens?.accessToken && tokens?.refreshToken) {
    const { data: tokenData } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (tokenData?.session) return true;
  }

  return false;
}

async function validateRecoveryLink() {
  setFormDisabled(true);
  showRetry(false);
  showStatus('Validando enlace...', 'loading');
  let ok = false;
  try {
    ok = await withTimeout(resolveSessionFromUrl(), 10000);
  } catch (err) {
    setGuardMessage(err?.message || 'No se pudo validar el enlace. Intenta de nuevo.');
    statusContainer?.classList.add('hidden');
    showRetry(true);
    return false;
  }
  if (ok) {
    guard?.classList.add('hidden');
    setFormDisabled(false);
    showRetry(false);
    statusContainer?.classList.add('hidden');
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next');
    const cleanUrl = `${url.pathname}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    history.replaceState({}, document.title, cleanUrl);
    return true;
  }

  const { error, errorCode, errorDescription } = getTokenParams();
  const normalizedDescription = (errorDescription || '').toLowerCase();
  void reportActivationIssue('activation link invalid', {
    error: error || null,
    error_code: errorCode || null,
    error_description: errorDescription || null,
  });
  if (error === 'access_denied' && (errorCode === 'otp_expired' || normalizedDescription.includes('expired'))) {
    setGuardMessage('El enlace expiró o ya fue usado. Solicita uno nuevo desde el portal.');
  } else if (error === 'access_denied' && normalizedDescription.includes('invalid')) {
    setGuardMessage('El enlace ya no es válido. Solicita uno nuevo desde el portal.');
  } else if (error === 'access_denied') {
    setGuardMessage('El enlace no pertenece a este dominio. Abre el link desde el dominio correcto.');
  } else if (errorDescription) {
    setGuardMessage(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
  } else {
    setGuardMessage('El enlace ya expiró o fue usado. Solicita uno nuevo desde el portal.');
  }
  statusContainer?.classList.add('hidden');
  showRetry(true);
  return false;
}

async function ensureSessionReady() {
  const { data, error } = await supabase.auth.getSession();
  if (data?.session) return { ok: true };
  if (error) return { ok: false, error };
  const recovered = await resolveSessionFromUrl();
  return recovered ? { ok: true } : { ok: false, error: new Error('Sesion no valida') };
}

async function withTimeout(promise, timeoutMs = 12000) {
  let timeoutId;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Tiempo de espera agotado. Intenta de nuevo.')), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

togglePasswordBtn?.addEventListener('click', () => {
  const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
  password.setAttribute('type', type);
  if (type === 'text') {
    eyeIcon?.classList.add('hidden');
    eyeOffIcon?.classList.remove('hidden');
  } else {
    eyeIcon?.classList.remove('hidden');
    eyeOffIcon?.classList.add('hidden');
  }
});

toggleConfirmBtn?.addEventListener('click', () => {
  const type = confirm.getAttribute('type') === 'password' ? 'text' : 'password';
  confirm.setAttribute('type', type);
  if (type === 'text') {
    eyeConfirm?.classList.add('hidden');
    eyeOffConfirm?.classList.remove('hidden');
  } else {
    eyeConfirm?.classList.remove('hidden');
    eyeOffConfirm?.classList.add('hidden');
  }
});

async function guardSession() {
  const { searchParams } = getUrlParams();
  const { tokenHash, token, accessToken, refreshToken, type, error, errorCode, errorDescription } = getTokenParams();
  const hasRecoveryType = type === 'recovery';
  const hasToken = Boolean(tokenHash || token || accessToken || refreshToken || error);
  const hasCode = searchParams.has('code');
  hasRecoveryContext = hasRecoveryType || hasToken || hasCode;

  if (hasRecoveryContext) {
    // No validamos de forma automática para evitar consumo temprano del token
    // por prefetchers/escáneres de correo. La validación sucede al submit o
    // cuando el usuario pulsa "Reintentar validación".
    if (error) {
      const normalizedDescription = (errorDescription || '').toLowerCase();
      if (error === 'access_denied' && (errorCode === 'otp_expired' || normalizedDescription.includes('expired'))) {
        setGuardMessage('El enlace expiró o ya fue usado. Solicita uno nuevo desde el portal.');
      } else if (error === 'access_denied' && normalizedDescription.includes('invalid')) {
        setGuardMessage('El enlace ya no es válido. Solicita uno nuevo desde el portal.');
      } else if (error === 'access_denied') {
        setGuardMessage('El enlace no pertenece a este dominio. Abre el link desde el dominio correcto.');
      } else if (errorDescription) {
        setGuardMessage(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      } else {
        setGuardMessage('El enlace no es válido. Solicita uno nuevo desde el portal.');
      }
      setFormDisabled(true);
      showRetry(true);
      return;
    }
    guard?.classList.add('hidden');
    statusContainer?.classList.add('hidden');
    setFormDisabled(false);
    showRetry(false);
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    setGuardMessage('Para cambiar tu contraseña, abre el enlace de recuperación enviado a tu correo.');
    setFormDisabled(true);
    showRetry(false);
    return;
  }
  setGuardMessage(
    'Abre el enlace que llegó a tu correo para activar tu cuenta. Si no lo ves, revisa la bandeja de spam o solicita un nuevo enlace desde el portal.',
  );
  setFormDisabled(true);
  showRetry(false);
}

normalizeHash();
guardSession();

retryBtn?.addEventListener('click', async () => {
  if (!hasRecoveryContext) return;
  await validateRecoveryLink();
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!status) return;
  statusContainer?.classList.add('hidden');
  const value = password?.value?.trim();
  const confirmValue = confirm?.value?.trim();
  if (!value || value.length < 6) {
    showStatus('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (value !== confirmValue) {
    showStatus('Las contraseñas no coinciden.', 'error');
    return;
  }
  if (!hasRecoveryContext) {
    showStatus('Debes abrir el enlace de recuperación para cambiar la contraseña.', 'error');
    return;
  }

  const captcha = await verifyTurnstileIfPresent();
  if (!captcha.ok) {
    showStatus(captcha.error || 'Captcha inválido.', 'error');
    resetTurnstile();
    return;
  }

  setFormDisabled(true);
  showStatus('Guardando contraseña...', 'loading');

  console.log('[Activar] Starting password update...');

  try {
    const sessionCheck = await ensureSessionReady();
    console.log('[Activar] Session check:', sessionCheck);

    if (!sessionCheck.ok) {
      await validateRecoveryLink();
      showStatus('Sesión no válida. Solicita un enlace nuevo si el problema persiste.', 'error');
      showRetry(true);
      setFormDisabled(false);
      return;
    }

    console.log('[Activar] Calling updateUser...');
    const result = await withTimeout(supabase.auth.updateUser({ password: value }), 12000);
    console.log('[Activar] updateUser result:', result);

    const { error } = result || {};
    if (error) {
      console.error('[Activar] updateUser error:', error);
      throw error;
    }

    console.log('[Activar] Password updated successfully, redirecting...');
    showStatus('¡Contraseña guardada! Redirigiendo...', 'success');

  } catch (err) {
    console.error('[Activar] Error:', err);
    showStatus(err?.message || 'No se pudo guardar.', 'error');
    showRetry(true);
    setFormDisabled(false);
    return;
  }

  // Redirect with a small delay to ensure the message is visible
  const url = new URL(window.location.href);
  const next = url.searchParams.get('next') || '/portal';
  console.log('[Activar] Redirecting to:', next);

  setTimeout(() => {
    window.location.href = next;
  }, 500);
});
