import flatpickr from 'flatpickr';
  import 'flatpickr/dist/flatpickr.min.css';

  let supabase = null;
  let calendarReady = false;

  function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      window.turnstile.reset();
    }
  }

  function getTurnstileToken() {
    const widget = document.querySelector('.cf-turnstile');
    if (!widget) return { ok: true, token: '' };
    const token = window.turnstile?.getResponse?.() || '';
    if (!token) return { ok: false, error: 'Captcha requerido.' };
    return { ok: true, token };
  }

  async function getSupabase() {
    if (supabase) return supabase;
    try {
      const { getSupabaseBrowserClient } = await import('@lib/supabaseBrowser');
      supabase = getSupabaseBrowserClient();
    } catch (err) {
      console.warn('[registro] Supabase no disponible', err);
      supabase = null;
    }
    return supabase;
  }

  const REGISTRO = {
     booking: null,
     bookingEmail: '',
     countryGroup: 'CO',
     draft: null,
     modal: null,
     
     init() {
        const params = new URLSearchParams(window.location.search);
        this.bookingId = params.get('bookingId');
        this.token = params.get('token');
        this.isMock = params.get('mock') === 'true';

        if(!this.bookingId || !this.token) {
           this.showError();
           return;
        }

        this.fetchData();
     },

     async fetchData() {
        try {
           if(this.isMock) {
              // Simulate API delay
              await new Promise(r => setTimeout(r, 1000));
              this.booking = {
                 reference: 'MANA-2026-X99',
                 holder: 'Juan Pérez',
                 participants: [
                    { id: 1, name: 'Juan Pérez', type: 'lodging' },
                    { id: 2, name: 'María Gómez', type: 'lodging' },
                    { id: 3, name: 'Tomás Pérez', type: 'child_7_13' }
                 ]
              };
              this.countryGroup = 'CO';
           } else {
              // Real API call
              const res = await fetch(`/api/cumbre2026/booking/get?bookingId=${this.bookingId}&token=${this.token}`);
              if(!res.ok) throw new Error('Fetch failed');
              const payload = await res.json();
              if (!payload?.ok) throw new Error(payload?.error || 'Fetch failed');
              const booking = payload.booking || {};
              this.booking = {
                 reference: (booking.id || this.bookingId || '').toString().slice(0, 8).toUpperCase(),
                 holder: booking.contact_name || booking.contact_email || 'Participante',
                 participants: payload.participants || []
              };
              this.countryGroup = booking.country_group || 'CO';
              this.bookingEmail = (booking.contact_email || '').toString().trim().toLowerCase();
           }

           const allowed = await this.ensureAuth();
           if (!allowed) return;
           await this.fetchDraft();
           this.render();

        } catch(e) {
           console.error(e);
           this.showError();
        }
     },
     
  async ensureAuth() {
    if (this.isMock) return true;
    // El enlace con bookingId + token ya es suficiente para completar el registro,
    // incluso si la persona no tiene cuenta creada.
    if (this.bookingId && this.token) return true;
    const client = await getSupabase();
    if (!client) return true; // allow access with token when Supabase env is missing
    try {
      const { data } = await client.auth.getSession();
          if (data?.session) return true;
        } catch (err) {
          console.error(err);
        }
        this.showAuthRequired();
        return false;
     },
     
     async fetchDraft() {
        if (this.isMock) return;
        try {
          const res = await fetch(`/api/cumbre2026/registration/draft?bookingId=${this.bookingId}&token=${this.token}`);
          if (!res.ok) return;
          const payload = await res.json();
          if (payload?.ok) {
            this.draft = payload.draft || null;
          }
        } catch (err) {
          console.error(err);
        }
     },

     parseDocType(value) {
        if (!value) return { type: '', other: '' };
        const raw = value.toString().trim();
        const upper = raw.toUpperCase();
        if (upper.startsWith('OTRO:')) {
          return { type: 'OTHER', other: raw.slice(raw.indexOf(':') + 1).trim() };
        }
        return { type: raw, other: '' };
     },

     getAgeFromBirthdate(value) {
        if (!value) return null;
        const parts = value.toString().split('-').map(Number);
        if (parts.length < 3) return null;
        const [year, month, day] = parts;
        if (!year || !month || !day) return null;
        const today = new Date();
        const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const birth = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(birth.getTime())) return null;
        let age = now.getUTCFullYear() - birth.getUTCFullYear();
        const m = now.getUTCMonth() - birth.getUTCMonth();
        if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) {
          age -= 1;
        }
        return age;
     },

     isMinorParticipant(packageType, age) {
        if (packageType === 'child_0_7' || packageType === 'child_7_13') return true;
        if (typeof age === 'number') return age <= 17;
        return false;
     },

     getDocOptions(packageType, age) {
        const group = this.countryGroup || 'CO';
        const isMinor = this.isMinorParticipant(packageType, age);
        if (group === 'CO') {
          if (isMinor) {
            return [
              { value: 'RC', label: 'RC - Registro civil' },
              { value: 'TI', label: 'TI - Tarjeta de identidad' },
            ];
          }
          return [
            { value: 'CC', label: 'CC - Cédula de ciudadanía' },
            { value: 'CE', label: 'CE - Cédula de extranjería' },
            { value: 'PASSPORT', label: 'Pasaporte' },
          ];
        }
        return [
          { value: 'PASSPORT', label: 'Pasaporte' },
          { value: 'NATIONAL_ID', label: 'ID nacional' },
          { value: 'OTHER', label: 'Otro documento' },
        ];
     },

     getDocDefault(packageType, age) {
        const group = this.countryGroup || 'CO';
        if (group !== 'CO') return 'PASSPORT';
        if (typeof age === 'number') {
          if (age <= 6) return 'RC';
          if (age <= 17) return 'TI';
        }
        if (packageType === 'child_0_7') return 'RC';
        if (packageType === 'child_7_13') return 'TI';
        if (this.isMinorParticipant(packageType, age)) return 'TI';
        return 'CC';
     },

     normalizeMenuValue(value) {
        if (!value) return '';
        const raw = value.toString().trim();
        if (!raw) return '';
        const upper = raw.toUpperCase();
        if (upper === 'GENERAL' || upper === 'TRADICIONAL') return 'TRADICIONAL';
        if (upper === 'KIDS' || upper === 'INFANTIL') return 'INFANTIL';
        if (upper === 'VEGETARIAN' || upper === 'VEGETARIANO') return 'VEGETARIANO';
        if (upper === 'SIN ALIMENTACION' || upper === 'SIN_ALIMENTACION') return 'SIN ALIMENTACION';
        return raw;
     },

     fillDocOptions(select, options) {
        if (!select) return;
        select.innerHTML = options.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('');
     },

     toggleDocOther(card, show) {
        if (!card) return;
        const wrap = card.querySelector('.doc-other');
        if (wrap) {
          wrap.classList.toggle('hidden', !show);
        }
     },

     updateDocOptionsForCard(card, packageType) {
        if (!card) return;
        const birthInput = card.querySelector('input[name$="_birthDate"]');
        const birthdate = birthInput?.value || '';
        const age = this.getAgeFromBirthdate(birthdate);
        const select = card.querySelector('select[name$="_docType"]');
        const otherInput = card.querySelector('input[name$="_docOtherType"]');
        if (!select) return;
        const parsed = this.parseDocType(select.value);
        const options = this.getDocOptions(packageType, age);
        this.fillDocOptions(select, options);
        let nextValue = parsed.type;
        if (!options.some((opt) => opt.value === nextValue)) {
          nextValue = this.getDocDefault(packageType, age);
          if (!options.some((opt) => opt.value === nextValue)) {
            nextValue = options[0]?.value || '';
          }
        }
        select.value = nextValue;
        this.toggleDocOther(card, nextValue === 'OTHER');
        if (nextValue !== 'OTHER' && otherInput) {
          otherInput.value = '';
        }
     },

     composeDocType(docType, other) {
        if (docType === 'OTHER') {
          const detail = (other || '').toString().trim();
          return detail ? `OTRO:${detail}` : 'OTRO:';
        }
        return docType || '';
     },

     render() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');

        // Header
        document.getElementById('booking-ref').textContent = this.booking.reference || '—';
        document.getElementById('booking-holder').textContent = this.booking.holder || '—';

        const container = document.getElementById('participants-container');
        const tmpl = document.getElementById('participant-card-template');

        const draftMap = new Map();
        (this.draft?.participants || []).forEach((entry) => {
          if (entry?.id) {
            draftMap.set(entry.id, entry);
          }
        });

        this.booking.participants.forEach((p, idx) => {
           const clone = tmpl.content.cloneNode(true);
           const card = clone.querySelector('.participant-card');
           
           card.querySelector('.index-badge').textContent = idx + 1;
           card.querySelector('.name-display').textContent = p.full_name || p.name || 'Participante';
           card.querySelector('.type-display').textContent = this.formatType(p.package_type || p.type);
           const prefill = draftMap.get(p.id) || {};
           const packageType = p.package_type || p.type || '';
           
           // Toggle Logic
           const body = card.querySelector('.card-body');
           const arrow = card.querySelector('.arrow-icon');
           clone.querySelector('.toggle-btn').addEventListener('click', () => {
              body.classList.toggle('hidden');
              arrow.classList.toggle('rotate-180');
           });
           
           // Inputs naming (participantId as prefix/array)
           card.querySelectorAll('input, select, textarea').forEach(input => {
             input.name = `p_${p.id}_${input.name}`;
           });
           
           // Prefill values
           const rawDocType = prefill.documentType || p.document_type || '';
           const parsedDoc = this.parseDocType(rawDocType);
           const birthValue = prefill.birthdate || p.birthdate || '';
           const age = this.getAgeFromBirthdate(birthValue);
           const docTypeSelect = card.querySelector(`[name="p_${p.id}_docType"]`);
           const docNumberInput = card.querySelector(`[name="p_${p.id}_docNumber"]`);
           const docOtherInput = card.querySelector(`[name="p_${p.id}_docOtherType"]`);
           const birthInput = card.querySelector(`[name="p_${p.id}_birthDate"]`);
           const genderInput = card.querySelector(`[name="p_${p.id}_gender"]`);
           const menuInput = card.querySelector(`[name="p_${p.id}_menuType"]`);
           const docOptions = this.getDocOptions(packageType, age);

           this.fillDocOptions(docTypeSelect, docOptions);
           let docValue = parsedDoc.type || '';
           if (!docOptions.some((opt) => opt.value === docValue)) {
             docValue = this.getDocDefault(packageType, age);
             if (!docOptions.some((opt) => opt.value === docValue)) {
               docValue = docOptions[0]?.value || '';
             }
           }
           if (docTypeSelect) docTypeSelect.value = docValue;
           if (docOtherInput) docOtherInput.value = parsedDoc.other || '';
           this.toggleDocOther(card, docValue === 'OTHER');

           if (docNumberInput) docNumberInput.value = prefill.documentNumber || p.document_number || '';
           if (birthInput) birthInput.value = birthValue;
           if (genderInput) genderInput.value = prefill.gender || p.gender || '';
           if (menuInput) {
             menuInput.value = this.normalizeMenuValue(prefill.dietType || p.diet_type || '');
           }

           if (docTypeSelect) {
             docTypeSelect.addEventListener('change', (event) => {
               const value = event?.target?.value || '';
               this.toggleDocOther(card, value === 'OTHER');
               if (value !== 'OTHER' && docOtherInput) {
                 docOtherInput.value = '';
                 this.clearFieldError(docOtherInput);
               }
             });
           }

           if (birthInput) {
             birthInput.addEventListener('change', () => this.updateDocOptionsForCard(card, packageType));
             birthInput.addEventListener('input', () => this.updateDocOptionsForCard(card, packageType));
           }

           container.appendChild(clone);
        });

        this.initCalendars();
        this.initModal();
        this.attachErrorClear();
        
        // Form submit
        document.getElementById('details-form').addEventListener('submit', (e) => this.handleSubmit(e));
        this.attachAutosave();
     },

     initModal() {
        if (this.modal?.initialized) return;
        this.modal = {
          root: document.getElementById('registro-validation-modal'),
          list: document.getElementById('registro-validation-list'),
          close: document.getElementById('registro-validation-close'),
          overlay: document.getElementById('registro-validation-overlay'),
          initialized: true,
        };
        if (this.modal.close) {
          this.modal.close.addEventListener('click', () => this.hideValidationModal());
        }
        if (this.modal.overlay) {
          this.modal.overlay.addEventListener('click', () => this.hideValidationModal());
        }
     },

     showValidationModal(messages) {
        if (!this.modal?.root || !this.modal?.list) return;
        this.modal.list.innerHTML = messages.map((msg) => `<li>${msg}</li>`).join('');
        this.modal.root.classList.remove('hidden');
        this.modal.root.classList.add('flex');
     },

     hideValidationModal() {
        if (!this.modal?.root) return;
        this.modal.root.classList.add('hidden');
        this.modal.root.classList.remove('flex');
     },

     clearValidationErrors() {
        const form = document.getElementById('details-form');
        if (!form) return;
        form.querySelectorAll('.input-error').forEach((el) => {
          el.classList.remove('input-error');
        });
     },

     clearFieldError(el) {
        if (el?.classList?.contains('input-error')) {
          el.classList.remove('input-error');
        }
     },

     markFieldErrorByName(name) {
        const form = document.getElementById('details-form');
        if (!form) return;
        const fieldEl = form.querySelector(`[name="${name}"]`);
        if (fieldEl) {
          fieldEl.classList.add('input-error');
        }
     },

     attachErrorClear() {
        const form = document.getElementById('details-form');
        if (!form) return;
        form.querySelectorAll('input, select, textarea').forEach((el) => {
          el.addEventListener('input', () => this.clearFieldError(el));
          el.addEventListener('change', () => this.clearFieldError(el));
        });
     },

     validateForm() {
        this.clearValidationErrors();
        const form = document.getElementById('details-form');
        if (!form) return true;
        const fd = new FormData(form);
        const messages = [];

        this.booking.participants.forEach((p) => {
          const participantId = p.id;
          if (!participantId) return;
          const prefix = `p_${participantId}_`;
          const label = p.full_name || p.name || 'Participante';
          const packageType = p.package_type || p.type || '';
          const docType = (fd.get(`${prefix}docType`) || '').toString().trim();
          const docOther = (fd.get(`${prefix}docOtherType`) || '').toString().trim();
          const docNumber = (fd.get(`${prefix}docNumber`) || '').toString().trim();
          const birthdate = (fd.get(`${prefix}birthDate`) || '').toString().trim();
          const gender = (fd.get(`${prefix}gender`) || '').toString().trim();
          const menuType = (fd.get(`${prefix}menuType`) || '').toString().trim();

          const missing = [];
          if (!docType) missing.push('tipo de documento');
          if (docType === 'OTHER' && !docOther) missing.push('otro documento');
          if (!docNumber) missing.push('documento');
          if (!birthdate) missing.push('fecha de nacimiento');
          if (!gender) missing.push('género');
          const needsMenu = packageType === 'lodging' || packageType === 'no_lodging';
          if (needsMenu && !menuType) missing.push('menú');

          if (missing.length) {
            messages.push(`${label}: falta ${missing.join(', ')}.`);
            if (!docType) this.markFieldErrorByName(`${prefix}docType`);
            if (docType === 'OTHER' && !docOther) this.markFieldErrorByName(`${prefix}docOtherType`);
            if (!docNumber) this.markFieldErrorByName(`${prefix}docNumber`);
            if (!birthdate) this.markFieldErrorByName(`${prefix}birthDate`);
            if (!gender) this.markFieldErrorByName(`${prefix}gender`);
            if (needsMenu && !menuType) this.markFieldErrorByName(`${prefix}menuType`);
          }
        });

        if (messages.length) {
          this.showValidationModal(messages);
          return false;
        }
        return true;
     },

     initCalendars() {
        if (calendarReady) return;
        const inputs = document.querySelectorAll('.js-date');
        inputs.forEach((input) => {
          if (input.dataset.fpApplied) return;
          flatpickr(input, {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'd / m / Y',
            allowInput: true,
            maxDate: 'today',
            disableMobile: true,
          });
          input.dataset.fpApplied = 'true';
        });
        calendarReady = true;
     },

     formatType(type) {
        const labels = {
           lodging: 'Asistencia + alimentación + alojamiento',
           no_lodging: 'Asistencia + alimentación (sin alojamiento)',
           child_0_7: 'Niño 0-4',
           child_7_13: 'Niño 5-10'
        };
        return labels[type] || type;
     },

     showError() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('error-state').classList.remove('hidden');
     },

     showAuthRequired() {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('auth-state').classList.remove('hidden');
        const cta = document.getElementById('auth-cta');
        const status = document.getElementById('auth-status');
        cta?.addEventListener('click', async () => {
          if (!status) return;
          if (!this.bookingEmail) {
            status.textContent = 'No encontramos tu correo. Escríbenos por WhatsApp.'; 
            return;
          }
          status.textContent = 'Enviando enlace...';
          cta.setAttribute('disabled', 'disabled');
          cta.classList.add('opacity-70');
          try {
            const redirectTo = `${window.location.origin}/portal/activar?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            const captcha = getTurnstileToken();
            if (!captcha.ok) {
              status.textContent = captcha.error || 'Captcha requerido.';
              resetTurnstile();
              return;
            }
            const res = await fetch('/api/auth/send-link', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                email: this.bookingEmail,
                kind: 'magiclink',
                redirectTo,
                turnstileToken: captcha.token,
              }),
            });
            const payload = await res.json();
            if (!res.ok || !payload?.ok) {
              throw new Error(payload?.error || 'No se pudo enviar el enlace.');
            }
            status.textContent = 'Enlace enviado. Revisa tu correo para activar tu cuenta.';
          } catch (err) {
            console.error(err);
            status.textContent = err?.message || 'No se pudo enviar el enlace.';
            resetTurnstile();
          } finally {
            cta.removeAttribute('disabled');
            cta.classList.remove('opacity-70');
          }
        });
     },

     attachAutosave() {
        const form = document.getElementById('details-form');
        if (!form || this.isMock) return;
        let timer = null;
        const handler = () => {
          clearTimeout(timer);
          timer = setTimeout(() => this.saveDraft(), 900);
        };
        form.querySelectorAll('input, select, textarea').forEach((el) => {
          el.addEventListener('input', handler);
          el.addEventListener('change', handler);
        });
     },

     async saveDraft() {
        try {
          const form = document.getElementById('details-form');
          const fd = new FormData(form);
          const participants = [];

          this.booking.participants.forEach((p) => {
            const participantId = p.id;
            if (!participantId) return;
            const prefix = `p_${participantId}_`;
            const docType = fd.get(`${prefix}docType`);
            const docOther = fd.get(`${prefix}docOtherType`);
            participants.push({
              id: participantId,
              documentType: this.composeDocType(docType, docOther),
              documentNumber: fd.get(`${prefix}docNumber`),
              birthdate: fd.get(`${prefix}birthDate`),
              gender: fd.get(`${prefix}gender`),
              dietType: fd.get(`${prefix}menuType`),
            });
          });

          await fetch('/api/cumbre2026/registration/draft', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({
              bookingId: this.bookingId,
              token: this.token,
              participants,
            }),
          });
        } catch (err) {
          console.error(err);
        }
     },
     
     async handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-save');
        btn.textContent = 'Guardando...';
        btn.disabled = true;

        try {
          if (!this.validateForm()) {
            btn.textContent = 'Guardar y Finalizar';
            btn.disabled = false;
            return;
          }
          const form = document.getElementById('details-form');
          const fd = new FormData(form);
          const participants = [];

          this.booking.participants.forEach((p) => {
            const participantId = p.id;
            if (!participantId) return;
            const prefix = `p_${participantId}_`;
            const docType = fd.get(`${prefix}docType`);
            const docOther = fd.get(`${prefix}docOtherType`);
            participants.push({
              id: participantId,
              documentType: this.composeDocType(docType, docOther),
              documentNumber: fd.get(`${prefix}docNumber`),
              birthdate: fd.get(`${prefix}birthDate`),
              gender: fd.get(`${prefix}gender`),
              dietType: fd.get(`${prefix}menuType`),
            });
          });

          const res = await fetch('/api/cumbre2026/registration/submit', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({
              bookingId: this.bookingId,
              token: this.token,
              participants,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || 'No se pudo guardar el registro');
          }

          // Clear draft on success
          await fetch('/api/cumbre2026/registration/draft', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bookingId: this.bookingId, token: this.token, participants: [] }),
          });

          window.location.href = `/eventos/cumbre-mundial-2026/estado?bookingId=${this.bookingId}&token=${this.token}`;
        } catch (err) {
          console.error(err);
          alert(err?.message || 'No se pudo guardar. Intenta nuevamente.');
          btn.textContent = 'Guardar y Finalizar';
          btn.disabled = false;
          return;
      }
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => REGISTRO.init());
  } else {
    REGISTRO.init();
  }
