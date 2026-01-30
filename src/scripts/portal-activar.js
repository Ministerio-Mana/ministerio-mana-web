import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

const supabase = getSupabaseBrowserClient();
const form = document.getElementById('activate-form');
const password = document.getElementById('password');
const confirm = document.getElementById('password-confirm');
const status = document.getElementById('activate-status');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeIcon = document.getElementById('eye-icon');
const eyeOffIcon = document.getElementById('eye-off-icon');
const toggleConfirmBtn = document.getElementById('toggle-password-confirm');
const eyeConfirm = document.getElementById('eye-icon-confirm');
const eyeOffConfirm = document.getElementById('eye-off-icon-confirm');
const guard = document.getElementById('activate-guard');
const retryBtn = document.getElementById('activate-retry');
let hasRecoveryContext = false;

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
  const accessToken = hashParams.get('access_token') || hashParams.get('/access_token') || searchParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') || hashParams.get('/refresh_token') || searchParams.get('refresh_token');
  const type = hashParams.get('type') || hashParams.get('/type') || searchParams.get('type');
  const error = hashParams.get('error') || hashParams.get('/error') || searchParams.get('error');
  const errorDescription =
    hashParams.get('error_description') || hashParams.get('/error_description') || searchParams.get('error_description');
  return { accessToken, refreshToken, type, error, errorDescription };
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

  if (authCode) {
    const { data: codeData, error } = await supabase.auth.exchangeCodeForSession(authCode);
    if (codeData?.session) return true;
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
  if (status) status.textContent = 'Validando enlace...';
  let ok = false;
  try {
    ok = await withTimeout(resolveSessionFromUrl(), 10000);
  } catch (err) {
    setGuardMessage(err?.message || 'No se pudo validar el enlace. Intenta de nuevo.');
    if (status) status.textContent = '';
    showRetry(true);
    return false;
  }
  if (ok) {
    guard?.classList.add('hidden');
    setFormDisabled(false);
    showRetry(false);
    if (status) status.textContent = '';
    const url = new URL(window.location.href);
    if (url.hash) {
      history.replaceState({}, document.title, `${url.pathname}${url.search}`);
    }
    return true;
  }

  const { error, errorDescription } = getTokenParams();
  if (error === 'access_denied') {
    setGuardMessage('El enlace no pertenece a este dominio. Abre el link desde el dominio correcto.');
  } else if (errorDescription) {
    setGuardMessage(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
  } else {
    setGuardMessage('El enlace ya expiró o fue usado. Solicita uno nuevo desde el portal.');
  }
  if (status) status.textContent = '';
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
  const { accessToken, refreshToken, type, error } = getTokenParams();
  const hasRecoveryType = type === 'recovery';
  const hasToken = Boolean(accessToken || refreshToken || error);
  const hasCode = searchParams.has('code');
  hasRecoveryContext = hasRecoveryType || hasToken || hasCode;

  if (hasRecoveryContext) {
    await validateRecoveryLink();
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
  status.textContent = '';
  const value = password?.value?.trim();
  const confirmValue = confirm?.value?.trim();
  if (!value || value.length < 6) {
    status.textContent = 'La contraseña debe tener al menos 6 caracteres.';
    return;
  }
  if (value !== confirmValue) {
    status.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if (!hasRecoveryContext) {
    status.textContent = 'Debes abrir el enlace de recuperación para cambiar la contraseña.';
    return;
  }
  setFormDisabled(true);
  status.textContent = 'Guardando contraseña...';
  try {
    const sessionCheck = await ensureSessionReady();
    if (!sessionCheck.ok) {
      status.textContent = 'Sesión no válida. Reintenta la validación del enlace.';
      showRetry(true);
      setFormDisabled(false);
      return;
    }
    const result = await withTimeout(supabase.auth.updateUser({ password: value }), 12000);
    const { error } = result || {};
    if (error) throw error;
  } catch (err) {
    status.textContent = err?.message || 'No se pudo guardar.';
    showRetry(true);
    setFormDisabled(false);
    return;
  }
  const url = new URL(window.location.href);
  const next = url.searchParams.get('next') || '/portal';
  window.location.href = next;
});
