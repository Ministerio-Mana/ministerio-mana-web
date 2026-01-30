import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';
import { gsap } from 'gsap';

window.addEventListener('load', () => {
  const loginCard = document.getElementById('login-card');
  if (loginCard) {
    gsap.to('#login-card', {
      opacity: 1,
      y: 0,
      duration: 1.2,
      ease: 'power4.out',
      delay: 0.2,
    });
  }

  const starsContainer = document.getElementById('stars-container');
  if (!starsContainer) return;

  for (let i = 0; i < 30; i += 1) {
    const star = document.createElement('div');
    star.className = 'absolute w-[2px] h-[2px] bg-white rounded-full';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    starsContainer.appendChild(star);

    gsap.to(star, {
      opacity: 0.2,
      duration: 2 + Math.random() * 3,
      repeat: -1,
      yoyo: true,
      delay: Math.random() * 5,
    });
  }
});

const form = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const statusContainer = document.getElementById('login-status-container');
const statusEl = document.getElementById('login-status');
const statusIcon = document.getElementById('login-status-icon');
const submitBtn = document.getElementById('btn-submit');
const passwordBtn = document.getElementById('btn-submit-password');
let lastAction = 'otp';

submitBtn?.addEventListener('click', () => {
  lastAction = 'otp';
});
passwordBtn?.addEventListener('click', () => {
  lastAction = 'password';
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!emailInput || !submitBtn || !statusContainer || !statusEl || !statusIcon) return;

  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
  if (passwordBtn) {
    passwordBtn.disabled = true;
    passwordBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  statusContainer.classList.remove('hidden');
  statusEl.textContent = 'Enviando enlace mágico...';
  statusIcon.classList.replace('bg-green-400', 'bg-brand-teal');
  statusIcon.classList.replace('bg-red-400', 'bg-brand-teal');

  try {
    const email = emailInput.value.trim();
    const password = passwordInput?.value?.trim();

    const action = event.submitter?.dataset?.action || lastAction;
    if (password && action === 'password') {
      statusEl.textContent = 'Validando acceso...';
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      statusIcon.classList.replace('bg-brand-teal', 'bg-green-400');
      statusIcon.classList.remove('animate-ping');
      statusEl.textContent = 'Acceso concedido. Entrando...';
      window.location.href = '/portal';
      return;
    }

    const redirectTo = `${window.location.origin}/portal/activar?next=${encodeURIComponent('/portal')}`;
    const res = await fetch('/api/auth/send-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, kind: 'magiclink', redirectTo }),
    });
    const payload = await res.json();
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error || 'No se pudo enviar el enlace.');
    }

    statusIcon.classList.replace('bg-brand-teal', 'bg-green-400');
    statusIcon.classList.remove('animate-ping');
    statusEl.textContent = 'Enlace enviado. Revisa tu inbox.';

    gsap.from(statusContainer, { scale: 0.9, duration: 0.4, ease: 'back.out' });
  } catch (err) {
    console.error(err);
    statusIcon.classList.replace('bg-brand-teal', 'bg-red-400');
    statusIcon.classList.remove('animate-ping');
    statusEl.textContent = 'Error al enviar enlace. Intenta de nuevo.';
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    if (passwordBtn) {
      passwordBtn.disabled = false;
      passwordBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
});
