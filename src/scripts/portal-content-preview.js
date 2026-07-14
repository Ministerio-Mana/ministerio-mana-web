import { ensureAuthenticated, getPortalSession, redirectToLogin } from '@lib/portalAuthClient';

const loading = document.getElementById('cms-preview-loading');
const errorBox = document.getElementById('cms-preview-error');
const errorMessage = document.getElementById('cms-preview-error-message');
const retryButton = document.getElementById('cms-preview-retry');
const root = document.getElementById('cms-preview-root');
const status = document.getElementById('cms-preview-status');
const pageTitle = document.getElementById('cms-preview-page-title');
const linkFeedback = document.getElementById('cms-preview-link-feedback');
const REQUEST_TIMEOUT_MS = 15000;
let bootRevision = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function safeUrl(value) {
  const url = String(value || '').trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (/^https:\/\//i.test(url)) return url;
  return '';
}

function embedUrl(value) {
  const safe = safeUrl(value);
  if (!safe || safe.startsWith('/')) return '';
  try {
    const url = new URL(safe);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id = url.searchParams.get('v') || (['embed', 'shorts'].includes(parts[0]) ? parts[1] : '');
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname)) {
      const id = url.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : '';
    }
  } catch {
    return '';
  }
  return '';
}

function renderPreviewLink(label, rawHref, className) {
  if (!label) return '';
  const href = safeUrl(rawHref);
  if (!href) {
    return `<span class="${className} cursor-not-allowed opacity-60" aria-disabled="true">${escapeHtml(label)}</span>`;
  }
  return `<a href="${escapeAttr(href)}" data-preview-link class="${className}" aria-label="${escapeAttr(label)}; enlace desactivado en vista previa">${escapeHtml(label)}</a>`;
}

function renderImage(src, alt, className) {
  if (!src) return '';
  return `<div class="relative overflow-hidden rounded-md bg-slate-100">
    <img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" data-preview-image class="${className}" loading="lazy" decoding="async" />
    <div data-preview-image-fallback class="hidden min-h-32 items-center justify-center px-4 py-8 text-center text-sm font-bold text-slate-500">Imagen no disponible</div>
  </div>`;
}

function renderSection(section, index) {
  const payload = section?.payload || {};
  const title = payload.title || section?.title || '';
  const headingId = `cms-preview-section-${index + 1}`;

  if (section?.kind === 'hero') {
    const image = safeUrl(payload.image);
    const cta = renderPreviewLink(
      payload.ctaLabel,
      payload.ctaHref || payload.cta_url || '',
      'mt-4 inline-flex min-h-11 w-fit items-center rounded-md bg-white px-4 py-2 text-sm font-bold text-[#293C74]',
    );
    return `<section class="relative min-h-[360px] overflow-hidden rounded-lg bg-[#293C74] text-white" aria-labelledby="${headingId}">
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(payload.imageAlt || '')}" data-preview-image class="absolute inset-0 h-full w-full object-cover" />` : ''}
      <div class="absolute inset-0 bg-slate-950/55"></div>
      <div class="relative flex min-h-[360px] max-w-3xl flex-col justify-end px-6 py-10 sm:px-10">
        ${payload.eyebrow ? `<p class="text-xs font-bold uppercase text-white/80">${escapeHtml(payload.eyebrow)}</p>` : ''}
        <h2 id="${headingId}" class="mt-2 text-3xl font-bold sm:text-5xl">${escapeHtml(title || 'Ministerio Maná')}</h2>
        ${payload.subtitle ? `<p class="mt-4 max-w-2xl text-base leading-relaxed text-white/90">${escapeHtml(payload.subtitle)}</p>` : ''}
        ${cta}
      </div>
    </section>`;
  }

  if (section?.kind === 'story') {
    const scenes = Array.isArray(payload.scenes) ? payload.scenes.slice(0, 8) : [];
    const sceneMarkup = scenes.map((scene, sceneIndex) => {
      const image = safeUrl(scene?.image);
      const focalMap = { center: '50% 50%', top: '50% 15%', bottom: '50% 85%', left: '20% 50%', right: '80% 50%' };
      const focal = focalMap[scene?.focalPoint] || focalMap.center;
      return `<article class="overflow-hidden rounded-lg border border-slate-200 bg-white">
        ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(scene?.imageAlt || '')}" data-preview-image class="aspect-video w-full object-cover" style="object-position:${escapeAttr(focal)}" loading="lazy" decoding="async" />` : '<div class="flex aspect-video items-center justify-center bg-slate-100 px-4 text-center text-sm font-bold text-slate-400">Falta elegir una imagen</div>'}
        <div class="p-6">
          ${scene?.eyebrow ? `<p class="text-xs font-black uppercase tracking-wider text-brand-teal">${escapeHtml(scene.eyebrow)}</p>` : ''}
          <h3 class="mt-2 text-2xl font-black text-[#293C74]">${escapeHtml(scene?.title || `Escena ${sceneIndex + 1}`)}</h3>
          ${scene?.text ? `<p class="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600">${escapeHtml(scene.text)}</p>` : ''}
        </div>
      </article>`;
    }).join('');
    return `<section class="rounded-lg bg-[#07111c] px-6 py-8 text-white sm:px-8" aria-labelledby="${headingId}">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p class="text-xs font-black uppercase tracking-wider text-brand-gold">Historia Maná</p><h2 id="${headingId}" class="mt-2 text-3xl font-black">${escapeHtml(title || 'Historia guiada')}</h2></div>
        <p class="text-sm text-white/70">${escapeHtml(scenes.length)} escena${scenes.length === 1 ? '' : 's'} · en la página pública tendrán movimiento adaptable</p>
      </div>
      ${sceneMarkup ? `<div class="mt-6 grid gap-4 md:grid-cols-2">${sceneMarkup}</div>` : '<p class="mt-6 text-sm text-white/70">Agrega al menos dos escenas.</p>'}
    </section>`;
  }

  if (section?.kind === 'rich_text') {
    return `<section class="portal-panel px-6 py-8 sm:px-8" aria-labelledby="${headingId}"><div class="max-w-3xl"><h2 id="${headingId}" class="text-2xl font-bold text-[#293C74]">${escapeHtml(title || 'Contenido')}</h2>${payload.text ? `<p class="mt-4 whitespace-pre-wrap leading-relaxed text-slate-700">${escapeHtml(payload.text)}</p>` : '<p class="mt-4 text-sm text-slate-500">Este bloque todavía no tiene texto.</p>'}</div></section>`;
  }

  if (section?.kind === 'gallery') {
    const images = Array.isArray(payload.images) ? payload.images : [];
    const imageMarkup = images.map((image, imageIndex) => {
      const src = safeUrl(image?.src);
      return renderImage(src, image?.alt || `Imagen ${imageIndex + 1} de ${title || 'la galería'}`, 'aspect-[4/3] w-full object-cover');
    }).join('');
    return `<section class="portal-panel px-6 py-8 sm:px-8" aria-labelledby="${headingId}"><h2 id="${headingId}" class="text-2xl font-bold text-[#293C74]">${escapeHtml(title || 'Galería')}</h2>${imageMarkup ? `<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">${imageMarkup}</div>` : '<p class="mt-4 text-sm text-slate-500">Esta galería todavía no tiene imágenes.</p>'}</section>`;
  }

  if (section?.kind === 'video') {
    const embed = embedUrl(payload.url || payload.videoUrl || '');
    return `<section class="portal-panel px-6 py-8 sm:px-8" aria-labelledby="${headingId}"><h2 id="${headingId}" class="text-2xl font-bold text-[#293C74]">${escapeHtml(title || 'Video')}</h2>${embed ? `<iframe src="${escapeAttr(embed)}" title="${escapeAttr(title || 'Video')}" class="mt-4 aspect-video w-full rounded-md border border-slate-200" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>` : '<p class="mt-4 text-sm text-slate-500">Video no configurado.</p>'}</section>`;
  }

  if (section?.kind === 'cards') {
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    const cardsMarkup = cards.map((card) => `<article class="rounded-md border border-slate-200 bg-slate-50 p-4"><h3 class="font-bold text-[#293C74]">${escapeHtml(card?.title || 'Tarjeta')}</h3>${card?.text ? `<p class="mt-2 text-sm leading-relaxed text-slate-600">${escapeHtml(card.text)}</p>` : ''}</article>`).join('');
    return `<section class="portal-panel px-6 py-8 sm:px-8" aria-labelledby="${headingId}"><h2 id="${headingId}" class="text-2xl font-bold text-[#293C74]">${escapeHtml(title || 'Tarjetas')}</h2>${cardsMarkup ? `<div class="mt-4 grid gap-4 md:grid-cols-3">${cardsMarkup}</div>` : '<p class="mt-4 text-sm text-slate-500">Este bloque todavía no tiene tarjetas.</p>'}</section>`;
  }

  if (section?.kind === 'cta') {
    const primary = renderPreviewLink(
      payload.primaryLabel,
      payload.primaryHref || payload.primary_url || '',
      'inline-flex min-h-11 items-center rounded-md bg-white px-4 py-2 text-sm font-bold text-[#293C74]',
    );
    const secondary = renderPreviewLink(
      payload.secondaryLabel,
      payload.secondaryHref || payload.secondary_url || '',
      'inline-flex min-h-11 items-center rounded-md border border-white/40 px-4 py-2 text-sm font-bold text-white',
    );
    return `<section class="rounded-lg border border-[#293C74]/20 bg-[#293C74] px-6 py-10 text-center text-white sm:px-8" aria-labelledby="${headingId}"><h2 id="${headingId}" class="text-3xl font-bold">${escapeHtml(title || 'Llamado a la acción')}</h2>${payload.text ? `<p class="mt-2 text-white/80">${escapeHtml(payload.text)}</p>` : ''}${primary || secondary ? `<div class="mt-4 flex flex-wrap justify-center gap-4">${primary}${secondary}</div>` : '<p class="mt-4 text-sm text-white/70">Este bloque todavía no tiene botones.</p>'}</section>`;
  }

  return `<section class="portal-panel px-6 py-8 sm:px-8" aria-labelledby="${headingId}"><h2 id="${headingId}" class="text-xl font-bold text-[#293C74]">${escapeHtml(title || 'Bloque avanzado')}</h2><p class="mt-2 text-sm text-slate-500">Este tipo de bloque usa una representación básica en la vista previa.</p></section>`;
}

function setLoadingState(isLoading) {
  loading?.classList.toggle('hidden', !isLoading);
  errorBox?.classList.add('hidden');
  if (isLoading) root?.classList.add('hidden');
  if (retryButton) retryButton.disabled = isLoading;
}

function showError(message) {
  loading?.classList.add('hidden');
  root?.classList.add('hidden');
  if (errorMessage) errorMessage.textContent = message;
  errorBox?.classList.remove('hidden');
  retryButton?.focus();
}

function bindRenderedImageFallbacks() {
  root?.querySelectorAll('[data-preview-image]').forEach((image) => {
    image.addEventListener('error', () => {
      image.classList.add('hidden');
      const fallback = image.parentElement?.querySelector('[data-preview-image-fallback]');
      fallback?.classList.remove('hidden');
      fallback?.classList.add('flex');
    }, { once: true });
  });
}

async function fetchPreview(pageId, headers) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/portal/content/preview?page_id=${encodeURIComponent(pageId)}`, {
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'No se pudo cargar la vista previa.');
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La vista previa tardó demasiado. Revisa tu conexión e intenta de nuevo.');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function boot() {
  const requestRevision = ++bootRevision;
  setLoadingState(true);
  try {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    const { ok: sessionOk, data: session } = await getPortalSession({ auth });
    const role = session?.profile?.effective_role || session?.profile?.role || 'user';
    if (!sessionOk || !session?.ok || !['admin', 'superadmin'].includes(role)) {
      window.location.replace('/portal');
      return;
    }

    const pageId = new URL(window.location.href).searchParams.get('page_id');
    if (!pageId || !/^[a-f0-9-]{20,60}$/i.test(pageId)) throw new Error('Falta seleccionar una página válida.');
    const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    const data = await fetchPreview(pageId, headers);
    if (requestRevision !== bootRevision) return;

    const title = data.page?.title || data.page?.page_key || 'Contenido';
    document.title = `${title} | Vista previa`;
    if (pageTitle) pageTitle.textContent = title;
    if (status) {
      const published = data.page?.status === 'published';
      status.textContent = published ? 'Publicado' : 'Vista previa privada';
      status.className = `mt-2 inline-flex rounded-full border px-4 py-2 text-xs font-bold ${published
        ? 'border-teal-200 bg-teal-50 text-teal-800'
        : 'border-amber-200 bg-amber-50 text-amber-800'}`;
    }
    if (root) {
      const sections = (data.sections || []).filter((section) => section.status !== 'archived');
      root.innerHTML = sections.map(renderSection).join('') || '<div class="portal-panel px-6 py-12 text-center text-slate-500">Esta página todavía no tiene bloques visibles.</div>';
      bindRenderedImageFallbacks();
      root.classList.remove('hidden');
    }
    loading?.classList.add('hidden');
  } catch (error) {
    if (requestRevision !== bootRevision) return;
    showError(error?.message || 'No se pudo cargar la vista previa.');
  } finally {
    if (requestRevision === bootRevision && retryButton) retryButton.disabled = false;
  }
}

root?.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('[data-preview-link]') : null;
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  if (linkFeedback) {
    linkFeedback.textContent = `Enlace revisado: ${href}. No se abrió.`;
    linkFeedback.classList.remove('hidden');
  }
});

retryButton?.addEventListener('click', () => {
  boot();
});

boot();
