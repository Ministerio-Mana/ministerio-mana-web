import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

let supabase = null;
try {
  supabase = getSupabaseBrowserClient();
} catch {
  supabase = null;
}

function getParts(container) {
  return {
    loading: container.querySelector('[data-account-loading]'),
    guest: container.querySelector('[data-account-guest]'),
    logged: container.querySelector('[data-account-logged]'),
    name: container.querySelector('[data-account-name]'),
    initials: container.querySelector('[data-account-initials]'),
  };
}

function setAccountState(container, session = null) {
  const parts = getParts(container);
  parts.loading?.classList.add('hidden');
  container.setAttribute('aria-busy', 'false');
  if (!session?.user) {
    parts.logged?.classList.add('hidden');
    parts.guest?.classList.remove('hidden');
    parts.guest?.classList.add('flex');
    return;
  }

  const userName = String(
    session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuario',
  );
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (parts.name) parts.name.textContent = userName.split(/\s+/)[0] || 'Usuario';
  if (parts.initials) parts.initials.textContent = initials || 'U';
  parts.guest?.classList.remove('flex');
  parts.guest?.classList.add('hidden');
  parts.logged?.classList.remove('hidden');
}

async function checkSession() {
  const containers = [...document.querySelectorAll('[data-account-button]')];
  if (!containers.length) return;
  if (!supabase) {
    containers.forEach((container) => setAccountState(container));
    return;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    containers.filter((container) => container.isConnected).forEach((container) => setAccountState(container, session));
  } catch {
    containers.filter((container) => container.isConnected).forEach((container) => setAccountState(container));
  }
}

document.addEventListener('click', async (event) => {
  const logoutBtn = event.target.closest('[data-account-logout]');
  if (logoutBtn instanceof HTMLButtonElement) {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Saliendo...';
    if (supabase) await supabase.auth.signOut();
    window.location.href = '/';
    return;
  }

  const summary = event.target.closest('[data-account-logged] summary');
  if (summary && window.matchMedia('(max-width: 680px)').matches) {
    event.preventDefault();
    window.location.href = '/portal/';
  }
});

document.addEventListener('astro:page-load', checkSession);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkSession();
});
window.addEventListener('pageshow', checkSession);

if (supabase) {
  supabase.auth.onAuthStateChange(() => {
    window.queueMicrotask(checkSession);
  });
}

void checkSession();
