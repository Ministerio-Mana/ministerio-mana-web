const modal = {
  root: document.getElementById('app-modal'),
  overlay: document.getElementById('app-modal-overlay'),
  close: document.getElementById('app-modal-close'),
  title: document.getElementById('app-modal-title'),
  message: document.getElementById('app-modal-message'),
  list: document.getElementById('app-modal-list'),
};
let modalReturnFocus = null;

function getModalFocusableElements() {
  if (!modal.root) return [];
  return Array.from(modal.root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
}

function showModal({ title = 'Aviso', message = '', items = [] } = {}) {
  if (!modal.root) return;
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (modal.title) modal.title.textContent = title;
  if (modal.message) {
    modal.message.textContent = message || '';
    modal.message.classList.toggle('hidden', !message);
  }
  if (modal.list) {
    modal.list.replaceChildren();
    if (items?.length) {
      items.forEach((item) => {
        const listItem = document.createElement('li');
        listItem.textContent = String(item ?? '');
        modal.list.appendChild(listItem);
      });
      modal.list.classList.remove('hidden');
    } else {
      modal.list.classList.add('hidden');
    }
  }
  modal.root.setAttribute('aria-hidden', 'false');
  modal.root.classList.remove('hidden');
  modal.root.classList.add('flex');
  queueMicrotask(() => modal.close?.focus());
}

function hideModal() {
  if (!modal.root) return;
  modal.root.setAttribute('aria-hidden', 'true');
  modal.root.classList.add('hidden');
  modal.root.classList.remove('flex');
  modalReturnFocus?.focus();
  modalReturnFocus = null;
}

function attachModalEvents() {
  modal.close?.addEventListener('click', hideModal);
  modal.overlay?.addEventListener('click', hideModal);
  document.addEventListener('keydown', (event) => {
    if (!modal.root || modal.root.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hideModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getModalFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
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

function getInvalidFields(form) {
  return Array.from(form.querySelectorAll(':invalid')).filter((el) => {
    if (!el.willValidate) return false;
    if (el.disabled) return false;
    if (el.type === 'hidden') return false;
    return true;
  });
}

function presentFormValidation(form) {
  const invalidFields = getInvalidFields(form);
  if (invalidFields.length === 0) return;

  invalidFields.forEach((el) => {
    el.classList.add('input-error');
    el.setAttribute('aria-invalid', 'true');
  });
  const messages = invalidFields.map((el) => buildValidationMessage(el, form));
  const unique = Array.from(new Set(messages));

  showModal({
    title: 'Faltan datos por completar',
    message: 'Revisa los campos marcados en rojo:',
    items: unique,
  });
}

function handleFormValidation(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.skipValidation === 'true') return;
  if (form.checkValidity()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  presentFormValidation(form);
}

function clearFieldError(event) {
  const target = event?.target;
  if (target?.classList?.contains('input-error')) {
    target.classList.remove('input-error');
    target.removeAttribute('aria-invalid');
  }
}

function setupGlobalValidation() {
  const scheduledForms = new WeakSet();
  document.addEventListener('invalid', (event) => {
    event.preventDefault();
    const field = event.target;
    const form = field?.form;
    if (!(form instanceof HTMLFormElement) || form.dataset.skipValidation === 'true') return;
    if (scheduledForms.has(form)) return;
    scheduledForms.add(form);
    queueMicrotask(() => {
      scheduledForms.delete(form);
      presentFormValidation(form);
    });
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
