import { getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const gate = document.getElementById('cumbre-manual-gate');
const gateMessage = document.getElementById('cumbre-manual-gate-message');
const gateLink = document.getElementById('cumbre-manual-gate-link');
const content = document.getElementById('cumbre-manual-content');
const actor = document.getElementById('cumbre-manual-actor');

function denyAccess(message) {
  if (gateMessage) gateMessage.textContent = message;
  gate?.classList.remove('text-slate-500');
  gate?.classList.add('border-amber-200', 'bg-amber-50', 'text-amber-800');
  gateLink?.classList.remove('hidden');
  gateLink?.classList.add('inline-flex');
}

async function boot() {
  try {
    const session = await getPortalSession({ force: true });
    if (!session.auth.isAuthenticated) {
      redirectToLogin();
      return;
    }

    const role = String(session?.data?.profile?.effective_role || session?.data?.profile?.role || 'user');
    if (role !== 'superadmin' || session.auth.mode === 'password') {
      denyAccess('Esta operación requiere una cuenta individual con rol superadmin.');
      return;
    }

    window['cumbreManualAuthHeaders'] = Object.freeze({ ...session.headers });
    const email = String(session?.data?.profile?.email || session.auth.user?.email || '').trim();
    if (actor) actor.textContent = email ? `Sesión individual: ${email}` : 'Sesión individual verificada';
    gate?.classList.add('hidden');
    content?.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('cumbre-manual-ready'));
  } catch (error) {
    if (gateMessage) {
      gateMessage.textContent = error instanceof Error
        ? error.message
        : 'No se pudo validar el acceso.';
    }
    gate?.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
  }
}

void boot();
