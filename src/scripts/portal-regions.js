import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const errorBox = document.getElementById('regions-error');
const feedbackBox = document.getElementById('regions-feedback');
const gateEl = document.getElementById('regions-gate');
const secureContentEl = document.getElementById('regions-secure-content');
const regionForm = document.getElementById('region-form');
const cityForm = document.getElementById('city-form');
const assignmentForm = document.getElementById('assignment-form');
const btnClearCityRegion = document.getElementById('btn-clear-city-region');
const regionFormTitle = document.getElementById('region-form-title');
const regionCountryInput = document.getElementById('region-country');
const regionCodeInput = document.getElementById('region-code');
const regionNameInput = document.getElementById('region-name');
const regionSubmit = document.getElementById('region-submit');
const regionCancelEdit = document.getElementById('region-cancel-edit');

const regionTableBody = document.getElementById('regions-table-body');
const citiesTableBody = document.getElementById('cities-table-body');
const assignmentsTableBody = document.getElementById('assignments-table-body');
const cityRegionSelect = document.getElementById('city-region-select');
const assignmentRegionSelect = document.getElementById('assignment-region-select');

let authHeaders = {};
let regions = [];
let cities = [];
let assignments = [];
let permissionValidated = false;
let editingRegionId = '';
let regionEditReturnFocus = null;
const dirtyForms = new Set();

function showSecureContent() {
  gateEl?.classList.add('hidden');
  secureContentEl?.classList.remove('hidden');
}

function showGate(message = 'Validando permisos...') {
  if (gateEl) {
    gateEl.textContent = message;
    gateEl.classList.remove('hidden');
  }
  secureContentEl?.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showError(message) {
  if (!errorBox) return;
  if (!message) {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
    return;
  }
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function showFeedback(message = '') {
  if (!feedbackBox) return;
  feedbackBox.textContent = message;
  feedbackBox.classList.toggle('hidden', !message);
}

function setFormPending(form, pending, label = 'Guardando…') {
  const submit = form?.querySelector('[type="submit"]');
  if (!submit) return () => {};
  const originalText = submit.textContent;
  submit.disabled = pending;
  if (pending) submit.textContent = label;
  return () => {
    submit.disabled = false;
    submit.textContent = originalText;
  };
}

function clearFormState(form) {
  form?.reset();
  dirtyForms.delete(form);
}

function resetRegionEditor({ returnFocus = false } = {}) {
  editingRegionId = '';
  clearFormState(regionForm);
  if (regionCountryInput) regionCountryInput.readOnly = false;
  if (regionCodeInput) regionCodeInput.readOnly = false;
  if (regionFormTitle) regionFormTitle.textContent = 'Crear región';
  if (regionSubmit) regionSubmit.textContent = 'Guardar región';
  regionCancelEdit?.classList.add('hidden');
  if (returnFocus) {
    const target = regionEditReturnFocus;
    window.queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else regionNameInput?.focus();
    });
  }
  regionEditReturnFocus = null;
}

function beginRegionEdit(region, trigger) {
  if (!region || !regionForm) return;
  if (dirtyForms.has(regionForm) && !window.confirm('Hay datos de región sin guardar. ¿Quieres reemplazarlos con esta edición?')) return;
  editingRegionId = region.id;
  regionEditReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  if (regionCountryInput) {
    regionCountryInput.value = region.country || '';
    regionCountryInput.readOnly = true;
  }
  if (regionCodeInput) {
    regionCodeInput.value = region.code || '';
    regionCodeInput.readOnly = true;
  }
  if (regionNameInput) regionNameInput.value = region.name || '';
  dirtyForms.delete(regionForm);
  if (regionFormTitle) regionFormTitle.textContent = `Editar región ${region.code || ''}`.trim();
  if (regionSubmit) regionSubmit.textContent = 'Guardar nombre';
  regionCancelEdit?.classList.remove('hidden');
  regionNameInput?.focus();
  regionForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const message = data?.error || 'Error de API';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function populateRegionSelects() {
  const options = ['<option value="">Selecciona una región</option>']
    .concat(
      (regions || [])
        .filter((r) => r?.is_active !== false)
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(`${r.code} · ${r.name} (${r.country})`)}</option>`),
    )
    .join('');

  if (cityRegionSelect) cityRegionSelect.innerHTML = options;
  if (assignmentRegionSelect) assignmentRegionSelect.innerHTML = options;
}

function renderRegions() {
  if (!regionTableBody) return;
  if (!regions.length) {
    regionTableBody.innerHTML = '<tr><td data-label="Estado" colspan="7" class="py-4 text-center text-sm text-slate-500">No hay regiones registradas.</td></tr>';
    return;
  }
  regionTableBody.innerHTML = (regions || []).map((r) => `
    <tr>
      <td data-label="País" class="py-2">${escapeHtml(r.country)}</td>
      <td data-label="Código" class="py-2">${escapeHtml(r.code)}</td>
      <td data-label="Nombre" class="py-2">${escapeHtml(r.name)}</td>
      <td data-label="Iglesias" class="py-2">${escapeHtml(r.churches_count || 0)}</td>
      <td data-label="Líderes" class="py-2">${escapeHtml(r.active_assignments_count || 0)}</td>
      <td data-label="Estado" class="py-2">${r.is_active === false ? 'Inactiva' : 'Activa'}</td>
      <td data-label="Acciones" class="py-2 text-right">
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" data-action="rename-region" data-id="${escapeHtml(r.id)}" class="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-xs font-bold text-[#293C74] hover:bg-slate-50" aria-label="Editar región ${escapeHtml(r.name)}">Editar</button>
          <button type="button" data-action="toggle-region" data-id="${escapeHtml(r.id)}" data-active="${r.is_active ? '1' : '0'}" class="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50" aria-label="${r.is_active ? 'Desactivar' : 'Activar'} región ${escapeHtml(r.name)}">${r.is_active ? 'Desactivar' : 'Activar'}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderCities() {
  if (!citiesTableBody) return;
  if (!cities.length) {
    citiesTableBody.innerHTML = '<tr><td data-label="Estado" colspan="5" class="py-4 text-center text-sm text-slate-500">No hay ciudades registradas.</td></tr>';
    return;
  }
  citiesTableBody.innerHTML = (cities || []).map((row) => `
    <tr>
      <td data-label="País" class="py-2">${escapeHtml(row.country)}</td>
      <td data-label="Ciudad" class="py-2">${escapeHtml(row.city)}</td>
      <td data-label="Iglesias" class="py-2">${escapeHtml(row.churches_count || 0)}</td>
      <td data-label="Región" class="py-2">${escapeHtml(row.region_code ? `${row.region_code} · ${row.region_name || ''}` : 'Sin región')}</td>
      <td data-label="Estado" class="py-2">${row.mixed_region_assignment ? 'Mixto' : 'OK'}</td>
    </tr>
  `).join('');
}

function renderAssignments() {
  if (!assignmentsTableBody) return;
  if (!assignments.length) {
    assignmentsTableBody.innerHTML = '<tr><td data-label="Estado" colspan="5" class="py-4 text-center text-sm text-slate-500">No hay liderazgos regionales asignados.</td></tr>';
    return;
  }
  assignmentsTableBody.innerHTML = (assignments || []).map((row) => `
    <tr>
      <td data-label="Usuario" class="py-2">${escapeHtml(row.user?.email || row.user_id)}</td>
      <td data-label="Rol" class="py-2">${escapeHtml(row.role === 'regional_pastor' ? 'Pastor regional' : row.role === 'regional_collaborator' ? 'Colaborador regional' : row.role)}</td>
      <td data-label="Región" class="py-2">${escapeHtml(row.region?.code ? `${row.region.code} · ${row.region.name}` : row.region_id)}</td>
      <td data-label="Estado" class="py-2">${escapeHtml(row.status === 'active' ? 'Activo' : row.status)}</td>
      <td data-label="Acción" class="py-2 text-right">
        ${row.status === 'active'
          ? `<button type="button" data-action="revoke-assignment" data-id="${escapeHtml(row.id)}" class="min-h-11 rounded-md border border-rose-200 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Revocar</button>`
          : '-'}
      </td>
    </tr>
  `).join('');
}

async function loadRegions() {
  const data = await api('/api/portal/admin/regions?include_inactive=1');
  regions = data?.regions || [];
  populateRegionSelects();
  renderRegions();
}

async function loadCities() {
  const data = await api('/api/portal/admin/regions/cities');
  cities = data?.cities || [];
  renderCities();
}

async function loadAssignments() {
  const data = await api('/api/portal/admin/regions/assignments');
  assignments = data?.assignments || [];
  renderAssignments();
}

async function reloadAll() {
  await Promise.all([loadRegions(), loadCities(), loadAssignments()]);
}

async function bootstrap() {
  showGate();
  const auth = await ensureAuthenticated();
  if (!auth.isAuthenticated) {
    redirectToLogin();
    return;
  }
  authHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

  try {
    const sessionResult = await getPortalSession({ auth });
    if (!sessionResult.ok) {
      const error = new Error(sessionResult.data?.error || 'No se pudieron validar permisos.');
      error.status = sessionResult.response?.status || 500;
      throw error;
    }
    const sessionData = sessionResult.data;
    const role = String(sessionData?.profile?.effective_role || sessionData?.profile?.role || 'user');
    if (!['admin', 'superadmin'].includes(role)) {
      window.location.replace('/portal');
      return;
    }

    permissionValidated = true;
    await reloadAll();
    showSecureContent();
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      window.location.replace('/portal');
      return;
    }
    if (permissionValidated) {
      showSecureContent();
      showError(err.message || 'No se pudo cargar el módulo.');
    } else {
      showGate(err.message || 'No se pudieron validar permisos.');
    }
  }
}

regionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  showFeedback('');
  const formData = new FormData(regionForm);
  const body = Object.fromEntries(formData);
  const wasEditing = Boolean(editingRegionId);
  const restoreSubmit = setFormPending(regionForm, true, wasEditing ? 'Guardando nombre…' : 'Guardando región…');
  try {
    if (wasEditing) {
      await api('/api/portal/admin/regions', {
        method: 'PATCH',
        body: JSON.stringify({ id: editingRegionId, name: String(body.name || '').trim() }),
      });
      await loadRegions();
      showFeedback('Nombre de la región actualizado.');
    } else {
      await api('/api/portal/admin/regions', { method: 'POST', body: JSON.stringify(body) });
      await reloadAll();
      showFeedback('Región guardada correctamente.');
    }
    restoreSubmit();
    resetRegionEditor();
  } catch (err) {
    restoreSubmit();
    showError(err.message || 'No se pudo guardar la región.');
  }
});

cityForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  showFeedback('');
  const formData = new FormData(cityForm);
  const country = String(formData.get('country') || '').trim();
  const regionId = String(formData.get('regionId') || '').trim();
  const citiesRaw = String(formData.get('cities') || '').trim();
  const cityList = citiesRaw.split(',').map((item) => item.trim()).filter(Boolean);

  const restoreSubmit = setFormPending(cityForm, true, 'Asignando ciudades…');
  try {
    await api('/api/portal/admin/regions/cities', {
      method: 'POST',
      body: JSON.stringify({ country, regionId, cities: cityList }),
    });
    await reloadAll();
    clearFormState(cityForm);
    showFeedback(`${cityList.length === 1 ? 'Ciudad asignada' : 'Ciudades asignadas'} correctamente.`);
  } catch (err) {
    showError(err.message || 'No se pudo asignar ciudad a región.');
  } finally {
    restoreSubmit();
  }
});

btnClearCityRegion?.addEventListener('click', async () => {
  if (!cityForm) return;
  showError('');
  showFeedback('');
  const formData = new FormData(cityForm);
  const country = String(formData.get('country') || '').trim();
  const citiesRaw = String(formData.get('cities') || '').trim();
  const cityList = citiesRaw.split(',').map((item) => item.trim()).filter(Boolean);

  if (!country || !cityList.length) {
    showError('Para quitar región, completa país y ciudad(es).');
    return;
  }

  if (!window.confirm(`¿Quitar la región asignada a ${cityList.join(', ')} en ${country}?`)) return;

  const originalText = btnClearCityRegion.textContent;
  btnClearCityRegion.disabled = true;
  btnClearCityRegion.textContent = 'Quitando región…';
  try {
    await api('/api/portal/admin/regions/cities', {
      method: 'POST',
      body: JSON.stringify({ country, regionId: null, cities: cityList }),
    });
    await reloadAll();
    clearFormState(cityForm);
    showFeedback('La asignación regional de las ciudades fue retirada. Puedes asignarlas nuevamente cuando sea necesario.');
  } catch (err) {
    showError(err.message || 'No se pudo quitar región de la ciudad.');
  } finally {
    btnClearCityRegion.disabled = false;
    btnClearCityRegion.textContent = originalText;
  }
});

assignmentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  showFeedback('');
  const formData = new FormData(assignmentForm);
  const body = {
    email: String(formData.get('email') || '').trim(),
    role: String(formData.get('role') || '').trim(),
    regionId: String(formData.get('regionId') || '').trim(),
    set_primary_role: true,
  };
  const regionLabel = assignmentRegionSelect?.selectedOptions?.[0]?.textContent || 'la región seleccionada';
  const roleLabel = body.role === 'regional_pastor' ? 'Pastor regional' : 'Colaborador regional';
  if (!window.confirm(`¿Asignar a ${body.email} como ${roleLabel} en ${regionLabel}? Esta acción establece su rol regional principal.`)) return;
  const restoreSubmit = setFormPending(assignmentForm, true, 'Asignando liderazgo…');
  try {
    await api('/api/portal/admin/regions/assignments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    clearFormState(assignmentForm);
    await reloadAll();
    showFeedback('Liderazgo regional asignado correctamente.');
  } catch (err) {
    showError(err.message || 'No se pudo asignar liderazgo regional.');
  } finally {
    restoreSubmit();
  }
});

for (const currentForm of [regionForm, cityForm, assignmentForm]) {
  currentForm?.addEventListener('input', () => dirtyForms.add(currentForm));
  currentForm?.addEventListener('change', () => dirtyForms.add(currentForm));
}

regionCancelEdit?.addEventListener('click', () => {
  if (dirtyForms.has(regionForm) && !window.confirm('Hay cambios de región sin guardar. ¿Quieres descartarlos?')) return;
  resetRegionEditor({ returnFocus: true });
});

regionTableBody?.addEventListener('click', async (event) => {
  const source = event.target;
  const button = source instanceof Element ? source.closest('[data-action]') : null;
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!id) return;
  showError('');
  showFeedback('');

  try {
    if (action === 'rename-region') {
      const current = regions.find((row) => row.id === id);
      beginRegionEdit(current, button);
      return;
    }

    if (action === 'toggle-region') {
      const active = button.dataset.active === '1';
      const originalText = button.textContent;
      button.setAttribute('disabled', 'disabled');
      button.textContent = active ? 'Desactivando…' : 'Activando…';
      await api('/api/portal/admin/regions', {
        method: 'PATCH',
        body: JSON.stringify({ id, is_active: !active }),
      });
      await loadRegions();
      showFeedback(active
        ? 'Región desactivada. Puedes activarla nuevamente desde esta misma lista.'
        : 'Región activada correctamente.');
      if (button.isConnected) {
        button.removeAttribute('disabled');
        button.textContent = originalText;
      }
    }
  } catch (err) {
    button.removeAttribute('disabled');
    showError(err.message || 'No se pudo actualizar la región.');
  }
});

assignmentsTableBody?.addEventListener('click', async (event) => {
  const source = event.target;
  const button = source instanceof Element ? source.closest('[data-action="revoke-assignment"]') : null;
  if (!button) return;
  const id = button.dataset.id;
  if (!id) return;
  showError('');
  showFeedback('');

  const confirmed = window.confirm('¿Revocar esta asignación regional?');
  if (!confirmed) return;

  const originalText = button.textContent;
  button.setAttribute('disabled', 'disabled');
  button.textContent = 'Revocando…';
  try {
    await api('/api/portal/admin/regions/assignments', {
      method: 'DELETE',
      body: JSON.stringify({ assignmentId: id }),
    });
    await loadAssignments();
    showFeedback('Asignación regional revocada. Puedes volver a asignarla desde el formulario.');
  } catch (err) {
    button.removeAttribute('disabled');
    button.textContent = originalText;
    showError(err.message || 'No se pudo revocar la asignación.');
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!dirtyForms.size) return;
  event.preventDefault();
  event.returnValue = '';
});

bootstrap();
