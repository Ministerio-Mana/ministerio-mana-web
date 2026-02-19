import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';
import { gsap } from 'gsap';

window.addEventListener('load', () => {
  gsap.to('#login-card', { opacity: 1, y: 0, duration: 1.2, ease: 'power4.out', delay: 0.2 });

  const starsContainer = document.getElementById('stars-container');
  if (starsContainer) {
    for (let i = 0; i < 30; i += 1) {
      const star = document.createElement('div');
      star.className = 'absolute w-[2px] h-[2px] bg-white rounded-full';
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      starsContainer.appendChild(star);
      gsap.to(star, { opacity: 0.2, duration: 2 + Math.random() * 3, repeat: -1, yoyo: true, delay: Math.random() * 5 });
    }
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
    const iframe = widget?.querySelector?.('iframe');
    if (window.turnstile && iframe) return true;
    await sleep(120);
  }
  return false;
}

function resetTurnstile() {
  if (window.turnstile && typeof window.turnstile.reset === 'function') {
    window.turnstile.reset();
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

  // If widget has key but did not render, do NOT bypass.
  // Backend requires captcha in production, so sending empty token causes hard failure.
  let iframe = widget.querySelector('iframe');
  if (!window.turnstile || !iframe) {
    const ready = await waitForTurnstileReady(widget, TURNSTILE_RENDER_WAIT_MS);
    if (ready) {
      iframe = widget.querySelector('iframe');
    }
  }

  if (!window.turnstile || !iframe) {
    console.warn('[Turnstile] Widget has site key but failed to render.');
    return {
      ok: false,
      error: 'No cargó el captcha (Cloudflare). Desactiva bloqueadores/Brave Shields, recarga e intenta de nuevo.',
      reason: 'widget_not_rendered',
    };
  }

  // Widget is configured AND rendered, so validation is required
  const token = window.turnstile?.getResponse?.() || '';
  if (!token) {
    return { ok: false, error: 'Completa la verificación antes de continuar.', reason: 'token_missing' };
  }

  return { ok: true, token, reason: 'ok' };
}

async function verifyTurnstileToken(token) {
  if (!token) return { ok: false, error: 'Captcha requerido.' };
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
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'No pudimos validar el captcha. Intenta de nuevo.' };
  }
}

async function verifyTurnstileTokenSoft(token, context = 'generic') {
  if (!token) return false;
  const result = await verifyTurnstileToken(token);
  if (!result.ok) {
    console.warn(`[Turnstile] Soft verify failed (${context}):`, result.error);
  }
  return result.ok;
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

  gsap.from(statusContainer, { scale: 0.9, duration: 0.4, ease: 'back.out' });
}

function resolveLoginErrorMessage(err) {
  const raw = String(err?.message || '').trim();
  if (!raw) return 'No se pudo iniciar sesión. Intenta de nuevo.';
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
    await fetch('/api/portal/client-error', {
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
    });
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

function buildSupabasePasswordPayload(email, password, captcha = {}) {
  const payload = { email, password };
  if (captcha?.token && !captcha?.bypass) {
    payload.options = { captchaToken: captcha.token };
  }
  return payload;
}

async function startOAuth(provider, label, btn) {
  if (!supabase) {
    showStatus('El portal no está configurado. Escríbenos por WhatsApp.', 'error');
    return;
  }

  const captcha = await getTurnstileTokenIfRequired();
  if (!captcha.ok) {
    reportCaptchaGuardBlock(`oauth:${provider}`, captcha);
    showStatus(captcha.error || 'Captcha inválido.', 'error');
    resetTurnstile();
    return;
  }
  if (captcha.token && !captcha.bypass) {
    await verifyTurnstileTokenSoft(captcha.token, `oauth:${provider}`);
  }

  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }
  showStatus(`Redirigiendo a ${label}...`, 'loading');

  try {
    const redirectTo = `${window.location.origin}/portal`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

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

let supabase = null;
try {
  supabase = getSupabaseBrowserClient();
} catch (err) {
  console.error('Supabase client not available:', err);
  showStatus('El portal no está configurado. Escríbenos por WhatsApp.', 'error');
}

supabase?.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    showStatus('¡Sesión iniciada! Entrando...', 'success');
    window.location.href = '/portal';
  }
});

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
    const redirectTo = `${window.location.origin}/portal/activar?next=${encodeURIComponent('/portal')}`;
    const res = await fetch('/api/auth/send-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, kind: 'recovery', redirectTo, turnstileToken: captcha.token, enforceTurnstile: true }),
    });
    const payload = await res.json();
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
    if (!supabase) {
      // Fallback directly to API if Supabase client is missing
      console.warn('Supabase client missing, trying API login directly.');
      await tryApiLogin(email, password, captcha.token);
      return;
    }

    const supabasePayload = buildSupabasePasswordPayload(email, password, captcha);
    const { error } = await supabase.auth.signInWithPassword(supabasePayload);

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

    // Only verify Turnstile token if we actually have one (widget rendered)
    if (captcha.token && !captcha.bypass) {
      await verifyTurnstileTokenSoft(captcha.token, 'password-login-post-supabase');
    }

    showStatus('Acceso correcto. Entrando...', 'success');
    window.location.href = '/portal';
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
  const res = await fetch('/api/portal/password-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken: token || '' })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Credenciales inválidas');
  }

  showStatus('Acceso administrativo correcto. Entrando...', 'success');
  // Force reload to ensure cookie is picked up
  setTimeout(() => window.location.href = '/portal', 500);
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
      await verifyTurnstileTokenSoft(captcha.token, 'passkey');
    }
    if (!supabase) {
      throw new Error('El portal no está configurado.');
    }
    if (typeof supabase.auth.signInWithSSO !== 'function') {
      throw new Error('Passkeys no configurado en esta versión.');
    }
    const { data, error } = await supabase.auth.signInWithSSO({
      domain: 'ministeriomana.com',
      options: {
        redirectTo: `${window.location.origin}/portal`,
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
