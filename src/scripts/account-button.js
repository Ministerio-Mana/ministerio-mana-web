import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

const container = document.getElementById('account-button-container');
const loading = document.getElementById('account-loading');
const guestBtn = document.getElementById('account-guest');
const loggedBtn = document.getElementById('account-logged');
const accountName = document.getElementById('account-name');
const accountInitials = document.getElementById('account-initials');
const logoutBtn = document.getElementById('btn-logout-header');

const supabase = getSupabaseBrowserClient();

async function checkSession() {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (loading) loading.classList.add('hidden');

        if (session?.user) {
            // User is logged in
            const userName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuario';
            const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            if (accountName) accountName.textContent = userName.split(' ')[0]; // First name only
            if (accountInitials) accountInitials.textContent = initials;

            if (guestBtn) guestBtn.classList.add('hidden');
            if (loggedBtn) loggedBtn.classList.remove('hidden');
        } else {
            // User is not logged in
            if (loggedBtn) loggedBtn.classList.add('hidden');
            if (guestBtn) {
                guestBtn.classList.remove('hidden');
                guestBtn.classList.add('flex');
            }
        }
    } catch (err) {
        console.error('Error checking session:', err);
        // On error, show guest button
        if (loading) loading.classList.add('hidden');
        if (loggedBtn) loggedBtn.classList.add('hidden');
        if (guestBtn) {
            guestBtn.classList.remove('hidden');
            guestBtn.classList.add('flex');
        }
    }
}

// Handle logout
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'Saliendo...';
        await supabase.auth.signOut();
        window.location.href = '/';
    });
}

checkSession();
