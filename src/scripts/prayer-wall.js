const WALL_SLOTS = [
  [24.2, 16.45, -3, 0, 'horizontal'],
  [56.05, 16.45, 3, 1, 'horizontal'],
  [82.3, 30.16, -2, 2, 'horizontal'],
  [24.5, 44.84, 2, 3, 'horizontal'],
  [62.3, 44.84, -3, 0, 'horizontal'],
  [28.2, 72.9, 2, 1, 'horizontal'],
  [64.6, 72.9, -2, 2, 'horizontal'],
];

const PAGE_SIZE_COMPACT = 5;
const PAGE_SIZE_TABLET = 6;
const PAGE_SIZE_DESKTOP = WALL_SLOTS.length;

const NOTE_PAPERS = [
  `
    <svg viewBox="0 0 132 40" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M6 13 L128 10 L126 35 L8 37 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M5 10 C39 6 87 14 127 8 L125 32 C88 28 45 37 7 32 Z" />
      <path class="prayer-note__paper-corner" d="M108 10 L127 8 L125 21 Z" />
      <path class="prayer-note__paper-fold" d="M35 10 C43 17 38 24 31 31 M101 11 C95 18 99 24 107 30" />
      <path class="prayer-note__paper-line" d="M46 19 C64 16 83 21 101 18 M45 25 C64 23 83 27 100 23" />
    </svg>
  `,
  `
    <svg viewBox="0 0 132 40" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M6 13 L127 13 L129 34 L7 37 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--pink" d="M6 10 C43 14 86 7 126 12 L127 31 C89 36 44 27 7 32 Z" />
      <path class="prayer-note__paper-corner" d="M7 10 L25 12 L8 23 Z" />
      <path class="prayer-note__paper-fold" d="M32 12 C39 19 35 25 28 31 M103 12 C97 19 101 25 109 30" />
      <path class="prayer-note__paper-line" d="M47 19 C65 22 83 18 101 21 M46 25 C65 28 83 23 102 26" />
    </svg>
  `,
  `
    <svg viewBox="0 0 132 40" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M7 14 L129 10 L126 35 L8 37 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--blue" d="M7 11 C43 7 88 15 125 9 L126 31 C87 27 46 36 8 32 Z" />
      <path class="prayer-note__paper-corner" d="M106 11 L125 9 L126 22 Z" />
      <path class="prayer-note__paper-fold" d="M30 11 C38 18 34 25 26 31 M100 12 C94 18 99 24 107 29" />
      <path class="prayer-note__paper-line" d="M47 19 C65 16 83 21 100 18 M46 25 C65 23 83 27 102 23" />
    </svg>
  `,
  `
    <svg viewBox="0 0 132 40" preserveAspectRatio="none" focusable="false">
      <path class="prayer-note__paper-shadow" d="M7 13 L128 13 L127 35 L8 37 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--warm" d="M7 11 C44 15 86 8 125 13 L126 31 C88 36 45 27 7 32 Z" />
      <path class="prayer-note__paper-corner" d="M8 11 L27 13 L8 24 Z" />
      <path class="prayer-note__paper-fold" d="M32 13 C39 19 35 25 28 31 M102 13 C96 19 101 25 109 31" />
      <path class="prayer-note__paper-line" d="M48 20 C66 23 83 18 100 21 M47 26 C65 29 84 23 102 26" />
    </svg>
  `,
];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileWallQuery = window.matchMedia('(max-width: 767px)');
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
  return WALL_SLOTS;
}

function getPageSize(root) {
  if (isCompact(root) || mobileWallQuery.matches) return PAGE_SIZE_COMPACT;
  return compactWallQuery.matches ? PAGE_SIZE_TABLET : PAGE_SIZE_DESKTOP;
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

function setPrayButtonLabel(root, button, acknowledged) {
  const icon = document.createElement('span');
  icon.className = 'prayer-action-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = acknowledged ? '✓' : '♡';
  button.replaceChildren(icon, document.createTextNode(acknowledged ? text(root, 'prayed') : text(root, 'prayButton')));
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
  setPrayButtonLabel(root, button, true);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionPrayerDetail(note, detail) {
  const stage = note.closest('[data-wall-stage]');
  if (!(stage instanceof HTMLElement)) return;

  const stageRect = stage.getBoundingClientRect();
  const noteRect = note.getBoundingClientRect();
  const edge = 12;
  const availableWidth = Math.max(0, stageRect.width - edge * 2);
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const preferredWidth = narrow
    ? availableWidth
    : Math.min(384, Math.max(280, stageRect.width * 0.44));
  const detailWidth = Math.min(availableWidth, preferredWidth);

  detail.style.width = `${detailWidth}px`;
  detail.style.left = `${edge}px`;
  detail.style.right = 'auto';
  detail.style.top = `${edge}px`;

  const detailHeight = detail.offsetHeight;
  const anchorX = noteRect.left - stageRect.left + noteRect.width / 2;
  const anchorY = noteRect.top - stageRect.top + noteRect.height / 2;
  const preferredLeft = narrow
    ? (stageRect.width - detailWidth) / 2
    : anchorX <= stageRect.width / 2
      ? anchorX + 20
      : anchorX - detailWidth - 20;
  const left = clamp(preferredLeft, edge, Math.max(edge, stageRect.width - detailWidth - edge));
  const top = clamp(anchorY - detailHeight / 2, edge, Math.max(edge, stageRect.height - detailHeight - edge));

  detail.style.left = `${Math.round(left)}px`;
  detail.style.top = `${Math.round(top)}px`;
  detail.style.setProperty('--detail-origin-x', `${Math.round(clamp(anchorX - left, 0, detailWidth))}px`);
  detail.style.setProperty('--detail-origin-y', `${Math.round(clamp(anchorY - top, 0, detailHeight))}px`);
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
  const acknowledged = hasPrayed(row.id);
  setPrayButtonLabel(root, button, acknowledged);
  button.disabled = acknowledged;
  button.addEventListener('click', () => handlePrayerAction(root, row, count, button));
  oldButton.replaceWith(button);
  detail.classList.remove('is-unfolding');
  detail.hidden = false;
  root.querySelectorAll('[data-prayer-detail-backdrop]').forEach((backdrop) => {
    backdrop.hidden = false;
  });
  positionPrayerDetail(note, detail);
  void detail.offsetWidth;
  detail.classList.add('is-unfolding');
  root.__prayerDetailTrigger = note;
  detail.querySelector('[data-prayer-detail-close]')?.focus();
}

function closePrayerDetail(root, restoreFocus = true) {
  root.querySelectorAll('[data-prayer-detail]').forEach((detail) => {
    detail.classList.remove('is-unfolding');
    detail.hidden = true;
  });
  root.querySelectorAll('[data-prayer-detail-backdrop]').forEach((backdrop) => {
    backdrop.hidden = true;
  });
  root.querySelectorAll('[data-prayer-card].is-open').forEach((note) => {
    note.classList.remove('is-open');
    note.setAttribute('aria-expanded', 'false');
  });
  const trigger = root.__prayerDetailTrigger;
  root.__prayerDetailTrigger = null;
  if (restoreFocus && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
}

function applyPrayerSlot(element, position, index) {
  element.style.setProperty('--x', `${position[0]}%`);
  element.style.setProperty('--y', `${position[1]}%`);
  element.style.setProperty('--r', `${position[2]}deg`);
  const paperType = Number.isFinite(Number(position[3])) ? Number(position[3]) : index % NOTE_PAPERS.length;
  element.dataset.paperType = String(paperType);
  element.dataset.paperOrientation = position[4] === 'vertical' ? 'vertical' : 'horizontal';
  return paperType;
}

function createPaperVisual(paperType) {
  const paper = document.createElement('span');
  paper.className = 'prayer-note__paper';
  paper.setAttribute('aria-hidden', 'true');
  paper.innerHTML = NOTE_PAPERS[paperType % NOTE_PAPERS.length];
  return paper;
}

function createDecorativePaperSlot(position, index) {
  const slot = document.createElement('span');
  slot.className = 'prayer-note prayer-note--decorative';
  slot.setAttribute('aria-hidden', 'true');
  const paperType = applyPrayerSlot(slot, position, index);

  const pin = document.createElement('span');
  pin.className = 'prayer-note__pin';
  pin.setAttribute('aria-hidden', 'true');
  slot.append(pin, createPaperVisual(paperType));
  return slot;
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
  const paperType = applyPrayerSlot(note, position, index);

  const pin = document.createElement('span');
  pin.className = 'prayer-note__pin';
  pin.setAttribute('aria-hidden', 'true');

  const paper = createPaperVisual(paperType);

  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = row.first_name;
  const meta = document.createElement('small');
  meta.textContent = row.request_text;
  header.append(title, meta);

  const request = document.createElement('p');
  request.textContent = row.request_text;

  const footer = document.createElement('footer');
  const count = document.createElement('span');
  count.className = 'prayer-note__count';
  count.textContent = prayerCountLabel(root, row.prayers_count);

  const button = document.createElement('button');
  button.type = 'button';
  const acknowledged = hasPrayed(row.id);
  setPrayButtonLabel(root, button, acknowledged);
  button.disabled = acknowledged;

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
    detail.classList.remove('is-unfolding');
    detail.hidden = true;
  });
  root.querySelectorAll('[data-prayer-detail-backdrop]').forEach((backdrop) => {
    backdrop.hidden = true;
  });
  const pageSize = getPageSize(root);
  const slots = getSlotPositions(root);
  const totalPages = Math.max(1, Math.ceil(prayers.length / pageSize));
  const nextPage = Math.max(0, Math.min(root.__prayerPage || 0, totalPages - 1));
  root.__prayerPage = nextPage;
  const start = nextPage * pageSize;
  const visibleRows = prayers.slice(start, start + pageSize);

  slots.forEach((position, index) => {
    const row = visibleRows[index];
    list.append(row
      ? createPrayerNote(root, row, index, slots, row.id === newPrayerId)
      : createDecorativePaperSlot(position, index));
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
  [mobileWallQuery, compactWallQuery].forEach((query) => {
    if (query.addEventListener) {
      query.addEventListener('change', rerender);
    } else {
      query.addListener?.(rerender);
    }
  });
}

function setupPrayerDetail(root) {
  root.querySelectorAll('[data-prayer-detail-close]').forEach((button) => {
    button.addEventListener('click', () => closePrayerDetail(root));
  });
  root.querySelectorAll('[data-prayer-detail-backdrop]').forEach((backdrop) => {
    backdrop.addEventListener('click', () => closePrayerDetail(root));
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

function getConfirmModalFocusableElements(modal) {
  return Array.from(
    modal.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => element instanceof HTMLElement && !element.hidden);
}

function openConfirmModal(root, form, trigger) {
  const modal = root.querySelector('[data-prayer-confirm]');
  if (!modal) return false;
  updateConfirmModal(root, form);
  root.__prayerConfirmTrigger = trigger instanceof HTMLElement ? trigger : document.activeElement;
  modal.hidden = false;
  modal.querySelector('[data-prayer-confirm-send]')?.focus();
  return true;
}

function closeConfirmModal(root, restoreFocus = true) {
  const modal = root.querySelector('[data-prayer-confirm]');
  if (modal) modal.hidden = true;
  const trigger = root.__prayerConfirmTrigger;
  root.__prayerConfirmTrigger = null;
  if (restoreFocus && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
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
    closeConfirmModal(root, false);
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
    if (openConfirmModal(root, form, submit)) return;
    await sendPrayerForm(root, form, submit);
  });

  confirm?.querySelectorAll('[data-prayer-confirm-cancel]').forEach((button) => {
    button.addEventListener('click', () => closeConfirmModal(root));
  });

  confirm?.addEventListener('click', (event) => {
    if (event.target === confirm) closeConfirmModal(root);
  });

  confirm?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirmModal(root);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getConfirmModalFocusableElements(confirm);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
