import { getSupabaseBrowserClient } from '@lib/supabaseBrowser';

const supabase = getSupabaseBrowserClient();

const errorBox = document.getElementById('regions-error');
const regionForm = document.getElementById('region-form');
const cityForm = document.getElementById('city-form');
const assignmentForm = document.getElementById('assignment-form');
const btnClearCityRegion = document.getElementById('btn-clear-city-region');

const regionTableBody = document.getElementById('regions-table-body');
const citiesTableBody = document.getElementById('cities-table-body');
const assignmentsTableBody = document.getElementById('assignments-table-body');
const cityRegionSelect = document.getElementById('city-region-select');
const assignmentRegionSelect = document.getElementById('assignment-region-select');

let token = '';
let regions = [];
let cities = [];
let assignments = [];

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

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
  regionTableBody.innerHTML = (regions || []).map((r) => `
    <tr>
      <td class="py-2">${escapeHtml(r.country)}</td>
      <td class="py-2">${escapeHtml(r.code)}</td>
      <td class="py-2">${escapeHtml(r.name)}</td>
      <td class="py-2">${escapeHtml(r.churches_count || 0)}</td>
      <td class="py-2">${escapeHtml(r.active_assignments_count || 0)}</td>
      <td class="py-2">${r.is_active === false ? 'Inactiva' : 'Activa'}</td>
      <td class="py-2 text-right space-x-2">
        <button data-action="rename-region" data-id="${escapeHtml(r.id)}" class="text-xs font-bold text-[#293C74]">Renombrar</button>
        <button data-action="toggle-region" data-id="${escapeHtml(r.id)}" data-active="${r.is_active ? '1' : '0'}" class="text-xs font-bold text-slate-500">${r.is_active ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>
  `).join('');
}

function renderCities() {
  if (!citiesTableBody) return;
  citiesTableBody.innerHTML = (cities || []).map((row) => `
    <tr>
      <td class="py-2">${escapeHtml(row.country)}</td>
      <td class="py-2">${escapeHtml(row.city)}</td>
      <td class="py-2">${escapeHtml(row.churches_count || 0)}</td>
      <td class="py-2">${escapeHtml(row.region_code ? `${row.region_code} · ${row.region_name || ''}` : 'Sin región')}</td>
      <td class="py-2">${row.mixed_region_assignment ? 'Mixto' : 'OK'}</td>
    </tr>
  `).join('');
}

function renderAssignments() {
  if (!assignmentsTableBody) return;
  assignmentsTableBody.innerHTML = (assignments || []).map((row) => `
    <tr>
      <td class="py-2">${escapeHtml(row.user?.email || row.user_id)}</td>
      <td class="py-2">${escapeHtml(row.role)}</td>
      <td class="py-2">${escapeHtml(row.region?.code ? `${row.region.code} · ${row.region.name}` : row.region_id)}</td>
      <td class="py-2">${escapeHtml(row.status)}</td>
      <td class="py-2 text-right">
        ${row.status === 'active'
          ? `<button data-action="revoke-assignment" data-id="${escapeHtml(row.id)}" class="text-xs font-bold text-rose-600">Revocar</button>`
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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    window.location.href = '/portal/ingresar';
    return;
  }
  token = session.access_token;

  try {
    await reloadAll();
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      window.location.replace('/portal');
      return;
    }
    showError(err.message || 'No se pudo cargar el módulo.');
  }
}

regionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const formData = new FormData(regionForm);
  const body = Object.fromEntries(formData);
  try {
    await api('/api/portal/admin/regions', { method: 'POST', body: JSON.stringify(body) });
    regionForm.reset();
    await reloadAll();
  } catch (err) {
    showError(err.message || 'No se pudo guardar la región.');
  }
});

cityForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const formData = new FormData(cityForm);
  const country = String(formData.get('country') || '').trim();
  const regionId = String(formData.get('regionId') || '').trim();
  const citiesRaw = String(formData.get('cities') || '').trim();
  const cityList = citiesRaw.split(',').map((item) => item.trim()).filter(Boolean);

  try {
    await api('/api/portal/admin/regions/cities', {
      method: 'POST',
      body: JSON.stringify({ country, regionId, cities: cityList }),
    });
    await reloadAll();
  } catch (err) {
    showError(err.message || 'No se pudo asignar ciudad a región.');
  }
});

btnClearCityRegion?.addEventListener('click', async () => {
  if (!cityForm) return;
  showError('');
  const formData = new FormData(cityForm);
  const country = String(formData.get('country') || '').trim();
  const citiesRaw = String(formData.get('cities') || '').trim();
  const cityList = citiesRaw.split(',').map((item) => item.trim()).filter(Boolean);

  if (!country || !cityList.length) {
    showError('Para quitar región, completa país y ciudad(es).');
    return;
  }

  try {
    await api('/api/portal/admin/regions/cities', {
      method: 'POST',
      body: JSON.stringify({ country, regionId: null, cities: cityList }),
    });
    await reloadAll();
  } catch (err) {
    showError(err.message || 'No se pudo quitar región de la ciudad.');
  }
});

assignmentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const formData = new FormData(assignmentForm);
  const body = {
    email: String(formData.get('email') || '').trim(),
    role: String(formData.get('role') || '').trim(),
    regionId: String(formData.get('regionId') || '').trim(),
    set_primary_role: true,
  };
  try {
    await api('/api/portal/admin/regions/assignments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    assignmentForm.reset();
    await reloadAll();
  } catch (err) {
    showError(err.message || 'No se pudo asignar liderazgo regional.');
  }
});

regionTableBody?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!id) return;

  try {
    if (action === 'rename-region') {
      const current = regions.find((row) => row.id === id);
      const nextName = window.prompt('Nuevo nombre de la región', current?.name || '');
      if (!nextName) return;
      await api('/api/portal/admin/regions', {
        method: 'PATCH',
        body: JSON.stringify({ id, name: nextName }),
      });
      await loadRegions();
      return;
    }

    if (action === 'toggle-region') {
      const active = button.dataset.active === '1';
      await api('/api/portal/admin/regions', {
        method: 'PATCH',
        body: JSON.stringify({ id, is_active: !active }),
      });
      await loadRegions();
    }
  } catch (err) {
    showError(err.message || 'No se pudo actualizar la región.');
  }
});

assignmentsTableBody?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="revoke-assignment"]');
  if (!button) return;
  const id = button.dataset.id;
  if (!id) return;

  const confirmed = window.confirm('¿Revocar esta asignación regional?');
  if (!confirmed) return;

  try {
    await api('/api/portal/admin/regions/assignments', {
      method: 'DELETE',
      body: JSON.stringify({ assignmentId: id }),
    });
    await loadAssignments();
  } catch (err) {
    showError(err.message || 'No se pudo revocar la asignación.');
  }
});

bootstrap();
