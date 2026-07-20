function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function initPromotionCarousel(root) {
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';
  const track = root.querySelector('[data-promotion-track]');
  const cards = [...root.querySelectorAll('[data-promotion-card]')];
  const previous = root.querySelector('[data-promotion-previous]');
  const next = root.querySelector('[data-promotion-next]');
  const status = root.querySelector('[data-promotion-status]');
  const dots = [...root.querySelectorAll('[data-promotion-dot]')];
  if (!track || cards.length < 2) return;

  let activeIndex = 0;
  let frame = 0;
  const setActive = (index, move = false) => {
    activeIndex = Math.max(0, Math.min(cards.length - 1, index));
    status && (status.textContent = `${activeIndex + 1} de ${cards.length}`);
    dots.forEach((dot, dotIndex) => dot.setAttribute('aria-current', dotIndex === activeIndex ? 'true' : 'false'));
    previous && (previous.disabled = activeIndex === 0);
    next && (next.disabled = activeIndex === cards.length - 1);
    if (move) {
      track.scrollTo({
        left: cards[activeIndex].offsetLeft - track.offsetLeft,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  };

  previous?.addEventListener('click', () => setActive(activeIndex - 1, true));
  next?.addEventListener('click', () => setActive(activeIndex + 1, true));
  dots.forEach((dot, index) => dot.addEventListener('click', () => setActive(index, true)));
  track.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setActive(activeIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
  });
  track.addEventListener('scroll', () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      const trackLeft = track.getBoundingClientRect().left;
      const nearest = cards.reduce((best, card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - trackLeft);
        return distance < best.distance ? { index, distance } : best;
      }, { index: activeIndex, distance: Number.POSITIVE_INFINITY });
      if (nearest.index !== activeIndex) setActive(nearest.index);
    });
  }, { passive: true });
  setActive(0);
}

function dateParts(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone || 'America/Bogota',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function eventMonthKey(event) {
  const parts = dateParts(event.start, event.timezone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}` : '';
}

function eventDayKey(event) {
  const parts = dateParts(event.start, event.timezone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : '';
}

function formatEventMoment(event) {
  const date = new Date(event.start);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: event.timezone || 'America/Bogota',
  }).format(date);
}

function createCalendarListItem(event) {
  const article = document.createElement('article');
  article.className = 'church-calendar-list-item';
  const time = document.createElement('time');
  time.dateTime = event.start;
  time.textContent = formatEventMoment(event);
  const title = document.createElement('strong');
  title.textContent = event.title;
  article.append(time, title);
  if (event.audience || event.location) {
    const meta = document.createElement('span');
    meta.textContent = [event.audience, event.location].filter(Boolean).join(' · ');
    article.append(meta);
  }
  const link = document.createElement('a');
  link.href = event.href;
  link.textContent = 'Ver información';
  article.append(link);
  return article;
}

function initCalendar(root) {
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';
  const dataNode = root.querySelector('[data-church-calendar-events]');
  const grid = root.querySelector('[data-calendar-grid]');
  const title = root.querySelector('[data-calendar-title]');
  const listTitle = root.querySelector('[data-calendar-list-title]');
  const list = root.querySelector('[data-calendar-list]');
  const previous = root.querySelector('[data-calendar-previous]');
  const next = root.querySelector('[data-calendar-next]');
  if (!dataNode || !grid || !title || !list || !previous || !next) return;

  let events = [];
  try {
    const parsed = JSON.parse(dataNode.textContent || '[]');
    events = Array.isArray(parsed) ? parsed.filter((event) => event && eventDayKey(event)) : [];
  } catch {
    events = [];
  }

  const today = new Date();
  const minimum = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastEvent = events.reduce((latest, event) => {
    const date = new Date(event.start);
    return Number.isFinite(date.getTime()) && date > latest ? date : latest;
  }, minimum);
  const boundedLast = new Date(minimum.getFullYear(), minimum.getMonth() + 23, 1);
  const maximum = new Date(Math.min(
    Math.max(new Date(lastEvent.getFullYear(), lastEvent.getMonth(), 1).getTime(), new Date(minimum.getFullYear(), minimum.getMonth() + 1, 1).getTime()),
    boundedLast.getTime(),
  ));
  let visibleMonth = new Date(minimum);
  let selectedDay = '';

  const renderList = (monthEvents) => {
    list.replaceChildren();
    const selectedEvents = selectedDay ? monthEvents.filter((event) => eventDayKey(event) === selectedDay) : monthEvents;
    if (listTitle) {
      listTitle.textContent = selectedDay
        ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long' }).format(new Date(`${selectedDay}T12:00:00`))
        : 'Próximos encuentros';
    }
    if (!selectedEvents.length) {
      const empty = document.createElement('p');
      empty.className = 'church-calendar-list-empty';
      empty.textContent = selectedDay ? 'No hay más encuentros en esta fecha.' : 'No hay eventos publicados para este mes.';
      list.append(empty);
      return;
    }
    selectedEvents.forEach((event) => list.append(createCalendarListItem(event)));
  };

  const render = () => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const key = monthKey(year, month);
    const monthEvents = events
      .filter((event) => eventMonthKey(event) === key)
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
    const eventsByDay = new Map();
    monthEvents.forEach((event) => {
      const dayKey = eventDayKey(event);
      const current = eventsByDay.get(dayKey) || [];
      current.push(event);
      eventsByDay.set(dayKey, current);
    });

    selectedDay = '';
    const monthLabel = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(visibleMonth);
    title.textContent = monthLabel.charAt(0).toLocaleUpperCase('es-CO') + monthLabel.slice(1);
    previous.disabled = visibleMonth.getTime() <= minimum.getTime();
    next.disabled = visibleMonth.getTime() >= maximum.getTime();
    grid.replaceChildren();

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let index = 0; index < firstWeekday; index += 1) {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      grid.append(spacer);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayKey = `${key}-${String(day).padStart(2, '0')}`;
      const dayEvents = eventsByDay.get(dayKey) || [];
      const cell = document.createElement(dayEvents.length ? 'button' : 'span');
      cell.className = 'church-calendar-day';
      cell.textContent = String(day);
      cell.setAttribute('role', 'gridcell');
      const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
      if (isToday) cell.classList.add('church-calendar-day--today');
      if (dayEvents.length) {
        cell.type = 'button';
        cell.setAttribute('aria-label', `${day} de ${title.textContent}: ${dayEvents.length} ${dayEvents.length === 1 ? 'evento' : 'eventos'}`);
        cell.setAttribute('aria-pressed', 'false');
        const dots = document.createElement('span');
        dots.className = 'church-calendar-dots';
        dots.setAttribute('aria-hidden', 'true');
        dayEvents.slice(0, 3).forEach(() => dots.append(document.createElement('i')));
        cell.append(dots);
        cell.addEventListener('click', () => {
          const wasSelected = selectedDay === dayKey;
          selectedDay = wasSelected ? '' : dayKey;
          grid.querySelectorAll('button[aria-pressed="true"]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
          cell.setAttribute('aria-pressed', wasSelected ? 'false' : 'true');
          renderList(monthEvents);
        });
      }
      grid.append(cell);
    }
    renderList(monthEvents);
  };

  previous.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    render();
  });
  next.addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    render();
  });
  render();
}

export function initChurchEventExperiences() {
  document.querySelectorAll('[data-church-promotions]').forEach(initPromotionCarousel);
  document.querySelectorAll('[data-church-calendar]').forEach(initCalendar);
}
