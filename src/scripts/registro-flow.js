import flatpickr from 'flatpickr';
  import 'flatpickr/dist/flatpickr.min.css';

  let supabase = null;
  let calendarReady = false;

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
     draft: null,
     
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
           card.querySelector(`[name="p_${p.id}_docType"]`).value = prefill.documentType || p.document_type || 'CC';
           card.querySelector(`[name="p_${p.id}_docNumber"]`).value = prefill.documentNumber || p.document_number || '';
           card.querySelector(`[name="p_${p.id}_birthDate"]`).value = prefill.birthdate || p.birthdate || '';
           card.querySelector(`[name="p_${p.id}_gender"]`).value = prefill.gender || p.gender || '';
           card.querySelector(`[name="p_${p.id}_menuType"]`).value = prefill.dietType || p.diet_type || '';

           container.appendChild(clone);
        });

        this.initCalendars();
        
        // Form submit
        document.getElementById('details-form').addEventListener('submit', (e) => this.handleSubmit(e));
        this.attachAutosave();
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
            const res = await fetch('/api/auth/send-link', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: this.bookingEmail, kind: 'magiclink', redirectTo }),
            });
            const payload = await res.json();
            if (!res.ok || !payload?.ok) {
              throw new Error(payload?.error || 'No se pudo enviar el enlace.');
            }
            status.textContent = 'Enlace enviado. Revisa tu correo para activar tu cuenta.';
          } catch (err) {
            console.error(err);
            status.textContent = err?.message || 'No se pudo enviar el enlace.';
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
            participants.push({
              id: participantId,
              documentType: fd.get(`${prefix}docType`),
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
          const form = document.getElementById('details-form');
          const fd = new FormData(form);
          const participants = [];

          this.booking.participants.forEach((p) => {
            const participantId = p.id;
            if (!participantId) return;
            const prefix = `p_${participantId}_`;
            participants.push({
              id: participantId,
              documentType: fd.get(`${prefix}docType`),
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

  window.addEventListener('DOMContentLoaded', () => REGISTRO.init());

