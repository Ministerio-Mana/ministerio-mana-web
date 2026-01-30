import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

const loading = document.getElementById('account-loading');
const guestBtn = document.getElementById('account-guest');
const loggedBtn = document.getElementById('account-logged');
const accountName = document.getElementById('account-name');
const accountInitials = document.getElementById('account-initials');
const logoutBtn = document.getElementById('btn-logout-header');

function showGuest() {
  if (loading) loading.classList.add('hidden');
  if (loggedBtn) loggedBtn.classList.add('hidden');
  if (guestBtn) {
    guestBtn.classList.remove('hidden');
    guestBtn.classList.add('flex');
  }
}

let supabase = null;
try {
  supabase = getSupabaseBrowserClient();
} catch (err) {
  console.error('Supabase client not available:', err);
  showGuest();
}

async function checkSession() {
  if (!supabase) {
    showGuest();
    return;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (loading) loading.classList.add('hidden');

    if (session?.user) {
      const userName = String(
        session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuario',
      );
      const nameParts = userName.split(' ');
      const initials = nameParts
        .map((part) => (part ? part[0] : ''))
        .join('')
        .substring(0, 2)
        .toUpperCase();

      if (accountName) accountName.textContent = userName.split(' ')[0];
      if (accountInitials) accountInitials.textContent = initials;

      if (guestBtn) guestBtn.classList.add('hidden');
      if (loggedBtn) loggedBtn.classList.remove('hidden');
    } else {
      showGuest();
    }
  } catch (err) {
    console.error('Error checking session:', err);
    showGuest();
  }
}

if (logoutBtn instanceof HTMLButtonElement) {
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Saliendo...';
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.location.href = '/';
  });
}

checkSession();
