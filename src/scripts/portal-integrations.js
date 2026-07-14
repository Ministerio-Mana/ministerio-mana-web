import { getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const gate = document.getElementById('integrations-gate');
const gateMessage = document.getElementById('integrations-gate-message');
const gateLink = document.getElementById('integrations-gate-link');
const content = document.getElementById('integrations-content');
const alertBox = document.getElementById('integrations-alert');
const busyStatus = document.getElementById('integrations-busy');
const configuredValue = document.getElementById('microsoft-configured');
const enabledValue = document.getElementById('microsoft-enabled');
const connectedValue = document.getElementById('microsoft-connected');
const eventsWriteValue = document.getElementById('microsoft-events-write');
const configDetail = document.getElementById('microsoft-config-detail');
const refreshButton = document.getElementById('microsoft-refresh');
const verifyButton = document.getElementById('microsoft-verify');
const siteBox = document.getElementById('microsoft-site');
const siteName = document.getElementById('microsoft-site-name');
const siteLink = document.getElementById('microsoft-site-link');
const drivesWrap = document.getElementById('microsoft-drives-wrap');
const drivesList = document.getElementById('microsoft-drives');
const lastChecked = document.getElementById('microsoft-last-checked');

const REQUEST_TIMEOUT_MS = 15_000;
let authHeaders = {};
let currentStatus = null;
let statusRequestRevision = 0;
let controlsBusy = false;

function showAlert(message, tone = 'error') {
  if (!alertBox) return;
  alertBox.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  alertBox.textContent = message;
  alertBox.classList.remove(
    'hidden',
    'border-red-200', 'bg-red-50', 'text-red-700',
    'border-emerald-200', 'bg-emerald-50', 'text-emerald-700',
  );
  if (tone === 'success') {
    alertBox.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
  } else {
    alertBox.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
  }
}

function clearAlert() {
  alertBox?.classList.add('hidden');
  alertBox?.setAttribute('role', 'status');
}

function setBusy(button, busy, busyLabel) {
  if (!(button instanceof HTMLButtonElement)) return;
  const label = button.querySelector('[data-label]');
  if (!(label instanceof HTMLElement)) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = label.textContent?.trim() || '';
  label.textContent = busy ? busyLabel : button.dataset.defaultLabel;
  button.setAttribute('aria-busy', String(busy));
}

function setControlsBusy(trigger, busy, busyLabel) {
  controlsBusy = busy;
  setBusy(trigger, busy, busyLabel);
  if (refreshButton instanceof HTMLButtonElement) refreshButton.disabled = busy;
  if (verifyButton instanceof HTMLButtonElement) {
    verifyButton.disabled = busy || !currentStatus?.enabled || !currentStatus?.configured;
  }
  if (busyStatus) busyStatus.textContent = busy ? busyLabel : '';
}

function setText(element, value, ok = null) {
  if (!element) return;
  element.textContent = value;
  element.classList.remove('text-emerald-700', 'text-amber-700', 'text-red-700', 'text-slate-700');
  element.classList.add(ok === true ? 'text-emerald-700' : ok === false ? 'text-amber-700' : 'text-slate-700');
}

function renderSite(data) {
  const site = data?.site;
  if (!site?.name) {
    siteBox?.classList.add('hidden');
    siteLink?.classList.add('hidden');
    if (siteLink instanceof HTMLAnchorElement) siteLink.removeAttribute('href');
    return;
  }
  if (siteName) siteName.textContent = site.name || 'Portal Maná';
  if (siteLink instanceof HTMLAnchorElement && typeof site.web_url === 'string' && site.web_url.startsWith('https://')) {
    siteLink.href = site.web_url;
    siteLink.classList.remove('hidden');
    siteLink.classList.add('inline-flex');
  } else {
    siteLink?.classList.add('hidden');
    siteLink?.classList.remove('inline-flex');
    if (siteLink instanceof HTMLAnchorElement) siteLink.removeAttribute('href');
  }
  siteBox?.classList.remove('hidden');
}

function renderDrives(drives) {
  if (!drivesList) return;
  drivesList.replaceChildren();
  if (!Array.isArray(drives) || drives.length === 0) {
    drivesWrap?.classList.add('hidden');
    return;
  }

  drives.forEach((drive) => {
    const item = document.createElement('li');
    item.className = 'rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-700';
    item.textContent = String(drive?.name || 'Documentos');
    drivesList.appendChild(item);
  });
  drivesWrap?.classList.remove('hidden');
}

function renderStatus(data, verified) {
  currentStatus = data;
  setText(configuredValue, data?.configured ? 'Completas' : 'Incompletas', Boolean(data?.configured));
  setText(enabledValue, data?.enabled ? 'Activada' : 'Desactivada', Boolean(data?.enabled));
  setText(
    connectedValue,
    verified ? (data?.connected ? 'Conectada' : 'Sin conexión') : 'Sin probar',
    verified ? Boolean(data?.connected) : null,
  );
  setText(eventsWriteValue, data?.events_write_enabled ? 'Activada' : 'Apagada', Boolean(data?.events_write_enabled));

  const missingCount = Number(data?.missing_count || 0);
  if (configDetail) {
    configDetail.textContent = missingCount > 0
      ? `Falta completar ${missingCount} ${missingCount === 1 ? 'variable protegida' : 'variables protegidas'} en el entorno del servidor. Sus valores nunca se muestran aquí.`
      : '';
    configDetail.classList.toggle('hidden', missingCount === 0);
  }

  if (verifyButton instanceof HTMLButtonElement) {
    verifyButton.disabled = controlsBusy || !data?.enabled || !data?.configured;
  }
  if (lastChecked) lastChecked.textContent = formatCheckedAt(data?.checked_at);
  renderSite(data);
  renderDrives(data?.drives);
}

function formatCheckedAt(value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'Última actualización: no disponible.';
  return `Última actualización: ${new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(date)} (Bogotá).`;
}

async function requestStatus(verify = false) {
  const requestRevision = ++statusRequestRevision;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `/api/portal/integrations/microsoft/status${verify ? '?verify=1' : ''}`,
      {
        headers: authHeaders,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || 'No se pudo consultar la integración de Microsoft.');
    }
    if (requestRevision !== statusRequestRevision) return null;
    renderStatus(data, verify);
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('La consulta tardó demasiado. Revisa la conexión e intenta de nuevo.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

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
      denyAccess('Esta página requiere una cuenta individual con rol superadmin.');
      return;
    }
    authHeaders = session.headers;
    await requestStatus(false);
    gate?.classList.add('hidden');
    content?.classList.remove('hidden');
  } catch (error) {
    if (gateMessage) gateMessage.textContent = error instanceof Error ? error.message : 'No se pudo validar el acceso.';
    gate?.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
  }
}

refreshButton?.addEventListener('click', async () => {
  clearAlert();
  setControlsBusy(refreshButton, true, 'Actualizando estado...');
  try {
    await requestStatus(false);
    showAlert('Estado de Microsoft actualizado.', 'success');
  } catch (error) {
    showAlert(error instanceof Error ? error.message : 'No se pudo actualizar el estado.');
  } finally {
    setControlsBusy(refreshButton, false, 'Actualizando estado...');
    refreshButton?.focus();
  }
});

verifyButton?.addEventListener('click', async () => {
  clearAlert();
  setControlsBusy(verifyButton, true, 'Probando conexión...');
  try {
    await requestStatus(true);
    showAlert('Conexión de lectura verificada correctamente.', 'success');
  } catch (error) {
    showAlert(error instanceof Error ? error.message : 'No se pudo verificar la conexión.');
  } finally {
    setControlsBusy(verifyButton, false, 'Probando conexión...');
    verifyButton?.focus();
  }
});

void boot();
