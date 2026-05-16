const CONFIG = {
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

class DonationWidget {
    constructor(element) {
        this.el = element;
        this.slug = this.el.dataset.slug;
        this.missionaryName = this.el.dataset.missionaryName || '';
        // Auto-detect currency from geolocation
        const country = (this.el.dataset.country || 'CO').toUpperCase();
        this.currency = country === 'CO' ? 'COP' : 'USD';
        this.frequency = 'monthly';
        this.amount = 0;
        this.isSubmitting = false;
        this.donorInfoVisible = false;
        this.accessToken = getSupabaseAccessToken();
        this.portalProfile = null;

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.renderAmounts();
        // Sync currency select with geo default
        if (this.dom.currencySelect) this.dom.currencySelect.value = this.currency;
        this.configureAccountLinks();
        this.loadPortalProfile();
        this.updateUI();
        this.publishAmountChange();
    }

    cacheElements() {
        this.dom = {
            freqBtns: this.el.querySelectorAll('.freq-btn'),
            currencySelect: this.el.querySelector('.currency-select'),
            amountsGrid: this.el.querySelector('.amounts-grid'),
            customInput: this.el.querySelector('.custom-amount-input'),
            cta: this.el.querySelector('.donate-cta'),
            ctaText: this.el.querySelector('.cta-text'),
            currencySymbol: this.el.querySelector('.currency-symbol'),
            currencyCode: this.el.querySelector('.currency-code'),
            currencyContext: this.el.querySelector('.currency-context'),
            amountMinLabel: this.el.querySelector('.amount-min-label'),
            providerName: this.el.querySelectorAll('.provider-name'),
            donorSection: this.el.querySelector('.donor-info-section'),
            donorName: this.el.querySelector('.donor-name-input'),
            donorEmail: this.el.querySelector('.donor-email-input'),
            donorPhone: this.el.querySelector('.donor-phone-input'),
            donorCity: this.el.querySelector('.donor-city-input'),
            donorDocumentType: this.el.querySelector('.donor-document-type-input'),
            donorDocumentNumber: this.el.querySelector('.donor-document-number-input'),
            documentFields: this.el.querySelector('.campus-document-fields'),
            accountGate: this.el.querySelector('.monthly-account-gate'),
            accountLoginLink: this.el.querySelector('.account-login-link'),
            accountRegisterLink: this.el.querySelector('.account-register-link'),
            errorContainer: this.el.querySelector('.donation-error'),
        };
    }

    bindEvents() {
        // Frequency Toggle
        this.dom.freqBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.frequency = btn.dataset.freq;
                if (this.frequency !== 'monthly') this.hideAccountGate();
                this.updateUI();
            });
        });

        // Optional currency selector kept for backwards compatibility.
        // Current Campus flow auto-detects currency from country and does not render this control.
        this.dom.currencySelect?.addEventListener('change', (e) => {
            this.currency = e.target.value;
            this.amount = 0;
            this.dom.customInput.value = '';
            this.renderAmounts();
            this.updateUI();
            this.publishAmountChange();
        });

        // Custom Amount Input
        this.dom.customInput.addEventListener('input', (e) => {
            this.amount = this.parseAmountInput(e.target.value);
            if (this.currency === 'COP') {
                e.target.value = this.amount > 0 ? this.amount.toLocaleString('es-CO') : '';
            }
            this.highlightAmount(null);
            this.updateUI();
            this.publishAmountChange();
        });

        // CTA Click
        this.dom.cta.addEventListener('click', () => this.handleCTAClick());
    }

    configureAccountLinks() {
        if (this.dom.accountLoginLink) this.dom.accountLoginLink.href = buildPortalUrl('/portal/ingresar');
        if (this.dom.accountRegisterLink) this.dom.accountRegisterLink.href = buildPortalUrl('/portal/registro');
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
            console.warn('[donation-widget] No se pudo precargar el perfil');
        }
    }

    prefillFromProfile(profile) {
        if (!profile) return;
        setValueIfEmpty(this.dom.donorName, profile.full_name);
        setValueIfEmpty(this.dom.donorEmail, profile.email);
        setValueIfEmpty(this.dom.donorPhone, profile.phone);
        setValueIfEmpty(this.dom.donorCity, profile.city);
        if (this.dom.donorDocumentType && !this.dom.donorDocumentType.value && profile.document_type) {
            this.dom.donorDocumentType.value = profile.document_type;
        }
        setValueIfEmpty(this.dom.donorDocumentNumber, profile.document_number);
    }

    renderAmounts() {
        const config = CONFIG[this.currency];
        this.dom.amountsGrid.innerHTML = '';

        config.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'btn-scribble py-2 px-1 text-sm font-intro text-[#001B3A] bg-transparent transition-all amount-btn';
            btn.textContent = opt.label;
            btn.type = 'button';
            btn.dataset.value = opt.value;

            btn.addEventListener('click', () => {
                this.amount = opt.value;
                this.dom.customInput.value = '';
                this.highlightAmount(btn);
                this.updateUI();
                this.publishAmountChange();
            });

            this.dom.amountsGrid.appendChild(btn);
        });
    }

    parseAmountInput(raw) {
        const value = String(raw || '').trim();
        if (!value) return 0;

        if (this.currency === 'COP') {
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

    highlightAmount(selectedBtn) {
        const all = this.dom.amountsGrid.querySelectorAll('.amount-btn');
        all.forEach(btn => {
            if (btn === selectedBtn) {
                btn.style.backgroundColor = '#001B3A';
                btn.style.color = '#fff';
            } else {
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#001B3A';
            }
        });
    }

    publishAmountChange() {
        this.el.dataset.currentAmount = this.amount > 0 ? String(this.amount) : '';
        this.el.dataset.currentCurrency = this.currency;
        window.dispatchEvent(new CustomEvent('campus:donation-amount-change', {
            detail: {
                slug: this.slug,
                amount: this.amount,
                currency: this.currency,
            },
        }));
    }

    updateUI() {
        // Update Frequency Buttons with scribble style
        this.dom.freqBtns.forEach(btn => {
            const isSelected = btn.dataset.freq === this.frequency;
            if (isSelected) {
                btn.style.backgroundColor = '#2DD4BF';
                btn.style.color = '#fff';
            } else {
                btn.style.backgroundColor = 'transparent';
                btn.style.color = '#9CA3AF';
            }
        });

        // Update Provider & Symbol
        const config = CONFIG[this.currency];
        this.dom.providerName.forEach(el => el.textContent = config.provider);
        if (this.dom.currencySymbol) this.dom.currencySymbol.textContent = config.symbol;
        if (this.dom.currencyCode) this.dom.currencyCode.textContent = config.code;
        if (this.dom.currencyContext) this.dom.currencyContext.textContent = config.context;
        if (this.dom.amountMinLabel) this.dom.amountMinLabel.textContent = config.minLabel;
        if (this.dom.customInput) {
            this.dom.customInput.placeholder = config.placeholder;
            this.dom.customInput.inputMode = this.currency === 'COP' ? 'numeric' : 'decimal';
        }
        this.updateDocumentFields();

        // Update CTA state
        const hasAmount = this.amount >= config.min;
        if (this.donorInfoVisible) {
            // CTA is in "submit" mode — always enabled
            this.dom.cta.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            this.dom.cta.classList.toggle('opacity-50', !hasAmount);
            this.dom.cta.classList.toggle('pointer-events-none', !hasAmount);
        }
    }

    updateDocumentFields() {
        const requiresDocument = this.currency === 'COP';
        this.dom.documentFields?.classList.toggle('hidden', !requiresDocument);
        if (this.dom.donorDocumentType) this.dom.donorDocumentType.required = requiresDocument;
        if (this.dom.donorDocumentNumber) this.dom.donorDocumentNumber.required = requiresDocument;
    }

    showAccountGate() {
        this.dom.accountGate?.classList.remove('hidden');
        this.dom.donorSection?.classList.add('hidden');
        this.dom.cta?.classList.add('is-hidden');
        this.donorInfoVisible = false;
        if (this.dom.ctaText) this.dom.ctaText.textContent = 'Donar Ahora';
        this.updateUI();
    }

    hideAccountGate() {
        this.dom.accountGate?.classList.add('hidden');
        this.dom.cta?.classList.remove('is-hidden');
    }

    handleCTAClick() {
        const config = CONFIG[this.currency];
        if (!this.donorInfoVisible) {
            // First click: show donor info section
            if (this.amount < config.min) return;
            if (this.frequency === 'monthly' && !this.accessToken) {
                this.showAccountGate();
                return;
            }
            this.hideAccountGate();
            this.donorInfoVisible = true;
            this.dom.donorSection.classList.remove('hidden');
            this.dom.ctaText.textContent = 'Sembrar Ahora';
            this.dom.donorName?.focus();
            this.updateUI();
        } else {
            // Second click: validate & submit
            this.handleCheckout();
        }
    }

    showError(msg) {
        const el = this.dom.errorContainer;
        if (el) {
            el.classList.remove('hidden');
            el.querySelector('p').textContent = msg;
        }
    }

    hideError() {
        const el = this.dom.errorContainer;
        if (el) el.classList.add('hidden');
    }

    async handleCheckout() {
        if (this.isSubmitting) return;
        this.hideError();

        const fullName = this.dom.donorName?.value?.trim();
        const email = this.dom.donorEmail?.value?.trim();
        const phone = this.dom.donorPhone?.value?.trim() || '';
        const city = this.dom.donorCity?.value?.trim() || '';
        const documentType = this.dom.donorDocumentType?.value?.trim() || '';
        const documentNumber = this.dom.donorDocumentNumber?.value?.trim() || '';
        const config = CONFIG[this.currency];

        if (this.amount < config.min) {
            this.showError(`El monto mínimo es ${config.format(config.min)}`);
            return;
        }

        if (!fullName) {
            this.showError('Ingresa tu nombre completo');
            this.dom.donorName?.focus();
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showError('Ingresa un correo válido');
            this.dom.donorEmail?.focus();
            return;
        }
        if (this.currency === 'COP') {
            if (!documentType) {
                this.showError('Selecciona el tipo de identificación');
                this.dom.donorDocumentType?.focus();
                return;
            }
            if (!documentNumber) {
                this.showError('Ingresa el número de identificación');
                this.dom.donorDocumentNumber?.focus();
                return;
            }
        }
        if (this.frequency === 'monthly' && !this.accessToken) {
            this.showAccountGate();
            return;
        }

        this.isSubmitting = true;
        const originalText = this.dom.ctaText.textContent;
        this.dom.ctaText.textContent = 'Procesando...';
        this.dom.cta.classList.add('opacity-50', 'pointer-events-none');

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
                    missionaries: [this.slug],
                    amount: this.amount,
                    currency: this.currency,
                    frequency: this.frequency,
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
                    this.showAccountGate();
                }
                this.showError(data.error || 'Error procesando el pago');
                return;
            }

            if (data.url) {
                window.location.href = data.url;
            } else {
                this.showError('No se pudo generar el link de pago');
            }
        } catch (err) {
            console.error('[donation-widget] checkout error', err);
            this.showError('Error de conexión. Intenta de nuevo.');
        } finally {
            this.isSubmitting = false;
            this.dom.ctaText.textContent = originalText;
            this.dom.cta.classList.remove('opacity-50', 'pointer-events-none');
        }
    }
}

// Initialize
function initDonationWidgets() {
    const widgets = document.querySelectorAll('.donation-widget');
    widgets.forEach(el => {
        if (!el._donationInit) {
            el._donationInit = true;
            new DonationWidget(el);
        }
    });
}

document.addEventListener('DOMContentLoaded', initDonationWidgets);
document.addEventListener('astro:page-load', initDonationWidgets);
