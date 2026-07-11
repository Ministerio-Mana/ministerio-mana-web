const gallery = document.querySelector('[data-cumbre-event-gallery]');

if (gallery) {
  const tabs = Array.from(gallery.querySelectorAll('[role="tab"]'));
  const grid = gallery.querySelector('[data-gallery-grid]');
  const status = gallery.querySelector('[data-gallery-status]');
  const title = gallery.querySelector('[data-gallery-title]');
  const description = gallery.querySelector('[data-gallery-description]');
  const loadMore = gallery.querySelector('[data-gallery-load-more]');
  const sentinel = gallery.querySelector('[data-gallery-sentinel]');
  const lightbox = gallery.querySelector('[data-gallery-lightbox]');
  const lightboxImage = gallery.querySelector('[data-gallery-lightbox-image]');
  const lightboxCount = gallery.querySelector('[data-gallery-lightbox-count]');
  const lightboxClose = gallery.querySelector('[data-gallery-lightbox-close]');
  const lightboxPrev = gallery.querySelector('[data-gallery-lightbox-prev]');
  const lightboxNext = gallery.querySelector('[data-gallery-lightbox-next]');
  const initialTab = tabs.find((tab) => !tab.disabled);
  const state = {
    album: initialTab?.dataset.album || '',
    offset: 0,
    hasMore: false,
    loading: false,
    requestId: 0,
    images: [],
    activeIndex: -1,
  };

  const setActiveTab = (album) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.album === album;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const tab = tabs.find((item) => item.dataset.album === album);
    if (title) title.textContent = tab?.dataset.title || 'Galería';
    if (description) description.textContent = tab?.dataset.description || '';
  };

  const openLightbox = (index) => {
    const image = state.images[index];
    if (!image || !lightbox || !lightboxImage) return;
    state.activeIndex = index;
    lightboxImage.src = image.display_url;
    lightboxImage.alt = image.name || 'Cumbre Mundial Maná 2026';
    if (lightboxCount) lightboxCount.textContent = `${index + 1} de ${state.images.length}`;
    if (typeof lightbox.showModal === 'function') lightbox.showModal();
  };

  const moveLightbox = (direction) => {
    if (!state.images.length) return;
    openLightbox((state.activeIndex + direction + state.images.length) % state.images.length);
  };

  const appendImages = (images) => {
    if (!grid) return;
    const fragment = document.createDocumentFragment();
    images.forEach((image, localIndex) => {
      const index = state.images.length + localIndex;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'group relative aspect-[4/3] overflow-hidden bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-brand-void';
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
  };

  const loadImages = async (reset = false) => {
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
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled || tab.dataset.album === state.album) return;
      state.album = tab.dataset.album || '';
      state.hasMore = true;
      setActiveTab(state.album);
      loadImages(true);
    });
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
}
