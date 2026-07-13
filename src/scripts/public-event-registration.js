const registrationForm = document.getElementById('public-event-registration-form');
const registrationStatus = document.getElementById('event-registration-status');
const registrationTotal = document.getElementById('event-registration-total');
const paymentResult = document.getElementById('event-payment-result');

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_EVIDENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_PDF_BYTES = 2 * 1024 * 1024;
const EVIDENCE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

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
  const currency = String(registrationForm.dataset.currency || 'COP').toUpperCase();
  const quantity = Math.max(1, Number(registrationForm.elements.quantity?.value || 1));
  const amount = pricingModel === 'DONATION'
    ? Number(registrationForm.elements.donation_amount?.value || 0)
    : Number(registrationForm.dataset.unitPrice || 0) * quantity;
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
  const manualPaymentDetails = [...registrationForm.querySelectorAll('[data-manual-payment-details]')];

  function syncPaymentMethod() {
    const selectedOption = providerSelect?.selectedOptions?.[0];
    const selectedOptionId = String(selectedOption?.value || '');
    const kind = String(selectedOption?.dataset.kind || 'ONLINE').toUpperCase();
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
    if (providerSelect && submitButton && !submitButton.disabled) {
      submitButton.textContent = isManual ? 'Reportar pago para revisión' : 'Continuar al pago';
    }
  }

  registrationForm.addEventListener('input', updateRegistrationTotal);
  registrationForm.addEventListener('change', () => {
    updateRegistrationTotal();
    syncPaymentMethod();
  });
  updateRegistrationTotal();
  syncPaymentMethod();

  registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showRegistrationStatus();
    let customResponses;
    try {
      customResponses = readCustomResponses(registrationForm);
    } catch (error) {
      showRegistrationStatus(error?.message || 'Revisa las preguntas obligatorias.');
      return;
    }
    if (!registrationForm.checkValidity()) {
      registrationForm.reportValidity();
      return;
    }

    const formData = new FormData(registrationForm);
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
