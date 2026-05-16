function setupVenAyudanos() {
  const root = document.querySelector('[data-ven-ayudanos]');
  if (!root || root.dataset.ready === 'true') return;
  root.dataset.ready = 'true';

  const cards = Array.from(root.querySelectorAll('[data-ministry-card]'));
  const panels = Array.from(root.querySelectorAll('[data-ministry-panel]'));
  const formLinks = Array.from(root.querySelectorAll('[data-ministry-form]'));
  const ministrySelect = root.querySelector('[data-ministry-select]');
  const form = root.querySelector('[data-help-form]');
  const status = root.querySelector('[data-form-status]');
  const submitButton = root.querySelector('[data-submit-button]');
  const successPanel = root.querySelector('[data-success-panel]');
  const shareButton = root.querySelector('[data-share-page]');

  const setHiddenValue = (selector, value) => {
    const input = root.querySelector(selector);
    if (input) input.value = value || '';
  };

  const syncTrackingFields = () => {
    const params = new URLSearchParams(window.location.search);
    setHiddenValue('[data-hidden-origin]', params.get('origen') || params.get('origin') || '');
    setHiddenValue('[data-hidden-place]', params.get('lugar') || params.get('place') || '');
    setHiddenValue('[data-hidden-utm-source]', params.get('utm_source') || '');
    setHiddenValue('[data-hidden-utm-medium]', params.get('utm_medium') || '');
    setHiddenValue('[data-hidden-utm-campaign]', params.get('utm_campaign') || '');
    setHiddenValue('[data-hidden-qr]', params.get('qr') || '');
    setHiddenValue('[data-hidden-path]', window.location.pathname);
  };

  const scrollToForm = () => {
    const target = document.getElementById('primer-paso');
    if (!target) return;
    if (window.lenis?.scrollTo) {
      window.lenis.scrollTo(target, { offset: -12 });
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectMinistry = (key, updateSelect = true) => {
    const card = cards.find((item) => item.dataset.ministryCard === key);
    const accent = card?.style.getPropertyValue('--card-accent');
    const glow = card?.style.getPropertyValue('--card-glow');

    if (accent) root.style.setProperty('--active-accent', accent);
    if (glow) root.style.setProperty('--active-glow', glow);

    cards.forEach((item) => {
      item.setAttribute('aria-pressed', item.dataset.ministryCard === key ? 'true' : 'false');
    });
    panels.forEach((item) => {
      item.dataset.active = item.dataset.ministryPanel === key ? 'true' : 'false';
    });
    if (updateSelect && ministrySelect) {
      ministrySelect.value = key;
    }
  };

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      selectMinistry(card.dataset.ministryCard);
    });
  });

  formLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const key = link.dataset.ministryForm;
      if (key) selectMinistry(key);
    });
  });

  root.querySelectorAll('[data-scroll-form]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      scrollToForm();
    });
  });

  ministrySelect?.addEventListener('change', () => {
    if (ministrySelect.value && ministrySelect.value !== 'no-estoy-seguro') {
      selectMinistry(ministrySelect.value, false);
    }
  });

  const showStatus = (message, mode = 'info') => {
    if (!status) return;
    status.textContent = message;
    status.classList.remove('hidden', 'border-red-300/30', 'bg-red-500/10', 'text-red-50', 'border-white/12', 'bg-white/8');
    if (mode === 'error') {
      status.classList.add('border-red-300/30', 'bg-red-500/10', 'text-red-50');
    } else {
      status.classList.add('border-white/12', 'bg-white/8');
    }
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    syncTrackingFields();

    const formData = new FormData(form);
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando respuesta...';
    showStatus('Estamos registrando tu respuesta.');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || 'No se pudo enviar la respuesta.');
      }

      form.classList.add('hidden');
      successPanel?.classList.remove('hidden');
      window.turnstile?.reset?.();
    } catch (error) {
      showStatus(error?.message || 'No se pudo enviar la respuesta. Intenta de nuevo.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Responder al llamado';
    }
  });

  shareButton?.addEventListener('click', async () => {
    const url = window.location.href;
    const title = document.title;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => {});
    showStatus('Enlace copiado para compartir.');
  });

  syncTrackingFields();
  selectMinistry(root.dataset.initialMinistry || 'mana', false);
}

document.addEventListener('astro:page-load', setupVenAyudanos);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupVenAyudanos, { once: true });
} else {
  setupVenAyudanos();
}
