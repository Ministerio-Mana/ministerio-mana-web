const modal = {
  root: document.getElementById('app-modal'),
  overlay: document.getElementById('app-modal-overlay'),
  close: document.getElementById('app-modal-close'),
  title: document.getElementById('app-modal-title'),
  message: document.getElementById('app-modal-message'),
  list: document.getElementById('app-modal-list'),
};

function showModal({ title = 'Aviso', message = '', items = [] } = {}) {
  if (!modal.root) return;
  if (modal.title) modal.title.textContent = title;
  if (modal.message) {
    modal.message.textContent = message || '';
    modal.message.classList.toggle('hidden', !message);
  }
  if (modal.list) {
    if (items?.length) {
      modal.list.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
      modal.list.classList.remove('hidden');
    } else {
      modal.list.innerHTML = '';
      modal.list.classList.add('hidden');
    }
  }
  modal.root.classList.remove('hidden');
  modal.root.classList.add('flex');
}

function hideModal() {
  if (!modal.root) return;
  modal.root.classList.add('hidden');
  modal.root.classList.remove('flex');
}

function attachModalEvents() {
  modal.close?.addEventListener('click', hideModal);
  modal.overlay?.addEventListener('click', hideModal);
}

function getLabelFromElement(el, form) {
  if (!el) return 'Campo';
  const ariaLabel = el.getAttribute?.('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const id = el.id;
  if (id && form) {
    try {
      const label = form.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.textContent.trim();
    } catch {
      const label = form.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent.trim();
    }
  }
  const parentLabel = el.closest?.('label');
  if (parentLabel) return parentLabel.textContent.trim();
  const placeholder = el.getAttribute?.('placeholder');
  if (placeholder) return placeholder.trim();
  const name = el.getAttribute?.('name');
  if (name) return name.replace(/[_-]+/g, ' ');
  return 'Campo';
}

function buildValidationMessage(el, form) {
  const label = getLabelFromElement(el, form);
  if (el.validity?.valueMissing) return `${label}: requerido.`;
  if (el.validity?.typeMismatch) return `${label}: formato inválido.`;
  if (el.validity?.patternMismatch) return `${label}: formato inválido.`;
  if (el.validity?.tooShort) return `${label}: demasiado corto.`;
  if (el.validity?.rangeOverflow || el.validity?.rangeUnderflow) return `${label}: fuera de rango.`;
  return `${label}: revisa este campo.`;
}

function handleFormValidation(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.skipValidation === 'true') return;
  if (form.checkValidity()) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const invalidFields = Array.from(form.querySelectorAll(':invalid')).filter((el) => {
    if (!el.willValidate) return false;
    if (el.disabled) return false;
    if (el.type === 'hidden') return false;
    return true;
  });

  invalidFields.forEach((el) => el.classList.add('input-error'));
  const messages = invalidFields.map((el) => buildValidationMessage(el, form));
  const unique = Array.from(new Set(messages));

  showModal({
    title: 'Faltan datos por completar',
    message: 'Revisa los campos marcados en rojo:',
    items: unique,
  });
}

function clearFieldError(event) {
  const target = event?.target;
  if (target?.classList?.contains('input-error')) {
    target.classList.remove('input-error');
  }
}

function setupGlobalValidation() {
  document.addEventListener('invalid', (event) => {
    event.preventDefault();
  }, true);

  document.addEventListener('submit', handleFormValidation, true);
  document.addEventListener('input', clearFieldError, true);
  document.addEventListener('change', clearFieldError, true);
}

function overrideAlert() {
  const nativeAlert = window.alert;
  window.__nativeAlert = nativeAlert;
  window.alert = (message) => {
    showModal({
      title: 'Aviso',
      message: message?.toString?.() || String(message ?? ''),
      items: [],
    });
  };
}

window.__appModal = {
  show: showModal,
  hide: hideModal,
};

attachModalEvents();
setupGlobalValidation();
overrideAlert();
