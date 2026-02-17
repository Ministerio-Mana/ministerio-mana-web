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

function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
        window.turnstile.reset();
    }
}

function getTurnstileToken() {
    const widget = document.querySelector('.cf-turnstile');
    if (!widget) return { ok: true, token: '' };
    const token = window.turnstile?.getResponse?.() || '';
    if (!token) return { ok: false, error: 'Captcha requerido.' };
    return { ok: true, token };
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
        const captcha = getTurnstileToken();
        if (!captcha.ok) {
            throw new Error(captcha.error || 'Captcha requerido.');
        }
        // Use our backend endpoint instead of Supabase Auth directly
        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, firstName, lastName, turnstileToken: captcha.token })
        });

        const data = await res.json();

        if (!data.ok) {
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
        btnSubmit.onclick = () => window.location.href = '/portal/ingresar';

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
