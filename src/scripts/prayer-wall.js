const POSITIONS = [
  [20, 22, -3.5],
  [48, 18, 2.4],
  [75, 27, -1.8],
  [31, 48, 2.8],
  [62, 49, -3.2],
  [18, 70, 1.8],
  [48, 76, -1.4],
  [78, 70, 2.6],
  [87, 46, -2.2],
  [9, 43, 3.2],
  [36, 30, -1.2],
  [65, 82, 1.4],
];

const COUNTRY_LABELS = {
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  EC: 'Ecuador',
  ES: 'España',
  MX: 'México',
  PE: 'Perú',
  US: 'Estados Unidos',
  VE: 'Venezuela',
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function normalizePrayer(row, fallbackIndex = 0) {
  const firstName = String(row.first_name || row.firstName || row.name || 'Alguien').trim();
  const requestText = String(
    row.request_text || row.requestText || row.request || row.petition || 'Petición recibida para oración.',
  ).trim();

  return {
    id: String(row.id || `local-${Date.now()}-${fallbackIndex}`),
    first_name: firstName || 'Alguien',
    request_text: requestText || 'Petición recibida para oración.',
    city: String(row.city || '').trim(),
    country: String(row.country || '').trim().toUpperCase(),
    prayers_count: Number(row.prayers_count || row.prayersCount || 0),
    created_at: row.created_at || row.createdAt || new Date().toISOString(),
  };
}

function getSamples(root) {
  try {
    return JSON.parse(root.dataset.prayerSamples || '[]').map(normalizePrayer);
  } catch {
    return [];
  }
}

function prayerLocation(row) {
  const country = COUNTRY_LABELS[row.country] || row.country;
  return [row.city, country].filter(Boolean).join(', ');
}

function prayerCountLabel(count) {
  return `${count} ${count === 1 ? 'oración' : 'oraciones'}`;
}

function hasPrayed(id) {
  try {
    return localStorage.getItem(`mana-prayed:${id}`) === 'true';
  } catch {
    return false;
  }
}

function markPrayed(id) {
  try {
    localStorage.setItem(`mana-prayed:${id}`, 'true');
  } catch {
    // LocalStorage can be unavailable in strict privacy modes.
  }
}

function setStatus(root, message, mode = 'info') {
  const status = root.querySelector('[data-prayer-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', mode === 'error');
  status.classList.toggle('is-success', mode === 'success');
}

function updateStats(root, prayers) {
  const total = prayers.length;
  const prayerCount = prayers.reduce((sum, item) => sum + Number(item.prayers_count || 0), 0);

  root.querySelectorAll('[data-prayer-total]').forEach((item) => {
    item.textContent = String(total);
  });
  root.querySelectorAll('[data-prayer-count]').forEach((item) => {
    item.textContent = String(prayerCount);
  });
}

function createPrayerNote(root, row, index, isNew = false) {
  const position = POSITIONS[index % POSITIONS.length];
  const note = document.createElement('article');
  note.className = `prayer-note${isNew && !prefersReducedMotion ? ' is-new' : ''}`;
  note.dataset.prayerCard = row.id;
  note.style.setProperty('--x', `${position[0]}%`);
  note.style.setProperty('--y', `${position[1]}%`);
  note.style.setProperty('--r', `${position[2]}deg`);

  const pin = document.createElement('span');
  pin.className = 'prayer-note__pin';
  pin.setAttribute('aria-hidden', 'true');

  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = row.first_name;
  const meta = document.createElement('small');
  meta.textContent = prayerLocation(row) || 'Petición de oración';
  header.append(title, meta);

  const text = document.createElement('p');
  text.textContent = row.request_text;

  const footer = document.createElement('footer');
  const count = document.createElement('span');
  count.className = 'prayer-note__count';
  count.textContent = prayerCountLabel(row.prayers_count);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = hasPrayed(row.id) ? 'Orado' : 'Oré';
  button.disabled = hasPrayed(row.id);

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    row.prayers_count += 1;
    count.textContent = prayerCountLabel(row.prayers_count);
    button.textContent = 'Orado';
    markPrayed(row.id);
    updateStats(root, root.__prayerRows || []);

    if (!/^[0-9a-f-]{36}$/i.test(row.id)) return;

    try {
      const response = await fetch('/api/prayer/prayed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Number.isFinite(Number(data.prayers_count))) {
        row.prayers_count = Number(data.prayers_count);
        count.textContent = prayerCountLabel(row.prayers_count);
        updateStats(root, root.__prayerRows || []);
      }
    } catch {
      // The local acknowledgement stays visible; the wall will resync on refresh.
    }
  });

  note.addEventListener('pointermove', (event) => {
    if (prefersReducedMotion) return;
    const rect = note.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    note.style.setProperty('--tilt-x', `${x * 8}deg`);
    note.style.setProperty('--tilt-y', `${y * -8}deg`);
  });

  note.addEventListener('pointerleave', () => {
    note.style.setProperty('--tilt-x', '0deg');
    note.style.setProperty('--tilt-y', '0deg');
  });

  footer.append(count, button);
  note.append(pin, header, text, footer);
  return note;
}

function renderPrayers(root, prayers, newPrayerId = '') {
  const list = root.querySelector('[data-prayer-list]');
  const empty = root.querySelector('[data-prayer-empty]');
  if (!list) return;

  list.replaceChildren();
  prayers.forEach((row, index) => {
    list.append(createPrayerNote(root, row, index, row.id === newPrayerId));
  });

  if (empty) {
    empty.hidden = prayers.length > 0;
    empty.textContent = prayers.length ? '' : 'Aún no hay peticiones publicadas.';
  }

  updateStats(root, prayers);
}

async function loadPrayers(root, forceSamples = false) {
  const samples = getSamples(root);
  let rows = [];

  if (!forceSamples) {
    try {
      const response = await fetch('/api/prayer/list', {
        headers: { accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.rows)) {
        rows = data.rows.map(normalizePrayer).filter((row) => row.request_text);
      }
    } catch {
      rows = [];
    }
  }

  if (!rows.length) rows = samples;
  root.__prayerRows = rows;
  renderPrayers(root, rows);
}

function setupWallDrag(stage) {
  let startX = 0;
  let startY = 0;
  let panX = 0;
  let panY = 0;
  let active = false;

  stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, a, input, textarea, select')) return;
    active = true;
    startX = event.clientX;
    startY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add('is-dragging');
  });

  stage.addEventListener('pointermove', (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    panX = Math.max(-36, Math.min(36, dx * 0.18));
    panY = Math.max(-18, Math.min(18, dy * 0.12));
    stage.style.setProperty('--wall-pan-x', `${panX}px`);
    stage.style.setProperty('--wall-pan-y', `${panY}px`);
  });

  const release = (event) => {
    if (!active) return;
    active = false;
    stage.releasePointerCapture?.(event.pointerId);
    stage.classList.remove('is-dragging');
  };

  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
}

function setupForm(root) {
  const form = root.querySelector('[data-prayer-form]');
  if (!form) return;

  const submit = root.querySelector('[data-prayer-submit]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    submit?.setAttribute('disabled', 'true');
    setStatus(root, 'Estamos poniendo tu petición en el muro.');

    try {
      const response = await fetch(form.action || '/api/prayer/submit', {
        method: 'POST',
        body: formData,
        headers: { accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || 'No pudimos registrar la petición.');
      }

      const row = normalizePrayer(data.row || {
        first_name: formData.get('firstName'),
        request_text: formData.get('requestText'),
        city: formData.get('city'),
        country: formData.get('country'),
        prayers_count: 0,
      });

      const rows = [row, ...(root.__prayerRows || [])].slice(0, 200);
      root.__prayerRows = rows;
      renderPrayers(root, rows, row.id);
      form.reset();
      if (root.querySelector('.cf-turnstile') && window.turnstile?.reset) {
        try {
          window.turnstile.reset();
        } catch {
          // The widget can be absent in local dev while the global script exists.
        }
      }
      setStatus(root, 'Tu petición ya está en el muro. Vamos a orar contigo.', 'success');
    } catch (error) {
      setStatus(root, error?.message || 'No pudimos registrar la petición. Intenta de nuevo.', 'error');
    } finally {
      submit?.removeAttribute('disabled');
    }
  });
}

function setupReveals(root) {
  const revealItems = Array.from(root.querySelectorAll('[data-prayer-reveal]'));
  if (!revealItems.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
  );

  revealItems.forEach((item) => observer.observe(item));
}

function setupPrayerWall(root) {
  if (!root || root.dataset.ready === 'true') return;
  root.dataset.ready = 'true';

  root.querySelectorAll('[data-wall-stage]').forEach(setupWallDrag);
  root.querySelectorAll('[data-refresh-prayers]').forEach((button) => {
    button.addEventListener('click', () => loadPrayers(root));
  });

  setupForm(root);
  setupReveals(root);
  loadPrayers(root);
}

function initPrayerWalls() {
  document.querySelectorAll('[data-prayer-wall]').forEach(setupPrayerWall);
}

document.addEventListener('astro:page-load', initPrayerWalls);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrayerWalls, { once: true });
} else {
  initPrayerWalls();
}
