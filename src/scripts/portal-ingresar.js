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

const statusContainer = document.getElementById('login-status-container');
const statusEl = document.getElementById('login-status');
const statusIcon = document.getElementById('login-status-icon');

function showStatus(msg, type = 'loading') {
  if (!statusContainer || !statusEl || !statusIcon) return;
  statusContainer.classList.remove('hidden');
  statusEl.textContent = msg;
  statusIcon.className = `w-2 h-2 rounded-full ${type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-[#293C74] animate-ping'}`;
  gsap.from(statusContainer, { scale: 0.9, duration: 0.4, ease: 'back.out' });
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

magicForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = magicEmailInput?.value?.trim();
  if (!email) return;

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
      body: JSON.stringify({ email, kind: 'recovery', redirectTo }),
    });
    const payload = await res.json();
    if (!res.ok || !payload?.ok) throw new Error(payload?.error || 'Error al enviar enlace.');

    showStatus('¡Enlace enviado! Revisa tu correo para restablecer.', 'success');
    magicEmailInput.value = '';
  } catch (err) {
    showStatus(err?.message || 'Error al enviar enlace.', 'error');
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

  showStatus('Validando contraseña...', 'loading');
  const btn = document.getElementById('btn-submit-password');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }

  try {
    if (!supabase) {
      throw new Error('El portal no está configurado.');
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showStatus('Acceso correcto. Entrando...', 'success');
    window.location.href = '/portal';
  } catch (err) {
    showStatus('Contraseña incorrecta o usuario no encontrado.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50');
    }
  }
});

passkeyBtn?.addEventListener('click', async () => {
  showStatus('Verificando soporte de Passkeys...', 'loading');
  try {
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
    showStatus(err?.message || 'Función Beta: Contacta soporte para activar.', 'error');
    setTimeout(() => {
      if (statusContainer) statusContainer.classList.add('hidden');
    }, 3000);
  }
});
