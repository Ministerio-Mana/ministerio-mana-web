
const AMOUNT_CONFIG = {
    COP: {
        symbol: '$',
        min: 10000,
        options: [
            { label: '$50.000', value: 50000 },
            { label: '$100.000', value: 100000 },
            { label: '$200.000', value: 200000 },
        ],
        format: (v) => '$' + v.toLocaleString('es-CO')
    },
    USD: {
        symbol: '$',
        min: 10,
        options: [
            { label: '$25 USD', value: 25 },
            { label: '$50 USD', value: 50 },
            { label: '$100 USD', value: 100 },
        ],
        format: (v) => '$' + v + ' USD'
    }
};

class MultiDonationFlow {
    constructor(container) {
        this.el = container;
        this.missionaries = JSON.parse(container.dataset.missionaries || '[]');
        this.state = {
            step: 1,
            count: 0,
            selected: [],     // array of slugs
            currency: 'COP',
            frequency: 'monthly',
            amount: 0,
        };
        this.init();
    }

    init() {
        this.bindStep1();
        this.bindStep2();
        this.bindStep3();
        this.bindStep4();
        this.bindBackButtons();
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
            // Trigger animation
            requestAnimationFrame(() => target.classList.add('active'));
        }
        this.state.step = n;

        // Scroll to section
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
                this.state.selected = [];

                if (this.state.count === this.missionaries.length) {
                    // "Todos" — select all, skip step 2
                    this.state.selected = this.missionaries.map(m => m.slug);
                    this.goToStep(3);
                    this.renderAmounts();
                } else {
                    // Go to selection
                    this.updateStep2UI();
                    this.goToStep(2);
                }
            });
        });
    }

    // === STEP 2: Select missionaries ===

    bindStep2() {
        // Chips
        this.el.querySelectorAll('.missionary-chip').forEach(chip => {
            chip.addEventListener('click', () => this.toggleChip(chip));
        });

        // Random
        const randomBtn = this.el.querySelector('#random-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => this.selectRandom());
        }

        // Confirm
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
        const idx = this.state.selected.indexOf(slug);

        if (idx >= 0) {
            // Deselect
            this.state.selected.splice(idx, 1);
            chip.classList.remove('selected');
        } else if (this.state.selected.length < this.state.count) {
            // Select
            this.state.selected.push(slug);
            chip.classList.add('selected');
        }
        this.updateStep2UI();
    }

    selectRandom() {
        // Clear
        this.state.selected = [];
        this.el.querySelectorAll('.missionary-chip').forEach(c => c.classList.remove('selected'));

        // Shuffle and pick N
        const shuffled = [...this.missionaries].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, this.state.count);
        this.state.selected = picked.map(m => m.slug);

        // Update UI
        this.el.querySelectorAll('.missionary-chip').forEach(chip => {
            if (this.state.selected.includes(chip.dataset.slug)) {
                chip.classList.add('selected');
            }
        });
        this.updateStep2UI();
    }

    updateStep2UI() {
        // Update count display
        const countDisplay = this.el.querySelector('.selected-count');
        if (countDisplay) countDisplay.textContent = this.state.count;

        // Enable/disable confirm button
        const confirmBtn = this.el.querySelector('#confirm-selection-btn');
        if (confirmBtn) {
            const ready = this.state.selected.length === this.state.count;
            confirmBtn.classList.toggle('opacity-50', !ready);
            confirmBtn.classList.toggle('pointer-events-none', !ready);
        }
    }

    // === STEP 3: Amount ===

    bindStep3() {
        // Currency
        const currSelect = this.el.querySelector('#multi-currency');
        if (currSelect) {
            currSelect.addEventListener('change', (e) => {
                this.state.currency = e.target.value;
                this.state.amount = 0;
                const customInput = this.el.querySelector('#multi-custom-amount');
                if (customInput) customInput.value = '';
                this.renderAmounts();
                this.updateSummary();
            });
        }

        // Frequency
        this.el.querySelectorAll('.multi-freq-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.frequency = btn.dataset.freq;
                this.el.querySelectorAll('.multi-freq-btn').forEach(b => {
                    const isSel = b === btn;
                    b.style.backgroundColor = isSel ? '#001B3A' : 'transparent';
                    b.style.color = isSel ? '#fff' : 'rgba(255,255,255,0.5)';
                });
            });
        });

        // Custom input
        const customInput = this.el.querySelector('#multi-custom-amount');
        if (customInput) {
            customInput.addEventListener('input', (e) => {
                this.state.amount = Number(e.target.value);
                this.highlightAmountBtn(null);
                this.updateSummary();
                this.updateStep3Confirm();
            });
        }

        // Confirm
        const confirmBtn = this.el.querySelector('#confirm-amount-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (this.state.amount > 0) {
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

        // Update symbol
        const sym = this.el.querySelector('.multi-currency-symbol');
        if (sym) sym.textContent = config.symbol;
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
            const ready = this.state.amount > 0;
            confirmBtn.classList.toggle('opacity-50', !ready);
            confirmBtn.classList.toggle('pointer-events-none', !ready);
        }
    }

    // === STEP 4: Confirm & Pay ===

    bindStep4() {
        const payBtn = this.el.querySelector('#pay-btn');
        if (payBtn) {
            payBtn.addEventListener('click', () => this.handlePayment());
        }
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
            return `
                <div class="flex items-center justify-between bg-[#001B3A]/20 rounded-xl p-4 mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-[#001B3A] flex items-center justify-center text-white font-intro text-sm">
                            ${m.nombre.charAt(0)}
                        </div>
                        <span class="font-intro text-white text-base uppercase">${m.nombre}</span>
                    </div>
                    <span class="font-intro text-[#001B3A] text-lg">${config.format(amount)}</span>
                </div>
            `;
        }).join('');

        // Update grand total
        const grandTotal = this.el.querySelector('#grand-total');
        if (grandTotal) {
            const freqLabel = this.state.frequency === 'monthly' ? '/mes' : ' (única vez)';
            grandTotal.textContent = `Total: ${config.format(total)}${freqLabel}`;
        }
    }

    handlePayment() {
        // Open payment links for each selected missionary
        const config = AMOUNT_CONFIG[this.state.currency];
        const amount = this.state.amount;

        this.state.selected.forEach((slug, i) => {
            const m = this.missionaries.find(x => x.slug === slug);
            if (!m) return;

            let url = '#';
            if (this.state.currency === 'COP') {
                url = m.wompiLink || '#';
            } else {
                url = `/donaciones/stripe?amount=${amount}&currency=${this.state.currency}&freq=${this.state.frequency}&slug=${m.slug}`;
            }

            // Stagger openings to avoid popup blockers
            setTimeout(() => {
                if (url !== '#') {
                    window.open(url, '_blank');
                }
            }, i * 500);
        });
    }
}

// Initialize
function initMultiDonation() {
    const el = document.getElementById('multi-donation-flow');
    if (el) new MultiDonationFlow(el);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMultiDonation);
} else {
    initMultiDonation();
}
document.addEventListener('astro:page-load', initMultiDonation);
