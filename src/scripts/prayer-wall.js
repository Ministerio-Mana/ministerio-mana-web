const DESKTOP_SLOTS = [
  [23.2, 16.4, -3, 0, 'right'],
  [56, 16.4, 1, 3, 'right'],
  [82.3, 30.2, -2, 2, 'left'],
  [10, 35.5, 0, 1, 'right'],
  [52.5, 40.6, 0, 1, 'left'],
  [24.2, 44.8, 0, 1, 'left'],
  [62.5, 44.8, -2, 3, 'right'],
  [27.1, 72.9, 0, 1, 'right'],
  [63.5, 72.9, 0, 1, 'left'],
  [74.2, 38.4, 0, 1, 'left'],
  [24.6, 72.9, 1, 3, 'right'],
  [60.4, 72.9, -2, 0, 'left'],
  [10, 23.5, 0, 1, 'right'],
  [52.5, 35.6, 0, 1, 'left'],
];

const MOBILE_SLOTS = [
  [23.2, 16.4, -3, 0, 'right'],
  [56, 16.4, 1, 3, 'right'],
  [82.3, 30.2, -2, 2, 'left'],
  [10, 35.5, 0, 1, 'right'],
  [52.5, 40.6, 0, 1, 'right'],
  [27.1, 72.9, 0, 1, 'right'],
  [63.5, 72.9, -2, 0, 'left'],
  [24.2, 44.8, 0, 1, 'right'],
];

const NOTE_PAPERS = [
  `
    <svg viewBox="0 0 128 86" focusable="false">
      <path class="prayer-note__paper-shadow" d="M16 46 L46 38 L51 51 L18 58 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--back" d="M14 43 C25 38 36 42 47 36 L53 49 C38 48 28 56 15 55 Z" />
      <path class="prayer-note__paper-fold" d="M24 43 C31 48 30 52 18 55" />
      <path class="prayer-note__paper-shadow" d="M46 35 L91 25 L99 43 L48 52 Z" />
      <path class="prayer-note__paper-body" d="M43 32 C58 26 75 33 94 24 L101 41 C80 39 64 50 44 49 Z" />
      <path class="prayer-note__paper-fold" d="M54 33 C65 40 62 45 48 49" />
      <path class="prayer-note__paper-line" d="M66 37 C76 33 84 35 93 31" />
      <path class="prayer-note__paper-shadow" d="M78 19 L112 15 L115 31 L78 35 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M76 17 C87 13 99 19 112 14 L117 29 C102 26 91 36 77 32 Z" />
      <path class="prayer-note__paper-fold" d="M86 17 C92 22 91 28 79 32" />
    </svg>
  `,
  `
    <svg viewBox="0 0 128 86" focusable="false">
      <path class="prayer-note__paper-shadow" d="M40 15 L58 12 L61 36 L38 40 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--blue" d="M38 13 C46 9 54 15 60 11 L62 35 C52 31 44 41 37 37 Z" />
      <path class="prayer-note__paper-fold" d="M44 15 C52 21 51 27 39 37" />
      <path class="prayer-note__paper-shadow" d="M33 38 L63 33 L67 55 L34 59 Z" />
      <path class="prayer-note__paper-body" d="M31 36 C43 31 53 38 64 31 L68 53 C55 50 44 61 32 57 Z" />
      <path class="prayer-note__paper-fold" d="M41 36 C50 44 47 51 33 57" />
      <path class="prayer-note__paper-shadow" d="M28 59 L56 54 L60 78 L29 81 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M27 57 C38 53 48 59 57 53 L61 76 C49 72 38 84 28 79 Z" />
      <path class="prayer-note__paper-fold" d="M35 58 C45 65 42 72 29 79" />
      <path class="prayer-note__paper-body prayer-note__paper-body--pink" d="M54 60 C63 56 70 60 78 57 L80 76 C70 72 64 80 55 78 Z" />
    </svg>
  `,
  `
    <svg viewBox="0 0 128 86" focusable="false">
      <path class="prayer-note__paper-shadow" d="M16 36 L46 31 L50 48 L17 51 Z" />
      <path class="prayer-note__paper-body" d="M14 34 C25 30 36 35 47 29 L51 46 C38 43 29 53 15 49 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--blue" d="M42 32 C52 27 62 34 72 29 L76 47 C64 44 55 52 43 49 Z" />
      <path class="prayer-note__paper-fold" d="M51 33 C58 39 56 44 44 49" />
      <path class="prayer-note__paper-body prayer-note__paper-body--back" d="M74 42 C85 36 96 44 108 36 L113 53 C99 50 90 59 75 56 Z" />
      <path class="prayer-note__paper-fold" d="M84 42 C94 49 91 54 76 56" />
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M91 27 C100 23 110 28 119 24 L122 39 C111 36 103 43 92 41 Z" />
    </svg>
  `,
  `
    <svg viewBox="0 0 128 86" focusable="false">
      <path class="prayer-note__paper-body prayer-note__paper-body--front" d="M12 45 C23 40 33 48 43 42 L47 57 C35 54 26 62 13 58 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--back" d="M33 42 C45 38 55 45 66 39 L70 58 C57 54 48 63 34 59 Z" />
      <path class="prayer-note__paper-body prayer-note__paper-body--pink" d="M56 39 C68 35 80 43 91 36 L95 56 C82 52 72 62 57 58 Z" />
      <path class="prayer-note__paper-body" d="M83 38 C97 33 107 40 120 34 L123 52 C109 48 99 58 84 55 Z" />
      <path class="prayer-note__paper-fold" d="M21 45 C29 51 27 55 14 58" />
      <path class="prayer-note__paper-fold" d="M44 43 C53 50 50 56 35 59" />
      <path class="prayer-note__paper-fold" d="M67 40 C76 48 73 54 58 58" />
      <path class="prayer-note__paper-fold" d="M94 39 C104 46 101 51 85 55" />
      <path class="prayer-note__paper-line" d="M100 42 C107 39 113 41 119 38" />
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
  return compactWallQuery.matches ? 6 : 9;
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
    if (item !== note) item.classList.remove('is-open');
  });
  note.classList.add('is-open');

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
  root.querySelectorAll('[data-prayer-card].is-open').forEach((note) => note.classList.remove('is-open'));
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
  note.setAttribute('role', 'group');
  note.setAttribute('aria-label', `${row.first_name}. ${row.request_text}`);
  note.style.setProperty('--x', `${position[0]}%`);
  note.style.setProperty('--y', `${position[1]}%`);
  note.style.setProperty('--r', `${position[2]}deg`);
  const paperType = Number.isFinite(Number(position[3])) ? Number(position[3]) : index % NOTE_PAPERS.length;
  note.dataset.paperType = String(paperType);
  note.dataset.labelSide =
    typeof position[4] === 'string'
      ? position[4]
      : position[0] > (compactWallQuery.matches ? 58 : 62)
        ? 'left'
        : 'right';

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
