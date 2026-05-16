
const AMOUNT_CONFIG = {
    COP: {
        symbol: '$',
        code: 'COP',
        min: 5000,
        context: 'Monto en pesos colombianos (COP)',
        placeholder: '50.000',
        minLabel: 'Mínimo $5.000 COP',
        options: [
            { label: '$50.000', value: 50000 },
            { label: '$100.000', value: 100000 },
            { label: '$200.000', value: 200000 },
        ],
        format: (v) => '$' + v.toLocaleString('es-CO'),
        provider: 'Wompi'
    },
    USD: {
        symbol: '$',
        code: 'USD',
        min: 5,
        context: 'Monto en dólares (USD)',
        placeholder: '25',
        minLabel: 'Mínimo $5 USD',
        options: [
            { label: '$25 USD', value: 25 },
            { label: '$50 USD', value: 50 },
            { label: '$100 USD', value: 100 },
        ],
        format: (v) => '$' + v + ' USD',
        provider: 'Stripe'
    }
};

function getSupabaseAccessToken() {
    try {
        const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
        if (!key) return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const session = JSON.parse(raw);
        return session?.access_token || null;
    } catch (err) {
        return null;
    }
}

function getReturnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildPortalUrl(path) {
    return `${path}?next=${encodeURIComponent(getReturnPath())}`;
}

function setValueIfEmpty(el, value) {
    if (!el || !value || el.value) return;
    el.value = value;
}

class MultiDonationFlow {
    constructor(container) {
        this.el = container;
        this.missionaries = JSON.parse(container.dataset.missionaries || '[]');
        this.initialSlug = container.dataset.initialMissionary || '';
        this.initialName = container.dataset.initialMissionaryName || '';
        this.hasInitial = this.initialSlug && this.missionaries.some((m) => m.slug === this.initialSlug);
        // Auto-detect currency from server-side geolocation
        const country = (container.dataset.country || 'CO').toUpperCase();
        const defaultCurrency = country === 'CO' ? 'COP' : 'USD';
        this.state = {
            step: 1,
            count: 0,
            selected: this.baseSelection(),
            currency: defaultCurrency,
            frequency: 'monthly',
            amount: 0,
        };
        this.isSubmitting = false;
        this.accessToken = getSupabaseAccessToken();
        this.portalProfile = null;
        this.init();
        // Sync the select element with auto-detected currency
        const currSelect = this.el.querySelector('#multi-currency');
        if (currSelect) currSelect.value = defaultCurrency;
    }

    baseSelection() {
        return this.hasInitial ? [this.initialSlug] : [];
    }

    selectedTargetLabel() {
        const total = this.state.count || 0;
        const selected = this.state.selected.length;
        return total > 0 ? `${selected}/${total}` : '0/0';
    }

    syncChipState() {
        this.el.querySelectorAll('.missionary-chip').forEach(chip => {
            const slug = chip.dataset.slug;
            const selected = this.state.selected.includes(slug);
            const locked = this.hasInitial && slug === this.initialSlug;
            chip.classList.toggle('selected', selected);
            chip.classList.toggle('locked', locked);
            chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
            if (locked) {
                chip.setAttribute('aria-disabled', 'true');
            } else {
                chip.removeAttribute('aria-disabled');
            }
        });
    }

    init() {
        this.bindStep1();
        this.bindStep2();
        this.bindStep3();
        this.bindStep4();
        this.bindBackButtons();
        this.configureAccountLinks();
        this.loadPortalProfile();
    }

    // === NAVIGATION ===

    goToStep(n) {
        const steps = this.el.querySelectorAll('.flow-step');
        steps.forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        const target = this.el.querySelector(`[data-step="${n}"]`);
        if (target) {
            target.classList.remove('hidden');
            requestAnimationFrame(() => target.classList.add('active'));
        }
        this.state.step = n;
        this.el.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    bindBackButtons() {
        this.el.querySelectorAll('.back-btn').forEach(btn => {
            btn.addEventListener('click', () => this.goToStep(this.state.step - 1));
        });
    }

    // === STEP 1: Choose count ===

    bindStep1() {
        this.el.querySelectorAll('.count-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.count = parseInt(btn.dataset.count);
                this.state.selected = this.baseSelection();

                if (this.state.count === this.missionaries.length) {
                    this.state.selected = this.missionaries.map(m => m.slug);
                    this.syncChipState();
                    this.goToStep(3);
                    this.renderAmounts();
                } else {
                    this.syncChipState();
                    this.updateStep2UI();
                    this.goToStep(2);
                }
            });
        });
    }

    // === STEP 2: Select missionaries ===

    bindStep2() {
        this.el.querySelectorAll('.missionary-chip').forEach(chip => {
            chip.addEventListener('click', () => this.toggleChip(chip));
        });

        const randomBtn = this.el.querySelector('#random-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => this.selectRandom());
        }

        const confirmBtn = this.el.querySelector('#confirm-selection-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (this.state.selected.length === this.state.count) {
                    this.goToStep(3);
                    this.renderAmounts();
                }
            });
        }
    }

    toggleChip(chip) {
        const slug = chip.dataset.slug;
        if (this.hasInitial && slug === this.initialSlug) return;
        const idx = this.state.selected.indexOf(slug);

        if (idx >= 0) {
            this.state.selected.splice(idx, 1);
        } else if (this.state.selected.length < this.state.count) {
            this.state.selected.push(slug);
        }
        this.syncChipState();
        this.updateStep2UI();
    }

    selectRandom() {
        this.state.selected = this.baseSelection();

        const needed = Math.max(0, this.state.count - this.state.selected.length);
        const shuffled = [...this.missionaries]
            .filter(m => !this.state.selected.includes(m.slug))
            .sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, needed);
        this.state.selected = [...this.state.selected, ...picked.map(m => m.slug)];

        this.syncChipState();
        this.updateStep2UI();
    }

    updateStep2UI() {
        const countDisplay = this.el.querySelector('.selected-count');
        if (countDisplay) countDisplay.textContent = this.selectedTargetLabel();

        const confirmBtn = this.el.querySelector('#confirm-selection-btn');
        if (confirmBtn) {
            const ready = this.state.selected.length === this.state.count;
            confirmBtn.classList.toggle('opacity-50', !ready);
            confirmBtn.classList.toggle('pointer-events-none', !ready);
        }
    }

    // === STEP 3: Amount ===

    bindStep3() {
        const currSelect = this.el.querySelector('#multi-currency');
        if (currSelect) {
            currSelect.addEventListener('change', (e) => {
                this.state.currency = e.target.value;
                this.state.amount = 0;
                const customInput = this.el.querySelector('#multi-custom-amount');
                if (customInput) customInput.value = '';
                this.renderAmounts();
                this.updateSummary();
                this.updateStep4AuthState();
            });
        }

        this.el.querySelectorAll('.multi-freq-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.frequency = btn.dataset.freq;
                this.el.querySelectorAll('.multi-freq-btn').forEach(b => {
                    const isSel = b === btn;
                    b.style.backgroundColor = isSel ? '#001B3A' : 'transparent';
                    b.style.color = isSel ? '#fff' : 'rgba(255,255,255,0.5)';
                });
                this.updateStep4AuthState();
            });
        });

        const customInput = this.el.querySelector('#multi-custom-amount');
        if (customInput) {
            customInput.addEventListener('input', (e) => {
                this.state.amount = this.parseAmountInput(e.target.value);
                if (this.state.currency === 'COP') {
                    e.target.value = this.state.amount > 0 ? this.state.amount.toLocaleString('es-CO') : '';
                }
                this.highlightAmountBtn(null);
                this.updateSummary();
                this.updateStep3Confirm();
            });
        }

        const confirmBtn = this.el.querySelector('#confirm-amount-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const config = AMOUNT_CONFIG[this.state.currency];
                if (this.state.amount >= config.min) {
                    this.renderStep4();
                    this.goToStep(4);
                }
            });
        }
    }

    renderAmounts() {
        const config = AMOUNT_CONFIG[this.state.currency];
        const grid = this.el.querySelector('#multi-amounts-grid');
        if (!grid) return;
        grid.innerHTML = '';

        config.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'btn-scribble py-3 px-2 text-sm font-intro text-white bg-transparent transition-all multi-amount-btn';
            btn.textContent = opt.label;
            btn.type = 'button';
            btn.dataset.value = opt.value;

            btn.addEventListener('click', () => {
                this.state.amount = opt.value;
                const customInput = this.el.querySelector('#multi-custom-amount');
                if (customInput) customInput.value = '';
                this.highlightAmountBtn(btn);
                this.updateSummary();
                this.updateStep3Confirm();
            });

            grid.appendChild(btn);
        });

        const sym = this.el.querySelector('.multi-currency-symbol');
        if (sym) sym.textContent = config.symbol;
        const code = this.el.querySelector('#multi-currency-code');
        if (code) code.textContent = config.code;
        const context = this.el.querySelector('#multi-currency-context');
        if (context) context.textContent = config.context;
        const minLabel = this.el.querySelector('#multi-amount-min-label');
        if (minLabel) minLabel.textContent = config.minLabel;
        const customInput = this.el.querySelector('#multi-custom-amount');
        if (customInput) {
            customInput.placeholder = config.placeholder;
            customInput.inputMode = this.state.currency === 'COP' ? 'numeric' : 'decimal';
        }
    }

    parseAmountInput(raw) {
        const value = String(raw || '').trim();
        if (!value) return 0;

        if (this.state.currency === 'COP') {
            const digits = value.replace(/[^\d]/g, '');
            const amount = Number(digits);
            return Number.isFinite(amount) ? amount : 0;
        }

        let normalized = value.replace(/[^0-9.,]/g, '');
        if (normalized.includes(',') && !normalized.includes('.')) {
            normalized = normalized.replace(',', '.');
        } else {
            normalized = normalized.replace(/,/g, '');
        }
        const amount = Number(normalized);
        return Number.isFinite(amount) ? amount : 0;
    }

    highlightAmountBtn(selectedBtn) {
        this.el.querySelectorAll('.multi-amount-btn').forEach(btn => {
            if (btn === selectedBtn) {
                btn.style.backgroundColor = '#001B3A';
                btn.style.color = '#fff';
            } else {
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#fff';
            }
        });
    }

    updateSummary() {
        const summary = this.el.querySelector('#multi-summary');
        if (!summary) return;

        const config = AMOUNT_CONFIG[this.state.currency];
        const count = this.state.selected.length;
        const amount = this.state.amount;
        const total = amount * count;

        if (amount > 0) {
            summary.classList.remove('hidden');
            this.el.querySelector('#summary-amount').textContent = config.format(amount);
            this.el.querySelector('#summary-count').textContent = count;
            this.el.querySelector('#summary-total').textContent = config.format(total);
        } else {
            summary.classList.add('hidden');
        }
    }

    updateStep3Confirm() {
        const confirmBtn = this.el.querySelector('#confirm-amount-btn');
        if (confirmBtn) {
            const config = AMOUNT_CONFIG[this.state.currency];
            const ready = this.state.amount >= config.min;
            confirmBtn.classList.toggle('opacity-50', !ready);
            confirmBtn.classList.toggle('pointer-events-none', !ready);
        }
    }

    // === STEP 4: Confirm, collect donor info & Pay ===

    bindStep4() {
        const payBtn = this.el.querySelector('#pay-btn');
        if (payBtn) {
            payBtn.addEventListener('click', () => this.handlePayment());
        }
    }

    configureAccountLinks() {
        const login = this.el.querySelector('#multi-login-link');
        const register = this.el.querySelector('#multi-register-link');
        if (login) login.href = buildPortalUrl('/portal/ingresar');
        if (register) register.href = buildPortalUrl('/portal/registro');
    }

    async loadPortalProfile() {
        if (!this.accessToken) return;
        try {
            const res = await fetch('/api/portal/session', {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                credentials: 'include',
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok || !payload?.ok) return;
            this.portalProfile = payload.profile || null;
            this.prefillFromProfile(this.portalProfile);
        } catch (err) {
            console.warn('[multi-donation] No se pudo precargar el perfil');
        }
    }

    prefillFromProfile(profile) {
        if (!profile) return;
        setValueIfEmpty(this.el.querySelector('#donor-name'), profile.full_name);
        setValueIfEmpty(this.el.querySelector('#donor-email'), profile.email);
        setValueIfEmpty(this.el.querySelector('#donor-phone'), profile.phone);
        setValueIfEmpty(this.el.querySelector('#donor-city'), profile.city);
        const docType = this.el.querySelector('#donor-document-type');
        if (docType && !docType.value && profile.document_type) {
            docType.value = profile.document_type;
        }
        setValueIfEmpty(this.el.querySelector('#donor-document-number'), profile.document_number);
    }

    updateStep4AuthState() {
        const accountGate = this.el.querySelector('#multi-account-gate');
        const donorFields = this.el.querySelectorAll('.multi-donor-field');
        const payBtn = this.el.querySelector('#pay-btn');
        const documentFields = this.el.querySelector('#multi-document-fields');
        const docType = this.el.querySelector('#donor-document-type');
        const docNumber = this.el.querySelector('#donor-document-number');
        const accountRequired = this.state.frequency === 'monthly' && !this.accessToken;
        const documentRequired = this.state.currency === 'COP';

        accountGate?.classList.toggle('hidden', !accountRequired);
        donorFields.forEach((field) => field.classList.toggle('hidden', accountRequired));
        payBtn?.classList.toggle('is-hidden', accountRequired);
        documentFields?.classList.toggle('hidden', accountRequired || !documentRequired);
        if (docType) docType.required = documentRequired && !accountRequired;
        if (docNumber) docNumber.required = documentRequired && !accountRequired;
    }

    renderStep4() {
        const container = this.el.querySelector('#payment-summary');
        if (!container) return;

        const config = AMOUNT_CONFIG[this.state.currency];
        const amount = this.state.amount;
        const total = amount * this.state.selected.length;

        container.innerHTML = this.state.selected.map(slug => {
            const m = this.missionaries.find(x => x.slug === slug);
            if (!m) return '';
            const photo = m.foto
                ? `<img src="${m.foto}" alt="${m.nombre}" class="w-full h-full object-cover">`
                : `<span class="text-white font-intro text-sm">${m.nombre.charAt(0)}</span>`;
            const lockedLabel = this.hasInitial && slug === this.initialSlug
                ? '<span class="ml-2 rounded-full bg-[#FACC15] px-2 py-1 text-[8px] font-intro uppercase tracking-widest text-[#001B3A]">QR</span>'
                : '';
            return `
                <div class="flex items-center justify-between bg-[#001B3A]/20 rounded-xl p-4 mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-2xl border-2 border-[#001B3A] bg-[#001B3A] overflow-hidden flex items-center justify-center">
                            ${photo}
                        </div>
                        <span class="font-intro text-white text-base uppercase">${m.nombre}${lockedLabel}</span>
                    </div>
                    <span class="font-intro text-[#001B3A] text-lg">${config.format(amount)}</span>
                </div>
            `;
        }).join('');

        // Grand total
        const grandTotal = this.el.querySelector('#grand-total');
        if (grandTotal) {
            grandTotal.textContent = `Total: ${config.format(total)}`;
        }

        // Frequency label
        const freqLabel = this.el.querySelector('#freq-label');
        if (freqLabel) {
            freqLabel.textContent = this.state.frequency === 'monthly'
                ? 'Pago mensual recurrente'
                : 'Pago único';
        }

        // Provider label
        const providerLabel = this.el.querySelector('#provider-label');
        if (providerLabel) {
            providerLabel.textContent = config.provider;
        }

        // Hide error
        this.hideError();
        this.prefillFromProfile(this.portalProfile);
        this.updateStep4AuthState();
    }

    showError(message) {
        const errorEl = this.el.querySelector('#checkout-error');
        if (errorEl) {
            errorEl.classList.remove('hidden');
            errorEl.querySelector('p').textContent = message;
        }
    }

    hideError() {
        const errorEl = this.el.querySelector('#checkout-error');
        if (errorEl) errorEl.classList.add('hidden');
    }

    async handlePayment() {
        if (this.isSubmitting) return;
        this.hideError();

        // Validate donor info
        const fullName = this.el.querySelector('#donor-name')?.value?.trim();
        const email = this.el.querySelector('#donor-email')?.value?.trim();
        const phone = this.el.querySelector('#donor-phone')?.value?.trim() || '';
        const city = this.el.querySelector('#donor-city')?.value?.trim() || '';
        const documentType = this.el.querySelector('#donor-document-type')?.value?.trim() || '';
        const documentNumber = this.el.querySelector('#donor-document-number')?.value?.trim() || '';
        const config = AMOUNT_CONFIG[this.state.currency];

        if (this.state.amount < config.min) {
            this.showError(`El monto mínimo es ${config.format(config.min)}`);
            return;
        }

        if (!fullName) {
            this.showError('Por favor ingresa tu nombre completo');
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showError('Por favor ingresa un correo válido');
            return;
        }
        if (this.state.currency === 'COP') {
            if (!documentType) {
                this.showError('Selecciona el tipo de identificación');
                return;
            }
            if (!documentNumber) {
                this.showError('Ingresa el número de identificación');
                return;
            }
        }
        if (this.state.frequency === 'monthly' && !this.accessToken) {
            this.updateStep4AuthState();
            this.showError('Para una siembra mensual necesitas iniciar sesión o crear una cuenta.');
            return;
        }

        // Disable button
        this.isSubmitting = true;
        const payBtn = this.el.querySelector('#pay-btn');
        const payLabel = payBtn?.querySelector('span');
        const originalText = payLabel?.textContent || 'SEMBRAR AHORA';
        if (payBtn) {
            if (payLabel) payLabel.textContent = 'PROCESANDO...';
            payBtn.classList.add('opacity-50', 'pointer-events-none');
        }

        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            };
            if (this.accessToken) {
                headers.Authorization = `Bearer ${this.accessToken}`;
            }
            const response = await fetch('/api/campus/checkout', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    missionaries: this.state.selected,
                    amount: this.state.amount,
                    currency: this.state.currency,
                    frequency: this.state.frequency,
                    fullName,
                    email,
                    phone,
                    city,
                    documentType,
                    documentNumber,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                if (data.requiresAccount) {
                    this.updateStep4AuthState();
                }
                this.showError(data.error || 'Error procesando el pago. Intenta de nuevo.');
                return;
            }

            // Redirect to checkout
            if (data.url) {
                window.location.href = data.url;
            } else {
                this.showError('No se pudo generar el link de pago');
            }

        } catch (error) {
            console.error('[multi-donation] checkout error', error);
            this.showError('Error de conexión. Intenta de nuevo.');
        } finally {
            this.isSubmitting = false;
            if (payBtn) {
                if (payLabel) payLabel.textContent = originalText;
                payBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    }
}

// Initialize
function initMultiDonation() {
    const el = document.getElementById('multi-donation-flow');
    if (el && !el._multiDonationInit) {
        el._multiDonationInit = true;
        new MultiDonationFlow(el);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMultiDonation);
} else {
    initMultiDonation();
}
document.addEventListener('astro:page-load', initMultiDonation);
