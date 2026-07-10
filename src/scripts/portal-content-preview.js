import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const loading = document.getElementById('cms-preview-loading');
const errorBox = document.getElementById('cms-preview-error');
const root = document.getElementById('cms-preview-root');
const status = document.getElementById('cms-preview-status');

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
  if (!safe) return '';
  try {
    const url = new URL(safe);
    if (url.hostname === 'youtu.be') return `https://www.youtube.com/embed/${encodeURIComponent(url.pathname.slice(1))}`;
    if (['youtube.com', 'www.youtube.com'].includes(url.hostname)) {
      const id = url.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
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

function renderSection(section) {
  const payload = section?.payload || {};
  const title = payload.title || section?.title || '';

  if (section?.kind === 'hero') {
    const image = safeUrl(payload.image);
    const ctaHref = safeUrl(payload.ctaHref || payload.cta_url || '/');
    return `<section class="relative min-h-[360px] overflow-hidden rounded-lg bg-[#293C74] text-white">
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(payload.imageAlt || title)}" class="absolute inset-0 h-full w-full object-cover" />` : ''}
      <div class="absolute inset-0 bg-slate-950/55"></div>
      <div class="relative flex min-h-[360px] max-w-3xl flex-col justify-end px-6 py-10 sm:px-10">
        ${payload.eyebrow ? `<p class="text-xs font-bold uppercase text-white/80">${escapeHtml(payload.eyebrow)}</p>` : ''}
        <h1 class="mt-2 text-3xl font-bold sm:text-5xl">${escapeHtml(title || 'Ministerio Maná')}</h1>
        ${payload.subtitle ? `<p class="mt-3 max-w-2xl text-base text-white/90">${escapeHtml(payload.subtitle)}</p>` : ''}
        ${payload.ctaLabel ? `<a href="${escapeAttr(ctaHref || '#')}" class="mt-5 inline-flex w-fit rounded-md bg-white px-5 py-3 text-sm font-bold text-[#293C74]">${escapeHtml(payload.ctaLabel)}</a>` : ''}
      </div>
    </section>`;
  }

  if (section?.kind === 'rich_text') {
    return `<section class="portal-panel px-6 py-8 sm:px-8"><h2 class="text-2xl font-bold text-[#293C74]">${escapeHtml(title)}</h2>${payload.text ? `<p class="mt-3 whitespace-pre-wrap leading-relaxed text-slate-700">${escapeHtml(payload.text)}</p>` : ''}</section>`;
  }

  if (section?.kind === 'gallery') {
    const images = Array.isArray(payload.images) ? payload.images : [];
    return `<section class="portal-panel px-6 py-8 sm:px-8"><h2 class="text-2xl font-bold text-[#293C74]">${escapeHtml(title)}</h2><div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">${images.map((image) => {
      const src = safeUrl(image?.src);
      return src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(image?.alt || '')}" class="aspect-[4/3] w-full rounded-md object-cover" loading="lazy" />` : '';
    }).join('')}</div></section>`;
  }

  if (section?.kind === 'video') {
    const embed = embedUrl(payload.url || payload.videoUrl || '');
    return `<section class="portal-panel px-6 py-8 sm:px-8"><h2 class="text-2xl font-bold text-[#293C74]">${escapeHtml(title)}</h2>${embed ? `<iframe src="${escapeAttr(embed)}" title="${escapeAttr(title || 'Video')}" class="mt-5 aspect-video w-full rounded-md border border-slate-200" allowfullscreen></iframe>` : '<p class="mt-3 text-sm text-slate-500">Video no configurado.</p>'}</section>`;
  }

  if (section?.kind === 'cards') {
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    return `<section class="portal-panel px-6 py-8 sm:px-8"><h2 class="text-2xl font-bold text-[#293C74]">${escapeHtml(title)}</h2><div class="mt-5 grid gap-3 md:grid-cols-3">${cards.map((card) => `<article class="rounded-md border border-slate-200 bg-slate-50 p-4"><h3 class="font-bold text-[#293C74]">${escapeHtml(card?.title || 'Tarjeta')}</h3>${card?.text ? `<p class="mt-1 text-sm text-slate-600">${escapeHtml(card.text)}</p>` : ''}</article>`).join('')}</div></section>`;
  }

  if (section?.kind === 'cta') {
    const primaryHref = safeUrl(payload.primaryHref || payload.primary_url || '/');
    const secondaryHref = safeUrl(payload.secondaryHref || payload.secondary_url || '/');
    return `<section class="rounded-lg border border-[#293C74]/20 bg-[#293C74] px-6 py-10 text-center text-white sm:px-8"><h2 class="text-3xl font-bold">${escapeHtml(title)}</h2>${payload.text ? `<p class="mt-2 text-white/80">${escapeHtml(payload.text)}</p>` : ''}<div class="mt-5 flex flex-wrap justify-center gap-3">${payload.primaryLabel ? `<a href="${escapeAttr(primaryHref || '#')}" class="rounded-md bg-white px-5 py-3 text-sm font-bold text-[#293C74]">${escapeHtml(payload.primaryLabel)}</a>` : ''}${payload.secondaryLabel ? `<a href="${escapeAttr(secondaryHref || '#')}" class="rounded-md border border-white/40 px-5 py-3 text-sm font-bold text-white">${escapeHtml(payload.secondaryLabel)}</a>` : ''}</div></section>`;
  }

  return `<section class="portal-panel px-6 py-8 sm:px-8"><h2 class="text-xl font-bold text-[#293C74]">${escapeHtml(title || 'Bloque avanzado')}</h2></section>`;
}

async function boot() {
  try {
    const auth = await ensureAuthenticated();
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    const pageId = new URL(window.location.href).searchParams.get('page_id');
    if (!pageId) throw new Error('Falta seleccionar la página.');
    const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    const response = await fetch(`/api/portal/content/pages?page_id=${encodeURIComponent(pageId)}`, { headers, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'No se pudo cargar la vista previa.');

    document.title = `${data.page?.title || 'Contenido'} | Vista previa`;
    if (status) status.textContent = data.page?.status === 'published' ? 'Publicado' : 'Vista previa privada';
    if (root) {
      root.innerHTML = (data.sections || []).filter((section) => section.status !== 'archived').map(renderSection).join('') || '<div class="portal-panel px-6 py-12 text-center text-slate-500">Esta página todavía no tiene bloques visibles.</div>';
      root.classList.remove('hidden');
    }
    loading?.classList.add('hidden');
  } catch (error) {
    loading?.classList.add('hidden');
    if (errorBox) {
      errorBox.textContent = error?.message || 'No se pudo cargar la vista previa.';
      errorBox.classList.remove('hidden');
    }
  }
}

boot();
