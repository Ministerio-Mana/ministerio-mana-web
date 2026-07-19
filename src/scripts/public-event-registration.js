const registrationForm = document.getElementById('public-event-registration-form');
const registrationStatus = document.getElementById('event-registration-status');
const registrationTotal = document.getElementById('event-registration-total');
const paymentResult = document.getElementById('event-payment-result');
const copyEventLink = document.querySelector('[data-copy-event-link]');
const copyEventFeedback = document.querySelector('[data-copy-event-feedback]');

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_EVIDENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_PDF_BYTES = 2 * 1024 * 1024;
const EVIDENCE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

copyEventLink?.addEventListener('click', async () => {
  const url = String(copyEventLink.dataset.copyEventLink || window.location.href);
  try {
    await navigator.clipboard.writeText(url);
    if (copyEventFeedback) {
      copyEventFeedback.textContent = 'Enlace copiado.';
      copyEventFeedback.classList.remove('hidden');
    }
  } catch {
    if (copyEventFeedback) {
      copyEventFeedback.textContent = 'No se pudo copiar. Usa la dirección del navegador.';
      copyEventFeedback.classList.remove('hidden');
      copyEventFeedback.classList.remove('text-emerald-700');
      copyEventFeedback.classList.add('text-red-700');
    }
  }
});

function createRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function showRegistrationStatus(message = '', tone = 'error') {
  if (!registrationStatus) return;
  registrationStatus.textContent = message;
  registrationStatus.classList.toggle('hidden', !message);
  registrationStatus.classList.toggle('border', Boolean(message));
  registrationStatus.classList.toggle('border-red-200', Boolean(message) && tone === 'error');
  registrationStatus.classList.toggle('bg-red-50', Boolean(message) && tone === 'error');
  registrationStatus.classList.toggle('text-red-700', Boolean(message) && tone === 'error');
  registrationStatus.classList.toggle('border-emerald-200', Boolean(message) && tone === 'success');
  registrationStatus.classList.toggle('bg-emerald-50', Boolean(message) && tone === 'success');
  registrationStatus.classList.toggle('text-emerald-800', Boolean(message) && tone === 'success');
}

function formatAmount(amount, currency) {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${Number(amount || 0).toLocaleString('es-CO')}`;
  }
}

function updateRegistrationTotal() {
  if (!registrationForm || !registrationTotal) return;
  const pricingModel = String(registrationForm.dataset.pricingModel || 'FREE').toUpperCase();
  const selectedOption = registrationForm.elements.provider?.selectedOptions?.[0];
  const currency = String(selectedOption?.dataset.currency || registrationForm.dataset.currency || 'COP').toUpperCase();
  const unitPrice = Number(selectedOption?.dataset.unitPrice ?? registrationForm.dataset.unitPrice ?? 0);
  const quantity = Math.max(1, Number(registrationForm.elements.quantity?.value || 1));
  const amount = pricingModel === 'DONATION'
    ? Number(registrationForm.elements.donation_amount?.value || 0)
    : unitPrice * quantity;
  registrationTotal.textContent = amount > 0 ? formatAmount(amount, currency) : '—';
}

function readCustomResponses(form) {
  const responses = {};
  const fields = [...form.querySelectorAll('[data-custom-field-id]')];
  for (const field of fields) {
    const id = String(field.dataset.customFieldId || '');
    const type = String(field.dataset.customFieldType || '').toUpperCase();
    const required = field.dataset.customFieldRequired === 'true';
    if (!id) continue;
    const controls = [...field.querySelectorAll('input, select, textarea')];
    let value = '';
    if (type === 'MULTIPLE_CHOICE') {
      value = controls.filter((control) => control.checked).map((control) => control.value);
    } else if (type === 'SINGLE_CHOICE') {
      value = controls.find((control) => control.checked)?.value || '';
    } else {
      value = String(controls[0]?.value || '').trim();
    }
    const isEmpty = Array.isArray(value) ? value.length === 0 : !value;
    if (required && isEmpty) {
      const label = field.querySelector('legend')?.textContent?.replace('*', '').trim() || 'esta pregunta';
      controls[0]?.focus();
      throw new Error(`Responde ${label}.`);
    }
    if (!isEmpty) responses[id] = value;
  }
  return responses;
}

const ATTENDEE_AGE_OPTIONS = [
  ['', 'Selecciona'],
  ['0_5', '0 a 5 años'],
  ['6_12', '6 a 12 años'],
  ['13_17', '13 a 17 años'],
  ['18_25', '18 a 25 años'],
  ['26_59', '26 a 59 años'],
  ['60_PLUS', '60 años o más'],
];
const ATTENDEE_GENDER_OPTIONS = [
  ['', 'Selecciona'],
  ['FEMALE', 'Mujer'],
  ['MALE', 'Hombre'],
  ['OTHER', 'Otro'],
  ['PREFER_NOT_TO_SAY', 'Prefiero no responder'],
];

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function optionMarkup(options, selected = '') {
  return options.map(([value, label]) => (
    `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
  )).join('');
}

function getAttendeeDrafts(container) {
  return [...(container?.querySelectorAll('[data-attendee-card]') || [])].map((card) => ({
    full_name: String(card.querySelector('[data-attendee-name]')?.value || '').trim(),
    age_group: String(card.querySelector('[data-attendee-age]')?.value || ''),
    gender: String(card.querySelector('[data-attendee-gender]')?.value || ''),
  }));
}

function readAttendees(form) {
  const cards = [...form.querySelectorAll('[data-attendee-card]')];
  const ageMode = String(form.dataset.attendeeAgeMode || 'HIDDEN').toUpperCase();
  const genderMode = String(form.dataset.attendeeGenderMode || 'HIDDEN').toUpperCase();
  return cards.map((card, index) => {
    const nameInput = card.querySelector('[data-attendee-name]');
    const ageInput = card.querySelector('[data-attendee-age]');
    const genderInput = card.querySelector('[data-attendee-gender]');
    const fullName = String(nameInput?.value || '').trim();
    const ageGroup = String(ageInput?.value || '').trim().toUpperCase();
    const gender = String(genderInput?.value || '').trim().toUpperCase();
    if (fullName.length < 3) {
      nameInput?.focus();
      throw new Error(`Escribe el nombre completo del asistente ${index + 1}.`);
    }
    if (ageMode === 'REQUIRED' && !ageGroup) {
      ageInput?.focus();
      throw new Error(`Selecciona la edad del asistente ${index + 1}.`);
    }
    if (genderMode === 'REQUIRED' && !gender) {
      genderInput?.focus();
      throw new Error(`Selecciona el género del asistente ${index + 1}.`);
    }
    return { position: index + 1, full_name: fullName, age_group: ageGroup || null, gender: gender || null };
  });
}

function readPayer(form, formData) {
  if (String(form.dataset.pricingModel || 'FREE').toUpperCase() === 'FREE') return null;
  const documentMode = String(form.dataset.payerDocumentMode || 'REQUIRED').toUpperCase();
  if (documentMode === 'HIDDEN') return null;
  return {
    is_contact: formData.get('payer_is_contact') === 'on',
    person_type: formData.get('payer_person_type'),
    document_type: formData.get('payer_document_type'),
    document_number: formData.get('payer_document_number'),
    document_country: formData.get('payer_document_country'),
    legal_name: formData.get('payer_legal_name'),
    billing_email: formData.get('payer_billing_email'),
    tax_document_requested: formData.get('payer_tax_document_requested') === 'on',
  };
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La solicitud tardó demasiado. Intenta nuevamente.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

if (registrationForm) {
  let registrationId = createRequestId();
  let idempotencyKey = createRequestId();
  let completed = false;
  const submitButton = registrationForm.querySelector('button[type="submit"]');
  const providerSelect = registrationForm.elements.provider;
  const manualReferenceWrapper = document.getElementById('event-manual-reference-wrapper');
  const manualReferenceInput = registrationForm.elements.manual_reference;
  const evidenceWrapper = document.getElementById('event-payment-evidence-wrapper');
  const evidenceInput = registrationForm.elements.payment_evidence;
  const donationAmountInput = registrationForm.elements.donation_amount;
  const manualPaymentDetails = [...registrationForm.querySelectorAll('[data-manual-payment-details]')];
  const quantityInput = registrationForm.elements.quantity;
  const contactNameInput = registrationForm.elements.contact_name;
  const contactEmailInput = registrationForm.elements.contact_email;
  const contactIsAttendeeInput = registrationForm.elements.contact_is_attendee;
  const attendeeFields = document.getElementById('event-attendee-fields');
  const payerIsContactInput = registrationForm.elements.payer_is_contact;
  const payerLegalNameInput = registrationForm.elements.payer_legal_name;
  const payerBillingEmailInput = registrationForm.elements.payer_billing_email;

  function syncContactAttendee() {
    const firstName = attendeeFields?.querySelector('[data-attendee-name]');
    if (!firstName) return;
    const samePerson = Boolean(contactIsAttendeeInput?.checked);
    firstName.readOnly = samePerson;
    firstName.classList.toggle('bg-slate-100', samePerson);
    if (samePerson) firstName.value = String(contactNameInput?.value || '');
  }

  function renderAttendees() {
    if (!attendeeFields || !quantityInput) return;
    const drafts = getAttendeeDrafts(attendeeFields);
    const max = Math.max(1, Number(quantityInput.max || 100));
    const quantity = Math.max(1, Math.min(max, Math.floor(Number(quantityInput.value || 1))));
    const ageMode = String(registrationForm.dataset.attendeeAgeMode || 'HIDDEN').toUpperCase();
    const genderMode = String(registrationForm.dataset.attendeeGenderMode || 'HIDDEN').toUpperCase();
    attendeeFields.innerHTML = Array.from({ length: quantity }, (_, index) => {
      const draft = drafts[index] || {};
      return `<article class="rounded-md border border-slate-200 bg-white p-4" data-attendee-card data-attendee-index="${index + 1}">
        <p class="text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Asistente ${index + 1}</p>
        <div class="mt-4 grid gap-4 ${ageMode !== 'HIDDEN' || genderMode !== 'HIDDEN' ? 'sm:grid-cols-2' : ''}">
          <label class="text-sm font-bold text-slate-700 ${ageMode !== 'HIDDEN' || genderMode !== 'HIDDEN' ? 'sm:col-span-2' : ''}">Nombre completo
            <input type="text" data-attendee-name required minlength="3" maxlength="120" autocomplete="name" value="${escapeAttribute(draft.full_name)}" class="mt-2 block min-h-11 w-full rounded-md border-slate-300" />
          </label>
          ${ageMode !== 'HIDDEN' ? `<label class="text-sm font-bold text-slate-700">Rango de edad ${ageMode === 'OPTIONAL' ? '<span class="font-normal text-slate-500">(opcional)</span>' : ''}<select data-attendee-age ${ageMode === 'REQUIRED' ? 'required' : ''} class="mt-2 block min-h-11 w-full rounded-md border-slate-300">${optionMarkup(ATTENDEE_AGE_OPTIONS, draft.age_group)}</select></label>` : ''}
          ${genderMode !== 'HIDDEN' ? `<label class="text-sm font-bold text-slate-700">Género ${genderMode === 'OPTIONAL' ? '<span class="font-normal text-slate-500">(opcional)</span>' : ''}<select data-attendee-gender ${genderMode === 'REQUIRED' ? 'required' : ''} class="mt-2 block min-h-11 w-full rounded-md border-slate-300">${optionMarkup(ATTENDEE_GENDER_OPTIONS, draft.gender)}</select></label>` : ''}
        </div>
      </article>`;
    }).join('');
    syncContactAttendee();
  }

  function syncPayerContact() {
    if (!payerIsContactInput) return;
    const samePerson = Boolean(payerIsContactInput.checked);
    if (payerLegalNameInput) {
      payerLegalNameInput.readOnly = samePerson;
      payerLegalNameInput.classList.toggle('bg-slate-100', samePerson);
      if (samePerson) payerLegalNameInput.value = String(contactNameInput?.value || '');
    }
    if (payerBillingEmailInput) {
      payerBillingEmailInput.readOnly = samePerson;
      payerBillingEmailInput.classList.toggle('bg-slate-100', samePerson);
      if (samePerson) payerBillingEmailInput.value = String(contactEmailInput?.value || '');
    }
  }

  function syncPaymentMethod() {
    const selectedOption = providerSelect?.selectedOptions?.[0];
    const selectedOptionId = String(selectedOption?.value || '');
    const kind = String(selectedOption?.dataset.kind || 'ONLINE').toUpperCase();
    const currency = String(selectedOption?.dataset.currency || registrationForm.dataset.currency || 'COP').toUpperCase();
    const isManual = Boolean(selectedOptionId && kind !== 'ONLINE');
    const requiresEvidence = isManual && selectedOption?.dataset.requiresEvidence === 'true';
    manualPaymentDetails.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.optionId !== selectedOptionId);
    });
    manualReferenceWrapper?.classList.toggle('hidden', !isManual);
    if (manualReferenceInput) {
      manualReferenceInput.disabled = !isManual;
      manualReferenceInput.required = isManual;
    }
    evidenceWrapper?.classList.toggle('hidden', !requiresEvidence);
    if (evidenceInput) {
      evidenceInput.disabled = !requiresEvidence;
      evidenceInput.required = requiresEvidence;
    }
    if (donationAmountInput) {
      donationAmountInput.step = currency === 'COP' ? '1000' : '1';
      donationAmountInput.placeholder = currency === 'COP' ? 'Ej. 50.000' : 'Ej. 25';
    }
    if (providerSelect && submitButton && !submitButton.disabled) {
      submitButton.textContent = isManual ? 'Reportar pago para revisión' : 'Continuar al pago';
    }
    updateRegistrationTotal();
  }

  registrationForm.addEventListener('input', (event) => {
    updateRegistrationTotal();
    if (event.target === quantityInput) renderAttendees();
    if (event.target === contactNameInput) syncContactAttendee();
    if (event.target === contactNameInput || event.target === contactEmailInput) syncPayerContact();
  });
  registrationForm.addEventListener('change', (event) => {
    if (event.target === quantityInput) renderAttendees();
    updateRegistrationTotal();
    syncPaymentMethod();
  });
  updateRegistrationTotal();
  syncPaymentMethod();
  renderAttendees();
  syncPayerContact();
  contactIsAttendeeInput?.addEventListener('change', syncContactAttendee);
  payerIsContactInput?.addEventListener('change', syncPayerContact);

  registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showRegistrationStatus();
    let customResponses;
    let attendees;
    try {
      customResponses = readCustomResponses(registrationForm);
      attendees = readAttendees(registrationForm);
    } catch (error) {
      showRegistrationStatus(error?.message || 'Revisa las preguntas obligatorias.');
      return;
    }
    if (!registrationForm.checkValidity()) {
      registrationForm.reportValidity();
      return;
    }

    const formData = new FormData(registrationForm);
    const payer = readPayer(registrationForm, formData);
    const selectedProviderOption = providerSelect?.selectedOptions?.[0];
    const evidenceFile = evidenceInput?.files?.[0] || null;
    if (evidenceFile) {
      const maxBytes = evidenceFile.type === 'application/pdf'
        ? MAX_EVIDENCE_PDF_BYTES
        : MAX_EVIDENCE_IMAGE_BYTES;
      if (!EVIDENCE_MIME_TYPES.has(evidenceFile.type) || evidenceFile.size <= 0 || evidenceFile.size > maxBytes) {
        showRegistrationStatus(
          evidenceFile.type === 'application/pdf'
            ? 'El comprobante PDF debe pesar máximo 2 MB.'
            : 'Usa una captura JPG, PNG o WebP de máximo 4 MB.',
          'error',
        );
        return;
      }
    }
    const originalText = submitButton?.textContent || '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Procesando...';
    }

    try {
      const { response, data } = await fetchJson('/api/events/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          event_id: registrationForm.dataset.eventId,
          registration_id: registrationId,
          idempotency_key: idempotencyKey,
          contact_name: formData.get('contact_name'),
          contact_email: formData.get('contact_email'),
          contact_phone: formData.get('contact_phone'),
          church: formData.get('church'),
          whatsapp_updates: formData.get('whatsapp_updates') === 'on',
          custom_responses: customResponses,
          attendees,
          payer,
          quantity: Number(formData.get('quantity') || 1),
          donation_amount: formData.get('donation_amount') || null,
          provider: selectedProviderOption?.dataset.provider || null,
          payment_option_id: formData.get('provider') || null,
          manual_reference: formData.get('manual_reference') || null,
          privacy_accepted: formData.get('privacy_accepted') === 'on',
          turnstile_token: formData.get('cf-turnstile-response') || '',
        }),
      });
      if (!response.ok || !data.ok) {
        if (data.retry_new_registration) {
          registrationId = createRequestId();
          idempotencyKey = createRequestId();
        }
        throw new Error(data.error || 'No se pudo completar la inscripción.');
      }

      if (data.checkout_url) {
        const checkout = new URL(data.checkout_url, window.location.origin);
        if (checkout.protocol !== 'https:') throw new Error('El proveedor devolvió un enlace inválido.');
        window.location.assign(checkout.toString());
        return;
      }

      if (data.requires_evidence) {
        if (!evidenceFile || !data.evidence_upload_token || !data.payment_id) {
          throw new Error('La inscripción quedó registrada, pero falta adjuntar el comprobante. Intenta enviarlo nuevamente.');
        }
        showRegistrationStatus('Guardando el comprobante de forma segura...', 'success');
        const evidencePayload = new FormData();
        evidencePayload.set('registration_id', data.registration_id);
        evidencePayload.set('payment_id', data.payment_id);
        evidencePayload.set('upload_token', data.evidence_upload_token);
        evidencePayload.set('file', evidenceFile, evidenceFile.name);
        const evidenceResult = await fetchJson('/api/events/payment-evidence', {
          method: 'POST',
          credentials: 'same-origin',
          body: evidencePayload,
        }, 45_000);
        if (!evidenceResult.response.ok || !evidenceResult.data.ok) {
          throw new Error(evidenceResult.data.error || 'La inscripción quedó registrada, pero el comprobante no pudo cargarse. Intenta nuevamente.');
        }
      }

      const underReview = data.status === 'UNDER_REVIEW' || data.requires_manual_review;
      showRegistrationStatus(
        data.requires_manual_review
          ? `${data.requires_evidence ? 'Comprobante recibido. ' : ''}Pago reportado con referencia ${data.reference}. El organizador verificará el movimiento antes de confirmar tu asistencia.`
          : underReview
          ? 'Recibimos tu inscripción. El equipo del evento la revisará.'
          : 'Inscripción confirmada. Tu lugar quedó reservado.',
        'success',
      );
      completed = true;
      if (submitButton) {
        submitButton.textContent = data.requires_manual_review ? 'Reporte enviado' : 'Inscripción completada';
      }
      registrationForm.querySelectorAll('input, select, textarea, button').forEach((field) => {
        field.disabled = true;
      });
    } catch (error) {
      showRegistrationStatus(error?.message || 'No se pudo completar la inscripción.');
      window.turnstile?.reset?.();
    } finally {
      if (submitButton && !completed) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
        syncPaymentMethod();
      }
    }
  });
}

async function refreshPaymentResult() {
  if (!paymentResult || paymentResult.dataset.paymentState === 'cancelled') return;
  const reference = new URLSearchParams(window.location.search).get('reference') || '';
  const eventId = paymentResult.dataset.eventId || '';
  if (!/^MM-EVT-[A-F0-9]{32}$/i.test(reference) || !eventId) return;
  const message = paymentResult.querySelector('[data-payment-result-message]');
  const heading = paymentResult.querySelector('h2');

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const params = new URLSearchParams({ event_id: eventId, reference });
      const { response, data } = await fetchJson(`/api/events/payment-status?${params}`);
      if (response.ok && data.ok) {
        const paymentStatus = String(data.payment_status || '').toUpperCase();
        const registrationStatusValue = String(data.registration_status || '').toUpperCase();
        if (paymentStatus === 'APPROVED') {
          if (heading) heading.textContent = registrationStatusValue === 'CONFIRMED' ? 'Pago e inscripción confirmados' : 'Pago recibido';
          if (message) {
            message.textContent = registrationStatusValue === 'CONFIRMED'
              ? 'Tu lugar quedó reservado correctamente.'
              : registrationStatusValue === 'UNDER_REVIEW'
                ? 'El pago está aprobado y la inscripción está pendiente de revisión.'
                : registrationStatusValue === 'EXPIRED'
                  ? 'El pago llegó después de vencer la reserva. El equipo del evento revisará tu caso.'
                  : 'El pago fue aprobado y estamos terminando la confirmación.';
          }
          return;
        }
        if (['DECLINED', 'FAILED', 'VOIDED'].includes(paymentStatus)) {
          if (heading) heading.textContent = 'Pago no aprobado';
          if (message) message.textContent = 'Puedes iniciar nuevamente la inscripción para volver a intentarlo.';
          return;
        }
      }
    } catch {
      // El siguiente intento puede recibir el webhook que aún está en tránsito.
    }
    if (attempt < 5) await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  if (message) message.textContent = 'El proveedor todavía está procesando el pago. Vuelve a consultar esta página en unos minutos.';
}

void refreshPaymentResult();
