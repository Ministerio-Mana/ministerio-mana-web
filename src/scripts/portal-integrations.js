import { getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const gate = document.getElementById('integrations-gate');
const content = document.getElementById('integrations-content');
const alertBox = document.getElementById('integrations-alert');
const configuredValue = document.getElementById('microsoft-configured');
const enabledValue = document.getElementById('microsoft-enabled');
const connectedValue = document.getElementById('microsoft-connected');
const refreshButton = document.getElementById('microsoft-refresh');
const verifyButton = document.getElementById('microsoft-verify');
const siteBox = document.getElementById('microsoft-site');
const siteName = document.getElementById('microsoft-site-name');
const siteLink = document.getElementById('microsoft-site-link');
const drivesWrap = document.getElementById('microsoft-drives-wrap');
const drivesList = document.getElementById('microsoft-drives');

let authHeaders = {};
let currentStatus = null;

function showAlert(message, tone = 'error') {
  if (!alertBox) return;
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
}

function setBusy(button, busy, busyLabel) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent.trim();
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
}

function setText(element, value, ok = null) {
  if (!element) return;
  element.textContent = value;
  element.classList.remove('text-emerald-700', 'text-amber-700', 'text-red-700', 'text-slate-700');
  element.classList.add(ok === true ? 'text-emerald-700' : ok === false ? 'text-amber-700' : 'text-slate-700');
}

function renderSite(data) {
  const site = data?.site;
  if (!site?.id) {
    siteBox?.classList.add('hidden');
    return;
  }
  if (siteName) siteName.textContent = site.name || 'Portal Maná';
  if (siteLink instanceof HTMLAnchorElement && typeof site.webUrl === 'string' && site.webUrl.startsWith('https://')) {
    siteLink.href = site.webUrl;
    siteLink.classList.remove('hidden');
  } else {
    siteLink?.classList.add('hidden');
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
    item.className = 'rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700';
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

  if (verifyButton instanceof HTMLButtonElement) {
    verifyButton.disabled = !data?.enabled || !data?.configured;
  }
  renderSite(data);
  renderDrives(data?.drives);
}

async function requestStatus(verify = false) {
  const response = await fetch(
    `/api/portal/integrations/microsoft/status${verify ? '?verify=1' : ''}`,
    {
      headers: authHeaders,
      credentials: 'include',
      cache: 'no-store',
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || 'No se pudo consultar la integración de Microsoft.');
  }
  renderStatus(data, verify);
  return data;
}

async function boot() {
  try {
    const session = await getPortalSession({ force: true });
    if (!session.auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    authHeaders = session.headers;
    await requestStatus(false);
    gate?.classList.add('hidden');
    content?.classList.remove('hidden');
  } catch (error) {
    if (gate) {
      gate.textContent = error instanceof Error ? error.message : 'No se pudo validar el acceso.';
      gate.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
    }
  }
}

refreshButton?.addEventListener('click', async () => {
  clearAlert();
  setBusy(refreshButton, true, 'Actualizando...');
  try {
    await requestStatus(false);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : 'No se pudo actualizar el estado.');
  } finally {
    setBusy(refreshButton, false, 'Actualizando...');
    if (verifyButton instanceof HTMLButtonElement) {
      verifyButton.disabled = !currentStatus?.enabled || !currentStatus?.configured;
    }
  }
});

verifyButton?.addEventListener('click', async () => {
  clearAlert();
  setBusy(verifyButton, true, 'Probando...');
  try {
    await requestStatus(true);
    showAlert('Conexión de lectura verificada correctamente.', 'success');
  } catch (error) {
    showAlert(error instanceof Error ? error.message : 'No se pudo verificar la conexión.');
  } finally {
    setBusy(verifyButton, false, 'Probando...');
    if (verifyButton instanceof HTMLButtonElement) {
      verifyButton.disabled = !currentStatus?.enabled || !currentStatus?.configured;
    }
  }
});

void boot();
