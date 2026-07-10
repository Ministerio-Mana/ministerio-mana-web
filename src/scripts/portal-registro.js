const form = document.getElementById('register-form');
const btnSubmit = document.getElementById('btn-submit-register');
const statusEl = document.getElementById('register-status');
const passwordInput = document.getElementById('reg-password');
const toggleBtn = document.getElementById('toggle-password-reg');
const TURNSTILE_RENDER_WAIT_MS = 3000;
const SIGNUP_TIMEOUT_MS = 22000;

function getSafeNextPath() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || '/portal';
    if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/portal';
    return next;
}

function syncLoginLink() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason') || '';
    const loginLink = document.querySelector('a[href^="/portal/ingresar"]');
    if (!loginLink) return;
    const url = new URL('/portal/ingresar', window.location.origin);
    url.searchParams.set('next', getSafeNextPath());
    if (reason) url.searchParams.set('reason', reason);
    loginLink.href = `${url.pathname}${url.search}`;
}

function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
        window.turnstile.reset();
    }
}

function showRegistrationResult(title, message, tone) {
    if (!statusEl) return;
    statusEl.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('span');
    detail.className = 'mt-1 block text-sm';
    detail.textContent = message;
    statusEl.append(heading, detail);
    statusEl.classList.remove(
        'hidden',
        'bg-red-50',
        'text-red-600',
        'text-red-800',
        'bg-amber-50',
        'text-amber-700',
        'bg-green-50',
        'text-green-600',
    );
    statusEl.classList.add(...tone);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTurnstileTokenField(widget) {
    const selectors = 'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]';
    const inWidget = widget?.querySelector?.(selectors);
    if (inWidget?.value) return String(inWidget.value).trim();
    const inDocument = document.querySelector(selectors);
    if (inDocument?.value) return String(inDocument.value).trim();
    return '';
}

async function waitForTurnstileReady(widget, timeoutMs = TURNSTILE_RENDER_WAIT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
        if (window.turnstile || readTurnstileTokenField(widget)) return true;
        await sleep(120);
    }
    return false;
}

async function getTurnstileToken() {
    const widget = document.querySelector('.cf-turnstile');
    if (!widget) return { ok: true, token: '' };

    const siteKey = widget.getAttribute('data-sitekey');
    if (!siteKey) {
        return { ok: false, error: 'Captcha no configurado. Recarga la página o contacta soporte.' };
    }

    if (!window.turnstile && !readTurnstileTokenField(widget)) {
        await waitForTurnstileReady(widget, TURNSTILE_RENDER_WAIT_MS);
    }

    if (!window.turnstile && !readTurnstileTokenField(widget)) {
        return {
            ok: false,
            error: 'No cargó el captcha. Recarga la página, desactiva bloqueadores y vuelve a intentarlo.',
        };
    }

    const token = (window.turnstile?.getResponse?.() || readTurnstileTokenField(widget) || '').trim();
    if (!token) return { ok: false, error: 'Completa la verificación antes de continuar.' };
    return { ok: true, token };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SIGNUP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error('La solicitud tardó demasiado. Revisa tu conexión e intenta de nuevo.');
        }
        throw err;
    } finally {
        window.clearTimeout(timeout);
    }
}

// Password Toggle
toggleBtn?.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
    const isVisible = type === 'text';
    toggleBtn.setAttribute('aria-pressed', String(isVisible));
    toggleBtn.setAttribute('aria-label', isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

syncLoginLink();

form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!btnSubmit) return;

    // Get values
    const firstName = document.getElementById('reg-name').value;
    const lastName = document.getElementById('reg-lastname').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = 'Creando cuenta...';
    btnSubmit.disabled = true;
    statusEl?.classList.add('hidden');

    try {
        const captcha = await getTurnstileToken();
        if (!captcha.ok) {
            throw new Error(captcha.error || 'Captcha requerido.');
        }
        // Use our backend endpoint instead of Supabase Auth directly
        const res = await fetchWithTimeout('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                password,
                firstName,
                lastName,
                turnstileToken: captcha.token,
                redirectTo: `${window.location.origin}/portal/activar?next=${encodeURIComponent(getSafeNextPath())}`,
            })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Error al registrarse');
        }

        // Success
        statusEl.classList.remove('hidden', 'bg-red-50', 'text-red-600', 'text-red-800', 'bg-amber-50', 'text-amber-700');
        form.reset();

        if (data.alreadyExists) {
            showRegistrationResult(
                'Cuenta ya registrada',
                data.message || 'Tu correo ya existe. Usa "Olvidé mi contraseña" para recuperar acceso.',
                ['bg-amber-50', 'text-amber-700'],
            );
        } else {
            showRegistrationResult(
                '¡Cuenta creada!',
                `Revisa tu correo ${email} para activar tu cuenta y establecer tu acceso.`,
                ['bg-green-50', 'text-green-600'],
            );
        }
        btnSubmit.textContent = 'Ir a Login';
        btnSubmit.disabled = false;
        btnSubmit.onclick = () => window.location.href = `/portal/ingresar?next=${encodeURIComponent(getSafeNextPath())}`;

    } catch (err) {
        console.error('Registration error:', err);
        resetTurnstile();
        if (statusEl) {
            statusEl.classList.remove('hidden', 'bg-green-50', 'text-green-600');
            statusEl.classList.add('bg-red-50', 'text-red-800');
            statusEl.textContent = err.message || 'Error al registrarse. Intenta nuevamente.';
        }
        btnSubmit.textContent = originalText;
        btnSubmit.disabled = false;
    }
});
