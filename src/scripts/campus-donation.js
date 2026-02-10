
const CONFIG = {
    COP: {
        symbol: '$',
        min: 10000,
        options: [
            { label: '$50.000', value: 50000 },
            { label: '$100.000', value: 100000 },
            { label: '$200.000', value: 200000 },
        ]
    },
    USD: {
        symbol: '$',
        min: 10,
        options: [
            { label: '$25 USD', value: 25 },
            { label: '$50 USD', value: 50 },
            { label: '$100 USD', value: 100 },
        ]
    }
};

class DonationWidget {
    constructor(element) {
        this.el = element;
        this.currency = 'COP';
        this.frequency = 'monthly';
        this.amount = 0;
        this.wompiBase = this.el.dataset.wompi;
        this.stripePriceId = this.el.dataset.stripe;
        this.slug = this.el.dataset.slug;

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.renderAmounts();
        // Select middle option by default
        const middleBtn = this.dom.amountsGrid.children[1];
        if (middleBtn) middleBtn.click();
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
            providerName: this.el.querySelectorAll('.provider-name'), // logic change: multiple provider names now?
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

        // Currency Change
        this.dom.currencySelect.addEventListener('change', (e) => {
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
    }

    renderAmounts() {
        const config = CONFIG[this.currency];
        this.dom.amountsGrid.innerHTML = '';

        config.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'py-3 px-1 text-sm font-black rounded-sm border-2 border-[#001B3A] bg-white text-[#001B3A] hover:bg-yellow-50 hover:translate-x-[1px] hover:translate-y-[1px] transition-all amount-btn shadow-[2px_2px_0px_0px_transparent]';
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
                btn.classList.add('bg-brand-teal', 'shadow-[2px_2px_0px_0px_#001B3A]', '-translate-y-[2px]', '-translate-x-[2px]');
                btn.classList.remove('bg-white', 'hover:bg-yellow-50', 'shadow-[2px_2px_0px_0px_transparent]');
            } else {
                btn.classList.remove('bg-brand-teal', 'shadow-[2px_2px_0px_0px_#001B3A]', '-translate-y-[2px]', '-translate-x-[2px]');
                btn.classList.add('bg-white', 'hover:bg-yellow-50', 'shadow-[2px_2px_0px_0px_transparent]');
            }
        });
    }

    updateUI() {
        // Update Frequency Buttons
        this.dom.freqBtns.forEach(btn => {
            const isSelected = btn.dataset.freq === this.frequency;
            if (isSelected) {
                btn.className = 'freq-btn flex-1 py-3 text-sm font-black uppercase rounded-sm border-2 border-[#001B3A] transition-all text-[#001B3A] bg-brand-teal shadow-[2px_2px_0px_0px_#001B3A] transform -translate-y-[1px]';
            } else {
                btn.className = 'freq-btn flex-1 py-3 text-sm font-black uppercase rounded-sm border-2 border-[#001B3A] transition-all text-gray-500 bg-transparent hover:text-[#001B3A] hover:bg-white';
            }
        });

        // Update Provider & Symbol
        if (this.currency === 'COP') {
            this.dom.providerName.forEach(el => el.textContent = 'Wompi');
            if (this.dom.currencySymbol) this.dom.currencySymbol.textContent = '$';
        } else {
            this.dom.providerName.forEach(el => el.textContent = 'Stripe');
            if (this.dom.currencySymbol) this.dom.currencySymbol.textContent = '$';
        }

        this.updateLink();
    }

    updateLink() {
        const amount = this.amount;

        // Disable if no amount
        if (!amount || amount <= 0) {
            this.dom.cta.href = '#';
            this.dom.cta.classList.add('opacity-50', 'pointer-events-none');
            return;
        }

        this.dom.cta.classList.remove('opacity-50', 'pointer-events-none');

        // Generate specific links
        if (this.currency === 'COP') {
            // Ideally: this.dom.cta.href = this.wompiBase;
            // For now, simple fallback
            this.dom.cta.href = this.wompiBase || '#';

        } else {
            // Stripe Dynamic Link
            // Ensure we have an endpoint that can generate checkout sessions or redirect
            const baseUrl = '/donaciones/stripe';
            this.dom.cta.href = `${baseUrl}?amount=${amount}&currency=${this.currency}&freq=${this.frequency}&slug=${this.slug}`;
        }
    }
}

// Initialize
document.addEventListener('astro:page-load', () => {
    const widgets = document.querySelectorAll('.donation-widget');
    widgets.forEach(el => new DonationWidget(el));
});

document.addEventListener('DOMContentLoaded', () => {
    const widgets = document.querySelectorAll('.donation-widget');
    widgets.forEach(el => new DonationWidget(el));
});
