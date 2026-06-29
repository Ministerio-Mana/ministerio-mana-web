import { createClient } from '@supabase/supabase-js';
import gsap from 'gsap';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const form = document.getElementById('register-form');
const btnSubmit = document.getElementById('btn-submit-register');
const statusEl = document.getElementById('register-status');
const starsContainer = document.getElementById('stars-container');
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
});

// Background Animation (simplified)
if (starsContainer) {
    for (let i = 0; i < 50; i++) {
        const star = document.createElement('div');
        star.classList.add('absolute', 'bg-white', 'rounded-full');
        const size = Math.random() * 2 + 1;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.opacity = Math.random() * 0.5 + 0.1;
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        starsContainer.appendChild(star);

        gsap.to(star, {
            y: `-=${Math.random() * 100 + 50}`,
            opacity: 0,
            duration: Math.random() * 3 + 2,
            repeat: -1,
            ease: 'linear',
            delay: Math.random() * 5
        });
    }
}

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
            statusEl.classList.add('bg-amber-50', 'text-amber-700');
            statusEl.innerHTML = `
                <strong>Cuenta ya registrada</strong><br>
                <span class="text-sm">${data.message || 'Tu correo ya existe. Usa "Olvidé mi contraseña" para recuperar acceso.'}</span>
            `;
        } else {
            statusEl.classList.add('bg-green-50', 'text-green-600');
            statusEl.innerHTML = `
                <strong>¡Cuenta creada!</strong><br>
                <span class="text-sm">Revisa tu correo <strong>${email}</strong> para activar tu cuenta y establecer tu acceso.</span>
            `;
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
