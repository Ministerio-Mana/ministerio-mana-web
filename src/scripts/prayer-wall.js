const DESKTOP_SLOTS = [
  [24.2, 16.4, -4, 0, 'horizontal'],
  [56.2, 16.4, 2, 1, 'vertical'],
  [82.4, 30.2, -3, 2, 'horizontal'],
  [24.5, 44.8, 3, 3, 'horizontal'],
  [62.3, 44.8, -4, 0, 'vertical'],
  [28.2, 72.9, 2, 1, 'horizontal'],
  [64.5, 72.9, -2, 2, 'horizontal'],
];

const MOBILE_SLOTS = [
  [24.2, 16.4, -4, 0, 'horizontal'],
  [56.2, 16.4, 2, 1, 'vertical'],
  [82.4, 30.2, -3, 2, 'horizontal'],
  [24.5, 44.8, 3, 3, 'horizontal'],
  [62.3, 44.8, -4, 0, 'vertical'],
  [28.2, 72.9, 2, 1, 'horizontal'],
];

const NOTE_PAPERS = [
  `
    <svg viewBox="0 0 120 72" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M8 10 L113 7 L117 64 L10 69 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M4 8 C31 3 80 11 114 5 L116 61 C82 57 38 70 6 65 Z" />
      <path class="prayer-note__paper-fold" d="M18 9 C27 26 19 45 7 64" />
      <path class="prayer-note__paper-line" d="M37 25 C56 21 75 27 94 22 M35 43 C57 39 77 45 98 39" />
    </svg>
  `,
  `
    <svg viewBox="0 0 120 72" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M7 8 L112 10 L116 66 L8 68 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--back" d="M5 6 C35 12 76 4 113 9 L114 62 C78 69 36 58 6 65 Z" />
      <path class="prayer-note__paper-fold" d="M96 10 C87 29 99 45 113 61" />
      <path class="prayer-note__paper-line" d="M25 26 C48 30 69 23 91 28 M23 44 C48 48 69 40 93 45" />
    </svg>
  `,
  `
    <svg viewBox="0 0 120 72" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M9 9 L114 6 L116 63 L8 68 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--blue" d="M5 7 C37 2 81 12 114 5 L114 60 C80 56 38 71 6 64 Z" />
      <path class="prayer-note__paper-fold" d="M17 8 C28 25 20 47 7 63" />
      <path class="prayer-note__paper-line" d="M36 24 C56 20 76 27 96 21 M34 43 C56 38 78 46 98 39" />
    </svg>
  `,
  `
    <svg viewBox="0 0 120 72" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M8 8 L112 10 L117 65 L9 68 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--pink" d="M5 6 C38 12 79 3 113 9 L115 61 C80 69 37 57 6 65 Z" />
      <path class="prayer-note__paper-fold" d="M97 10 C87 27 99 46 114 60" />
      <path class="prayer-note__paper-line" d="M24 25 C48 30 70 22 93 28 M23 44 C49 48 70 39 95 45" />
    </svg>
  `,
];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const compactWallQuery = window.matchMedia('(max-width: 1023px)');

function getI18n(root) {
  try {
    return JSON.parse(root?.dataset.prayerI18n || '{}');
  } catch {
    return {};
  }
}

function text(root, key) {
  return getI18n(root)[key] || key;
}

function isCompact(root) {
  return root?.dataset.prayerCompact === 'true' || root?.classList.contains('prayer-wall-experience--compact');
}

function getSlotPositions(root) {
  return compactWallQuery.matches ? MOBILE_SLOTS : DESKTOP_SLOTS;
}

function getPageSize(root) {
  if (isCompact(root)) return 5;
  return compactWallQuery.matches ? MOBILE_SLOTS.length : DESKTOP_SLOTS.length;
}

function formatPager(root, current, total) {
  return text(root, 'pageStatus')
    .replace('{current}', String(current))
    .replace('{total}', String(total));
}

function normalizePrayer(root, row, fallbackIndex = 0) {
  const firstName = String(row.first_name || row.firstName || row.name || text(root, 'anonymous')).trim();
  const requestText = String(
    row.request_text || row.requestText || row.request || row.petition || text(root, 'fallbackRequest'),
  ).trim();

  return {
    id: String(row.id || `local-${Date.now()}-${fallbackIndex}`),
    first_name: firstName || text(root, 'anonymous'),
    request_text: requestText || text(root, 'fallbackRequest'),
    city: String(row.city || '').trim(),
    country: String(row.country || '').trim().toUpperCase(),
    prayers_count: Number(row.prayers_count || row.prayersCount || 0),
    created_at: row.created_at || row.createdAt || new Date().toISOString(),
    visibility: String(row.visibility || 'public').toLowerCase(),
    moderation_status: String(row.moderation_status || row.status || 'approved').toLowerCase(),
    approved: row.approved === undefined ? true : Boolean(row.approved),
  };
}

function getSamples(root) {
  try {
    return JSON.parse(root.dataset.prayerSamples || '[]').map((row, index) => normalizePrayer(root, row, index));
  } catch {
    return [];
  }
}

function prayerLocation(root, row) {
  const COUNTRY_LABELS = getI18n(root)?.countries || {};
  const country = COUNTRY_LABELS[row.country] || row.country;
  return [row.city, country].filter(Boolean).join(', ');
}

function prayerCountLabel(root, count) {
  return `${count} ${count === 1 ? text(root, 'prayerSingular') : text(root, 'prayerPlural')}`;
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

async function handlePrayerAction(root, row, count, button) {
  if (button.disabled) return;
  button.disabled = true;
  row.prayers_count += 1;
  count.textContent = prayerCountLabel(root, row.prayers_count);
  button.textContent = text(root, 'prayed');
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
      count.textContent = prayerCountLabel(root, row.prayers_count);
      updateStats(root, root.__prayerRows || []);
    }
  } catch {
    // The local acknowledgement stays visible; the wall will resync on refresh.
  }
}

function showPrayerDetail(root, row, note) {
  const detail = root.querySelector('[data-prayer-detail]');
  if (!detail) return;

  root.querySelectorAll('[data-prayer-card].is-open').forEach((item) => {
    if (item !== note) {
      item.classList.remove('is-open');
      item.setAttribute('aria-expanded', 'false');
    }
  });
  note.classList.add('is-open');
  note.setAttribute('aria-expanded', 'true');

  const name = detail.querySelector('[data-prayer-detail-name]');
  const meta = detail.querySelector('[data-prayer-detail-meta]');
  const body = detail.querySelector('[data-prayer-detail-text]');
  const count = detail.querySelector('[data-prayer-detail-count]');
  const oldButton = detail.querySelector('[data-prayer-detail-pray]');
  const button = oldButton?.cloneNode(true);
  if (!name || !meta || !body || !count || !oldButton || !(button instanceof HTMLButtonElement)) return;

  name.textContent = row.first_name;
  meta.textContent = prayerLocation(root, row) || text(root, 'prayerRequest');
  body.textContent = row.request_text;
  count.textContent = prayerCountLabel(root, row.prayers_count);
  button.type = 'button';
  button.textContent = hasPrayed(row.id) ? text(root, 'prayed') : text(root, 'prayButton');
  button.disabled = hasPrayed(row.id);
  button.addEventListener('click', () => handlePrayerAction(root, row, count, button));
  oldButton.replaceWith(button);
  detail.hidden = false;
  root.__prayerDetailTrigger = note;
  detail.querySelector('[data-prayer-detail-close]')?.focus();
}

function closePrayerDetail(root, restoreFocus = true) {
  root.querySelectorAll('[data-prayer-detail]').forEach((detail) => {
    detail.hidden = true;
  });
  root.querySelectorAll('[data-prayer-card].is-open').forEach((note) => {
    note.classList.remove('is-open');
    note.setAttribute('aria-expanded', 'false');
  });
  const trigger = root.__prayerDetailTrigger;
  root.__prayerDetailTrigger = null;
  if (restoreFocus && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
}

function createPrayerNote(root, row, index, slots, isNew = false) {
  const position = slots[index % slots.length];
  const note = document.createElement('article');
  note.className = `prayer-note${isNew && !prefersReducedMotion ? ' is-new' : ''}`;
  note.dataset.prayerCard = row.id;
  note.tabIndex = 0;
  note.setAttribute('role', 'button');
  note.setAttribute('aria-haspopup', 'dialog');
  note.setAttribute('aria-expanded', 'false');
  note.setAttribute('aria-label', `${row.first_name}. ${row.request_text}`);
  note.style.setProperty('--x', `${position[0]}%`);
  note.style.setProperty('--y', `${position[1]}%`);
  note.style.setProperty('--r', `${position[2]}deg`);
  const paperType = Number.isFinite(Number(position[3])) ? Number(position[3]) : index % NOTE_PAPERS.length;
  note.dataset.paperType = String(paperType);
  note.dataset.paperOrientation = position[4] === 'vertical' ? 'vertical' : 'horizontal';

  const pin = document.createElement('span');
  pin.className = 'prayer-note__pin';
  pin.setAttribute('aria-hidden', 'true');

  const paper = document.createElement('span');
  paper.className = 'prayer-note__paper';
  paper.setAttribute('aria-hidden', 'true');
  paper.innerHTML = NOTE_PAPERS[paperType % NOTE_PAPERS.length];

  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = row.first_name;
  const meta = document.createElement('small');
  meta.textContent = prayerLocation(root, row) || text(root, 'prayerRequest');
  header.append(title, meta);

  const request = document.createElement('p');
  request.textContent = row.request_text;

  const footer = document.createElement('footer');
  const count = document.createElement('span');
  count.className = 'prayer-note__count';
  count.textContent = prayerCountLabel(root, row.prayers_count);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = hasPrayed(row.id) ? text(root, 'prayed') : text(root, 'prayButton');
  button.disabled = hasPrayed(row.id);

  button.addEventListener('click', () => handlePrayerAction(root, row, count, button));

  note.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) return;
    showPrayerDetail(root, row, note);
  });

  note.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) return;
    event.preventDefault();
    showPrayerDetail(root, row, note);
  });

  note.addEventListener('pointermove', (event) => {
    if (prefersReducedMotion) return;
    const rect = paper.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
    note.style.setProperty('--tilt-x', `${x * 4}deg`);
    note.style.setProperty('--tilt-y', `${y * -4}deg`);
  });

  note.addEventListener('pointerleave', () => {
    note.style.setProperty('--tilt-x', '0deg');
    note.style.setProperty('--tilt-y', '0deg');
  });

  footer.append(count, button);
  note.append(pin, paper, header, request, footer);
  return note;
}

function renderPrayers(root, prayers, newPrayerId = '') {
  const list = root.querySelector('[data-prayer-list]');
  const empty = root.querySelector('[data-prayer-empty]');
  if (!list) return;

  list.replaceChildren();
  root.querySelectorAll('[data-prayer-detail]').forEach((detail) => {
    detail.hidden = true;
  });
  const pageSize = getPageSize(root);
  const slots = getSlotPositions(root);
  const totalPages = Math.max(1, Math.ceil(prayers.length / pageSize));
  const nextPage = Math.max(0, Math.min(root.__prayerPage || 0, totalPages - 1));
  root.__prayerPage = nextPage;
  const start = nextPage * pageSize;
  const visibleRows = prayers.slice(start, start + pageSize);

  visibleRows.forEach((row, index) => {
    list.append(createPrayerNote(root, row, index, slots, row.id === newPrayerId));
  });

  if (empty) {
    empty.hidden = prayers.length > 0;
    empty.textContent = prayers.length ? '' : text(root, 'empty');
  }

  root.querySelectorAll('[data-prayer-pager]').forEach((pager) => {
    const showPager = prayers.length > pageSize;
    pager.hidden = !showPager;
    const pageLabel = pager.querySelector('[data-prayer-page]');
    const prev = pager.querySelector('[data-prayer-prev]');
    const next = pager.querySelector('[data-prayer-next]');
    if (pageLabel) pageLabel.textContent = formatPager(root, nextPage + 1, totalPages);
    if (prev) prev.disabled = nextPage <= 0;
    if (next) next.disabled = nextPage >= totalPages - 1;
  });

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
        rows = data.rows.map((row, index) => normalizePrayer(root, row, index)).filter((row) => row.request_text);
      }
    } catch {
      rows = [];
    }
  }

  if (!rows.length) rows = samples;
  root.__prayerRows = rows;
  renderPrayers(root, rows);
}

function setupPagination(root) {
  root.querySelectorAll('[data-prayer-prev]').forEach((button) => {
    button.addEventListener('click', () => {
      root.__prayerPage = Math.max(0, (root.__prayerPage || 0) - 1);
      renderPrayers(root, root.__prayerRows || []);
    });
  });

  root.querySelectorAll('[data-prayer-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const rows = root.__prayerRows || [];
      const maxPage = Math.max(0, Math.ceil(rows.length / getPageSize(root)) - 1);
      root.__prayerPage = Math.min(maxPage, (root.__prayerPage || 0) + 1);
      renderPrayers(root, rows);
    });
  });

  const rerender = () => renderPrayers(root, root.__prayerRows || []);
  if (compactWallQuery.addEventListener) {
    compactWallQuery.addEventListener('change', rerender);
  } else {
    compactWallQuery.addListener?.(rerender);
  }
}

function setupPrayerDetail(root) {
  root.querySelectorAll('[data-prayer-detail-close]').forEach((button) => {
    button.addEventListener('click', () => closePrayerDetail(root));
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !root.querySelector('[data-prayer-detail]:not([hidden])')) return;
    event.preventDefault();
    closePrayerDetail(root);
  });
}

function setupWallDrag(stage) {
  let startX = 0;
  let startY = 0;
  let panX = 0;
  let panY = 0;
  let active = false;

  stage.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a, input, textarea, select, [data-prayer-card]')) return;
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

function selectedVisibility(form) {
  const checked = form.querySelector('input[name="visibility"]:checked');
  return checked?.value === 'public' ? 'public' : 'private';
}

function setVisibility(form, visibility) {
  const input = form.querySelector(`input[name="visibility"][value="${visibility}"]`);
  if (input instanceof HTMLInputElement) {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function updateConfirmModal(root, form) {
  const modal = root.querySelector('[data-prayer-confirm]');
  if (!modal) return;

  const visibility = selectedVisibility(form);
  const title = modal.querySelector('[data-prayer-confirm-title]');
  const body = modal.querySelector('[data-prayer-confirm-body]');
  const switchButton = modal.querySelector('[data-prayer-confirm-switch]');

  if (title) title.textContent = visibility === 'public' ? text(root, 'confirmPublicTitle') : text(root, 'confirmPrivateTitle');
  if (body) body.textContent = visibility === 'public' ? text(root, 'confirmPublicBody') : text(root, 'confirmPrivateBody');
  if (switchButton) switchButton.textContent = visibility === 'public' ? text(root, 'switchToPrivate') : text(root, 'switchToPublic');
}

function openConfirmModal(root, form) {
  const modal = root.querySelector('[data-prayer-confirm]');
  if (!modal) return false;
  updateConfirmModal(root, form);
  modal.hidden = false;
  modal.querySelector('[data-prayer-confirm-send]')?.focus();
  return true;
}

function closeConfirmModal(root) {
  const modal = root.querySelector('[data-prayer-confirm]');
  if (modal) modal.hidden = true;
}

async function sendPrayerForm(root, form, submit) {
  const formData = new FormData(form);
  submit?.setAttribute('disabled', 'true');
  setStatus(root, text(root, 'submitting'));

  try {
    const response = await fetch(form.action || '/api/prayer/submit', {
      method: 'POST',
      body: formData,
      headers: { accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || text(root, 'submitError'));
    }

    const row = data.row ? normalizePrayer(root, data.row) : null;
    const isPublicApproved = row?.visibility === 'public' && row?.approved && row?.moderation_status === 'approved';
    if (isPublicApproved) {
      root.__prayerPage = 0;
      const rows = [row, ...(root.__prayerRows || [])].slice(0, 200);
      root.__prayerRows = rows;
      renderPrayers(root, rows, row.id);
    } else {
      renderPrayers(root, root.__prayerRows || []);
    }
    form.reset();
    closeConfirmModal(root);
    if (root.querySelector('.cf-turnstile') && window.turnstile?.reset) {
      try {
        window.turnstile.reset();
      } catch {
        // The widget can be absent in local dev while the global script exists.
      }
    }
    const requestedVisibility = String(data.visibility || formData.get('visibility') || 'private');
    setStatus(
      root,
      requestedVisibility === 'public' ? text(root, 'successPublicPending') : text(root, 'successPrivate'),
      'success',
    );
  } catch (error) {
    setStatus(root, error?.message || text(root, 'submitErrorRetry'), 'error');
  } finally {
    submit?.removeAttribute('disabled');
  }
}

function setupForm(root) {
  const form = root.querySelector('[data-prayer-form]');
  if (!form) return;

  const submit = root.querySelector('[data-prayer-submit]');
  const confirm = root.querySelector('[data-prayer-confirm]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit?.hasAttribute('disabled')) return;
    if (openConfirmModal(root, form)) return;
    await sendPrayerForm(root, form, submit);
  });

  confirm?.querySelectorAll('[data-prayer-confirm-cancel]').forEach((button) => {
    button.addEventListener('click', () => closeConfirmModal(root));
  });

  confirm?.querySelector('[data-prayer-confirm-switch]')?.addEventListener('click', () => {
    setVisibility(form, selectedVisibility(form) === 'public' ? 'private' : 'public');
    updateConfirmModal(root, form);
  });

  confirm?.querySelector('[data-prayer-confirm-send]')?.addEventListener('click', async () => {
    await sendPrayerForm(root, form, submit);
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

  setupPagination(root);
  setupPrayerDetail(root);
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
