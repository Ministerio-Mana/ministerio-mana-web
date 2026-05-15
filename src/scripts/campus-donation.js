
const CONFIG = {
    COP: {
        symbol: '$',
        min: 10000,
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
        min: 10,
        options: [
            { label: '$25 USD', value: 25 },
            { label: '$50 USD', value: 50 },
            { label: '$100 USD', value: 100 },
        ],
        format: (v) => '$' + v + ' USD',
        provider: 'Stripe'
    }
};

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

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.renderAmounts();
        // Select middle option by default
        const middleBtn = this.dom.amountsGrid.children[1];
        if (middleBtn) middleBtn.click();
        // Sync currency select with geo default
        if (this.dom.currencySelect) this.dom.currencySelect.value = this.currency;
        this.updateUI();
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
            providerName: this.el.querySelectorAll('.provider-name'),
            donorSection: this.el.querySelector('.donor-info-section'),
            donorName: this.el.querySelector('.donor-name-input'),
            donorEmail: this.el.querySelector('.donor-email-input'),
            donorPhone: this.el.querySelector('.donor-phone-input'),
            errorContainer: this.el.querySelector('.donation-error'),
        };
    }

    bindEvents() {
        // Frequency Toggle
        this.dom.freqBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.frequency = btn.dataset.freq;
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
        });

        // Custom Amount Input
        this.dom.customInput.addEventListener('input', (e) => {
            this.amount = Number(e.target.value);
            this.highlightAmount(null);
            this.updateUI();
        });

        // CTA Click
        this.dom.cta.addEventListener('click', () => this.handleCTAClick());
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
            });

            this.dom.amountsGrid.appendChild(btn);
        });
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

        // Update CTA state
        const hasAmount = this.amount > 0;
        if (this.donorInfoVisible) {
            // CTA is in "submit" mode — always enabled
            this.dom.cta.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            this.dom.cta.classList.toggle('opacity-50', !hasAmount);
            this.dom.cta.classList.toggle('pointer-events-none', !hasAmount);
        }
    }

    handleCTAClick() {
        if (!this.donorInfoVisible) {
            // First click: show donor info section
            if (this.amount <= 0) return;
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

        this.isSubmitting = true;
        const originalText = this.dom.ctaText.textContent;
        this.dom.ctaText.textContent = 'Procesando...';
        this.dom.cta.classList.add('opacity-50', 'pointer-events-none');

        try {
            const response = await fetch('/api/campus/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    missionaries: [this.slug],
                    amount: this.amount,
                    currency: this.currency,
                    frequency: this.frequency,
                    fullName,
                    email,
                    phone,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
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
