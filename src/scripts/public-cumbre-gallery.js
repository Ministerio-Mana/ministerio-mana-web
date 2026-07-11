const tabs = Array.from(document.querySelectorAll('.gallery-album-tab'));
const grid = document.getElementById('gallery-grid');
const status = document.getElementById('gallery-status');
const title = document.getElementById('active-album-title');
const description = document.getElementById('active-album-description');
const loadMore = document.getElementById('gallery-load-more');
const sentinel = document.getElementById('gallery-sentinel');
const lightbox = document.getElementById('gallery-lightbox');
const lightboxImage = document.getElementById('gallery-lightbox-image');
const lightboxCount = document.getElementById('gallery-lightbox-count');
const lightboxClose = document.getElementById('gallery-lightbox-close');
const lightboxPrev = document.getElementById('gallery-lightbox-prev');
const lightboxNext = document.getElementById('gallery-lightbox-next');

function requestedAlbumFromHash() {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

const requestedAlbum = requestedAlbumFromHash();
const initialTab = tabs.find((tab) => !tab.disabled && tab.dataset.album === requestedAlbum)
  || tabs.find((tab) => !tab.disabled);

const state = {
  album: initialTab?.dataset.album || '',
  offset: 0,
  hasMore: false,
  loading: false,
  requestId: 0,
  images: [],
  activeIndex: -1,
};

function setActiveTab(album) {
  tabs.forEach((tab) => {
    const active = tab.dataset.album === album;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.classList.toggle('border-[#293C74]', active);
  });
  const tab = tabs.find((item) => item.dataset.album === album);
  if (title) title.textContent = tab?.dataset.title || 'Galería';
  if (description) description.textContent = tab?.dataset.description || '';
}

function openLightbox(index) {
  const image = state.images[index];
  if (!image || !lightbox || !lightboxImage) return;
  state.activeIndex = index;
  lightboxImage.src = image.display_url;
  lightboxImage.alt = image.name || 'Cumbre Mundial Maná 2026';
  if (lightboxCount) lightboxCount.textContent = `${index + 1} de ${state.images.length}`;
  if (typeof lightbox.showModal === 'function') lightbox.showModal();
}

function moveLightbox(direction) {
  if (!state.images.length) return;
  const next = (state.activeIndex + direction + state.images.length) % state.images.length;
  openLightbox(next);
}

function appendImages(images) {
  if (!grid) return;
  const fragment = document.createDocumentFragment();
  images.forEach((image, localIndex) => {
    const index = state.images.length + localIndex;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group relative aspect-[4/3] overflow-hidden bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#293C74] focus-visible:ring-offset-2';
    button.setAttribute('aria-label', `Abrir fotografía ${index + 1}`);

    const img = document.createElement('img');
    img.src = image.thumbnail_url;
    if (image.srcset) img.srcset = image.srcset;
    img.sizes = '(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw';
    img.alt = image.name || 'Cumbre Mundial Maná 2026';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]';
    button.append(img);
    button.addEventListener('click', () => openLightbox(index));
    fragment.append(button);
  });
  grid.append(fragment);
  state.images.push(...images);
}

async function loadImages(reset = false) {
  if (!state.album || state.loading || (!reset && !state.hasMore)) return;
  state.loading = true;
  const requestId = ++state.requestId;
  if (reset) {
    state.offset = 0;
    state.images = [];
    if (grid) grid.textContent = '';
  }
  if (status) {
    status.classList.remove('hidden');
    status.textContent = reset ? 'Cargando fotografías...' : 'Cargando más...';
  }
  loadMore?.classList.add('hidden');

  try {
    const params = new URLSearchParams({ album: state.album, offset: String(state.offset), limit: '30' });
    const response = await fetch(`/api/gallery/cumbre-mundial-2026?${params}`, { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (requestId !== state.requestId) return;
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'No se pudo cargar la galería.');
    appendImages(Array.isArray(data.images) ? data.images : []);
    state.offset = Number(data.pagination?.next_offset || state.images.length);
    state.hasMore = Boolean(data.pagination?.has_more);
    if (status) {
      status.textContent = state.images.length ? '' : 'Este álbum todavía no tiene fotografías publicadas.';
      status.classList.toggle('hidden', state.images.length > 0);
    }
    loadMore?.classList.toggle('hidden', !state.hasMore);
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (status) {
      status.classList.remove('hidden');
      status.textContent = error instanceof Error ? error.message : 'No se pudo cargar la galería.';
    }
  } finally {
    if (requestId === state.requestId) state.loading = false;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.disabled || tab.dataset.album === state.album) return;
    state.album = tab.dataset.album || '';
    window.history.replaceState(null, '', `#${state.album}`);
    state.hasMore = true;
    setActiveTab(state.album);
    loadImages(true);
  });
});

window.addEventListener('hashchange', () => {
  const album = requestedAlbumFromHash();
  const tab = tabs.find((item) => !item.disabled && item.dataset.album === album);
  if (!tab || album === state.album) return;
  state.album = album;
  state.hasMore = true;
  setActiveTab(album);
  loadImages(true);
});

loadMore?.addEventListener('click', () => loadImages(false));
lightboxClose?.addEventListener('click', () => lightbox?.close());
lightboxPrev?.addEventListener('click', () => moveLightbox(-1));
lightboxNext?.addEventListener('click', () => moveLightbox(1));
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) lightbox.close();
});
document.addEventListener('keydown', (event) => {
  if (!lightbox?.open) return;
  if (event.key === 'ArrowLeft') moveLightbox(-1);
  if (event.key === 'ArrowRight') moveLightbox(1);
});

if (sentinel && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && state.hasMore) loadImages(false);
  }, { rootMargin: '500px 0px' });
  observer.observe(sentinel);
}

setActiveTab(state.album);
state.hasMore = true;
loadImages(true);
