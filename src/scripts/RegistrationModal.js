// Registration Modal Logic - Cumbre-style with Group Support
export class RegistrationModal {
    constructor() {
        this.participants = [];
        this.selectedChurch = null;
        this.currency = 'COP'; // Default to Colombia
        this.currencyOverride = false;
        this.leaderId = 'leader';
        this.leaderDraft = null;
        this.paymentAmountTouched = false;
        this.lastInstallmentAmount = 0;
        this.lastInstallmentCount = 0;
        this.paymentOptionBackup = null;
        this.idempotencyKey = null;
        this.lastSubmissionSignature = null;
        this.editingCompanionId = null;
        this.isEditMode = false;
        this.editBookingId = null;
        this.editPaymentId = null;
        this.canEditPayment = true;
        this.canDeleteBooking = false;
        this.paymentSummary = null;
        this.manualPayments = [];
        this.defaultModalTitle = 'Registrar Participante';
        this.defaultModalSubtitle = 'Nueva Inscripción';
        this.defaultSubmitLabel = 'Registrar Grupo';

        // Pricing structure (from Cumbre)
        this.prices = {
            COP: {
                lodging: 850000,
                no_lodging: 660000,
                child_0_7: 300000,
                child_7_13: 550000
            },
            USD: {
                lodging: 220,
                no_lodging: 170,
                child_0_7: 80,
                child_7_13: 140
            }
        };

        this.init();
    }

    init() {
        this.cacheDOM();
        if (this.modalTitle?.textContent) this.defaultModalTitle = this.modalTitle.textContent;
        if (this.modalSubtitle?.textContent) this.defaultModalSubtitle = this.modalSubtitle.textContent;
        if (this.submitBtn?.textContent) this.defaultSubmitLabel = this.submitBtn.textContent;
        this.bindEvents();
        this.updateLeaderParticipant();
        if (this.countryInput) {
            this.updateCurrencyFromCountry(this.countryInput.value);
        }

        // Set initial menu states
        this.updateMenuOptions(this.leaderMenu, null);
        this.updateMenuOptions(this.companionMenu, null);

        if (this.paymentCustomToggle?.checked) {
            this.handleCustomPaymentToggle();
        }
    }

    cacheDOM() {
        this.modal = document.getElementById('manual-registration-modal');
        this.form = document.getElementById('manual-registration-form');
        this.closeBtn = document.getElementById('btn-close-manual-modal');
        this.cancelBtn = document.getElementById('btn-cancel-manual-reg');
        this.modalTitle = document.getElementById('manual-modal-title');
        this.modalSubtitle = document.getElementById('manual-modal-subtitle');
        this.submitBtn = document.getElementById('btn-submit-manual-reg');

        // Leader fields
        this.leaderName = document.getElementById('reg-leader-name');
        this.leaderAge = document.getElementById('reg-leader-age');
        this.leaderPackage = document.getElementById('reg-leader-package');
        this.leaderMenu = document.getElementById('reg-leader-menu');
        this.leaderBirthdate = document.getElementById('reg-leader-birthdate');
        this.leaderGender = document.getElementById('reg-leader-gender');

        // Companion form
        this.btnAddCompanion = document.getElementById('btn-add-companion');
        this.addCompanionForm = document.getElementById('add-companion-form');

        // Companion fields
        this.companionDocType = document.getElementById('companion-doc-type');
        this.companionDocNumber = document.getElementById('companion-doc-number');
        this.companionName = document.getElementById('companion-name');
        this.companionEmail = document.getElementById('companion-email');
        this.companionAge = document.getElementById('companion-age');
        this.companionPackage = document.getElementById('companion-package');
        this.companionMenu = document.getElementById('companion-menu');
        this.companionBirthdate = document.getElementById('companion-birthdate');
        this.companionGender = document.getElementById('companion-gender');
        this.companionPackageContainer = document.getElementById('companion-package-container');
        this.companionFormTitle = document.getElementById('companion-form-title');

        this.btnSaveCompanion = document.getElementById('btn-save-companion');
        this.btnCancelCompanion = document.getElementById('btn-cancel-companion');

        // Lists
        this.companionsList = document.getElementById('companions-list');
        this.companionsEmpty = document.getElementById('companions-empty');
        this.summaryList = document.getElementById('summary-list');

        // Summary
        this.summarySubtotal = document.getElementById('summary-subtotal');
        this.summaryTotal = document.getElementById('summary-total');

        // Payment
        this.paymentOptions = document.querySelectorAll('input[name="payment_option"]');
        this.paymentOptionsContainer = document.getElementById('payment-options-container');
        this.installmentDetails = document.getElementById('installment-details');
        this.depositAmountLabel = document.getElementById('deposit-amount-label');
        this.installmentFrequencyInputs = document.querySelectorAll('input[name="installment_frequency"]');
        this.installmentCount = document.getElementById('installment-count');
        this.installmentAmount = document.getElementById('installment-amount');
        this.depositSchedule = document.getElementById('deposit-schedule');
        this.depositDueDate = document.getElementById('deposit-due-date');
        this.depositDeadlineLabel = document.getElementById('deposit-deadline-label');
        this.currencySelect = document.getElementById('reg-currency');
        this.paymentAmountField = document.getElementById('manual-payment-amount-field');
        this.paymentAmountLabel = document.getElementById('manual-payment-amount-label');
        this.paymentAmountInput = document.getElementById('manual-payment-amount');
        this.paymentAmountHint = document.getElementById('manual-payment-hint');
        this.paymentCustomToggle = document.getElementById('manual-payment-custom-toggle');
        this.paymentLockedHint = document.getElementById('manual-payment-locked-hint');
        this.paymentSummaryBox = document.getElementById('manual-payment-summary');
        this.summaryTotalAmount = document.getElementById('manual-summary-total-amount');
        this.summaryTotalPaid = document.getElementById('manual-summary-total-paid');
        this.summaryRemaining = document.getElementById('manual-summary-remaining');
        this.manualPaymentsHistorySection = document.getElementById('manual-payments-history-section');
        this.manualPaymentsHistoryList = document.getElementById('manual-payments-history-list');
        this.manualPaymentsHistoryEmpty = document.getElementById('manual-payments-history-empty');

        // Church selector
        this.btnOpenChurchSelector = document.getElementById('btn-open-church-selector');
        this.selectedChurchDisplay = document.getElementById('selected-church-display');
        this.selectedChurchId = document.getElementById('selected-church-id');
        this.countryInput = document.getElementById('reg-country');
        this.cityInput = document.getElementById('reg-city');

        // Status
        this.statusMsg = document.getElementById('manual-reg-status');
        this.deleteBookingBtn = document.getElementById('btn-delete-manual-booking');
        this.deleteBookingHint = document.getElementById('manual-delete-hint');

        // Alert Modal
        this.alertModal = document.getElementById('custom-alert-modal');
        this.alertTitle = document.getElementById('alert-title');
        this.alertMessage = document.getElementById('alert-message');
        this.alertIconError = document.getElementById('alert-icon-error');
        this.alertIconSuccess = document.getElementById('alert-icon-success');
        this.btnCloseAlert = document.getElementById('btn-close-alert');
    }

    bindEvents() {
        // Modal controls
        this.closeBtn?.addEventListener('click', () => this.close());
        this.cancelBtn?.addEventListener('click', () => this.close());
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close(); // Close only if clicking clicking the backdrop
        });

        // Alert controls
        this.btnCloseAlert?.addEventListener('click', () => this.closeAlert());
        this.alertModal?.addEventListener('click', (e) => {
            // Allow closing by clicking outside the white box
            if (e.target === this.alertModal) this.closeAlert();
        });

        // Leader updates
        this.leaderName?.addEventListener('input', () => this.updateLeaderParticipant());
        this.leaderAge?.addEventListener('input', () => {
            const age = this.parseAge(this.leaderAge?.value);
            this.updateMenuOptions(this.leaderMenu, age);
            this.updateLeaderParticipant();
        });
        this.leaderPackage?.addEventListener('change', () => this.updateLeaderParticipant());
        this.leaderMenu?.addEventListener('change', () => this.updateLeaderParticipant());
        this.leaderBirthdate?.addEventListener('change', () => {
            const age = this.getAgeFromBirthdate(this.leaderBirthdate?.value);
            if (age !== null && this.leaderAge) {
                this.leaderAge.value = String(age);
            }
            this.updateMenuOptions(this.leaderMenu, age);
            this.updateLeaderParticipant();
        });
        this.leaderGender?.addEventListener('change', () => this.updateLeaderParticipant());
        this.countryInput?.addEventListener('change', () => this.updateCurrencyFromCountry(this.countryInput?.value));
        this.countryInput?.addEventListener('blur', () => this.updateCurrencyFromCountry(this.countryInput?.value));
        this.currencySelect?.addEventListener('change', () => {
            const selected = this.normalizeCurrency(this.currencySelect?.value);
            this.currencyOverride = true;
            if (selected !== this.currency) {
                this.currency = selected;
                this.paymentAmountTouched = false;
                this.updateSummary();
            } else {
                this.syncPaymentAmount(true);
            }
        });
        this.paymentAmountInput?.addEventListener('input', () => {
            this.paymentAmountTouched = true;
            const amount = this.parsePaymentAmount();
            if (amount !== null) {
                this.paymentAmountInput.value = this.formatInputAmount(amount);
            }
            this.updatePaymentHint();
        });
        this.paymentCustomToggle?.addEventListener('change', () => {
            this.paymentAmountTouched = Boolean(this.paymentCustomToggle?.checked);
            this.handleCustomPaymentToggle();
        });

        if (this.depositDueDate) {
            const clampDepositDate = () => this.syncDepositSchedule();
            this.depositDueDate.addEventListener('change', clampDepositDate);
            this.depositDueDate.addEventListener('blur', clampDepositDate);
        }

        // Companion form
        if (this.btnAddCompanion) {
            this.btnAddCompanion.addEventListener('click', (e) => {
                // Prevent default submit behavior
                e.preventDefault();
                e.stopPropagation();
                this.editingCompanionId = null;
                this.setCompanionFormMode(false);
                this.showCompanionForm();
            });
        } else {
            console.warn('RegistrationModal: btnAddCompanion not found in DOM');
        }

        this.btnCancelCompanion?.addEventListener('click', (e) => {
            e.preventDefault();
            this.hideCompanionForm();
        });
        this.btnSaveCompanion?.addEventListener('click', (e) => {
            e.preventDefault();
            this.saveCompanion();
        });
        this.companionAge?.addEventListener('input', () => {
            const age = this.parseAge(this.companionAge?.value);
            this.updateMenuOptions(this.companionMenu, age);
            this.updateCompanionPackageVisibility();

            // Smart doc type selection for kids
            if (age !== null && age <= 7 && this.companionDocType) {
                this.companionDocType.value = 'RC';
            } else if (age !== null && age > 7 && age < 18 && this.companionDocType) {
                this.companionDocType.value = 'TI';
            } else if (age !== null && age >= 18 && this.companionDocType) {
                this.companionDocType.value = 'CC';
            }
        });
        this.companionBirthdate?.addEventListener('change', () => {
            const age = this.getAgeFromBirthdate(this.companionBirthdate?.value);
            if (age !== null && this.companionAge) {
                this.companionAge.value = String(age);
            }
            this.updateMenuOptions(this.companionMenu, age);
            this.updateCompanionPackageVisibility();
        });

        // Payment options
        this.paymentOptions?.forEach(input => {
            input.addEventListener('change', (e) => {
                // Prevent scroll jump by preserving current position
                const scrollContainer = document.getElementById('modal-scroll-container');
                const currentScrollPos = scrollContainer?.scrollTop || 0;

                // Update UI
                this.updatePaymentUI();

                // Restore scroll position after DOM updates
                requestAnimationFrame(() => {
                    if (scrollContainer) {
                        scrollContainer.scrollTop = currentScrollPos;
                    }
                });
            });
        });

        this.installmentFrequencyInputs?.forEach(input => {
            input.addEventListener('change', () => {
                this.updateInstallmentPreview();
                this.syncPaymentAmount(true);
            });
        });

        // Form submission
        this.form?.addEventListener('submit', (e) => this.handleSubmit(e));
        this.deleteBookingBtn?.addEventListener('click', () => this.handleDeleteBooking());
    }

    // --- Alert System ---
    showAlert(message, type = 'error', title = null) {
        if (!this.alertModal) {
            alert(message); // Fallback
            return;
        }

        this.alertMessage.textContent = message;
        this.alertTitle.textContent = title || (type === 'error' ? 'Atención' : '¡Éxito!');

        if (type === 'success') {
            this.alertIconError?.classList.add('hidden');
            this.alertIconSuccess?.classList.remove('hidden');
        } else {
            this.alertIconError?.classList.remove('hidden');
            this.alertIconSuccess?.classList.add('hidden');
        }

        this.alertModal.classList.remove('hidden');
        this.alertModal.classList.add('flex');

        // Accessibility: Focus close button
        setTimeout(() => {
            this.btnCloseAlert?.focus();
        }, 50);
    }

    closeAlert() {
        this.alertModal?.classList.add('hidden');
        this.alertModal?.classList.remove('flex');
    }

    setModalMode(isEditing, bookingRef = '') {
        this.isEditMode = isEditing;
        if (this.modalTitle) {
            this.modalTitle.textContent = isEditing ? 'Editar Participante' : this.defaultModalTitle;
        }
        if (this.modalSubtitle) {
            const refLabel = bookingRef ? `#${bookingRef}` : '';
            this.modalSubtitle.textContent = isEditing ? `Edición de reserva ${refLabel}`.trim() : this.defaultModalSubtitle;
        }
        if (this.submitBtn) {
            this.submitBtn.textContent = isEditing ? 'Guardar Cambios' : this.defaultSubmitLabel;
        }
        if (this.paymentAmountLabel) {
            this.paymentAmountLabel.textContent = isEditing ? 'Abono recibido hoy (opcional)' : 'Valor pagado hoy';
        }
        if (this.paymentCustomToggle) {
            if (isEditing) {
                this.paymentCustomToggle.checked = true;
                this.paymentCustomToggle.disabled = true;
                this.paymentAmountTouched = false;
            } else {
                this.paymentCustomToggle.disabled = false;
            }
        }
        this.updatePaymentUI();
    }

    // --- Smart Logic ---
    updateMenuOptions(selectElement, age) {
        if (!selectElement) return;

        // Use current value to restore if possible
        const currentValue = this.normalizeMenuValue(selectElement.value);

        // Rule: Age <= 10 -> Only "Menú Infantil"
        // Rule: Age > 10 or null -> "Menú Tradicional", "Menú Vegetariano"

        if (age !== null && age <= 10) {
            selectElement.innerHTML = `
        <option value="INFANTIL">Menú infantil</option>
      `;
            // Always select infantil
            selectElement.value = 'INFANTIL';
        } else {
            selectElement.innerHTML = `
        <option value="TRADICIONAL">Menú tradicional</option>
        <option value="VEGETARIANO">Menú vegetariano</option>
      `;
            // Restore previous value if it matches one of the new options
            // Unless previous was infantil, then switch to tradicional
            if (currentValue === 'VEGETARIANO') {
                selectElement.value = 'VEGETARIANO';
            } else {
                selectElement.value = 'TRADICIONAL';
            }
        }
    }

    normalizeMenuValue(value) {
        if (!value) return '';
        const raw = value.toString().trim();
        if (!raw) return '';
        const upper = raw.toUpperCase();
        if (upper === 'GENERAL' || upper === 'TRADICIONAL') return 'TRADICIONAL';
        if (upper === 'KIDS' || upper === 'INFANTIL') return 'INFANTIL';
        if (upper === 'VEGETARIAN' || upper === 'VEGETARIANO') return 'VEGETARIANO';
        return raw;
    }

    formatMenuLabel(value) {
        const normalized = this.normalizeMenuValue(value);
        if (!normalized) return '';
        if (normalized === 'TRADICIONAL') return 'Tradicional';
        if (normalized === 'VEGETARIANO') return 'Vegetariano';
        if (normalized === 'INFANTIL') return 'Infantil';
        return normalized;
    }

    // Participant Management
    updateLeaderParticipant() {
        const name = this.leaderName?.value?.trim();
        const age = this.parseAge(this.leaderAge?.value);
        const packageChoice = this.leaderPackage?.value || 'lodging';
        const menuChoice = this.normalizeMenuValue(this.leaderMenu?.value) || 'TRADICIONAL';
        const birthdate = this.leaderBirthdate?.value || '';
        const gender = this.leaderGender?.value || '';

        const packageType = age !== null ? this.getPackageTypeFromAge(age, packageChoice) : packageChoice;
        this.leaderDraft = { packageType };

        if (!name) {
            this.updateSummary();
            return;
        }

        const existing = this.participants.find(p => p.isLeader);
        if (existing) {
            existing.name = name;
            existing.age = age;
            existing.packageType = packageType;
            existing.menu = menuChoice;
            existing.birthdate = birthdate;
            existing.gender = gender;
        } else {
            this.participants.unshift({
                id: this.leaderId,
                name,
                age,
                packageType,
                menu: menuChoice,
                birthdate,
                gender,
                isLeader: true
            });
        }

        this.renderParticipants();
        this.updateSummary();
    }

    showCompanionForm() {
        if (this.addCompanionForm) this.addCompanionForm.classList.remove('hidden');
        if (this.btnAddCompanion) this.btnAddCompanion.classList.add('hidden');
        this.setCompanionFormMode(Boolean(this.editingCompanionId));

        // Focus first field
        setTimeout(() => {
            if (this.companionDocType) this.companionDocType.focus();
        }, 50);
    }

    hideCompanionForm() {
        if (this.addCompanionForm) this.addCompanionForm.classList.add('hidden');
        if (this.btnAddCompanion) this.btnAddCompanion.classList.remove('hidden');
        this.clearCompanionForm();
        this.editingCompanionId = null;
        this.setCompanionFormMode(false);
    }

    clearCompanionForm() {
        if (this.companionName) this.companionName.value = '';
        if (this.companionEmail) this.companionEmail.value = '';
        if (this.companionAge) this.companionAge.value = '';

        if (this.companionDocNumber) this.companionDocNumber.value = '';
        // Reset doc type to TI default or empty
        if (this.companionDocType) this.companionDocType.value = 'TI';
        if (this.companionBirthdate) this.companionBirthdate.value = '';
        if (this.companionGender) this.companionGender.value = '';

        // Reset package options
        if (this.companionPackage) {
            this.companionPackage.disabled = false;
            this.companionPackage.value = 'lodging';
        }
        if (this.companionPackageContainer) this.companionPackageContainer.style.opacity = '1';

        // Reset menu
        if (this.companionMenu) {
            this.updateMenuOptions(this.companionMenu, null); // Reset to adult options
        }
    }

    setCompanionFormMode(isEditing) {
        if (this.companionFormTitle) {
            this.companionFormTitle.textContent = isEditing ? 'Editar Acompañante' : 'Nuevo Acompañante';
        }
        if (this.btnSaveCompanion) {
            this.btnSaveCompanion.textContent = isEditing ? 'Actualizar Acompañante' : 'Confirmar Acompañante';
        }
    }

    startCompanionEdit(participantId) {
        const targetId = String(participantId);
        const participant = this.participants.find(p => String(p.id) === targetId && !p.isLeader);
        if (!participant) return;
        this.editingCompanionId = targetId;
        this.showCompanionForm();

        if (this.companionDocType) this.companionDocType.value = participant.document_type || 'TI';
        if (this.companionDocNumber) this.companionDocNumber.value = participant.document_number || '';
        if (this.companionName) this.companionName.value = participant.name || '';
        if (this.companionEmail) this.companionEmail.value = participant.email || '';
        if (this.companionAge) this.companionAge.value = participant.age != null ? String(participant.age) : '';
        if (this.companionBirthdate) this.companionBirthdate.value = participant.birthdate || '';
        if (this.companionGender) this.companionGender.value = participant.gender || '';

        const age = this.parseAge(this.companionAge?.value);
        this.updateMenuOptions(this.companionMenu, age);
        if (this.companionMenu) {
            this.companionMenu.value = this.normalizeMenuValue(participant.menu) || this.companionMenu.value;
        }

        if (this.companionPackage) {
            this.companionPackage.value = participant.packageType === 'no_lodging' ? 'no_lodging' : 'lodging';
        }
        this.updateCompanionPackageVisibility();
    }

    updateCompanionPackageVisibility() {
        const age = this.parseAge(this.companionAge?.value);
        const isChild = age !== null && age <= 10;

        if (this.companionPackageContainer) {
            this.companionPackageContainer.style.opacity = isChild ? '0.5' : '1';
            // Disable select for UX clarity
            const select = this.companionPackageContainer.querySelector('select');
            if (select) select.disabled = isChild;
        }
    }

    saveCompanion() {
        const docType = this.companionDocType?.value || 'TI';
        const docNumber = this.companionDocNumber?.value?.trim();
        const name = this.companionName?.value?.trim();
        const email = this.companionEmail?.value?.trim() || '';
        const age = this.parseAge(this.companionAge?.value);
        const packageChoice = this.companionPackage?.value || 'lodging';
        const menuChoice = this.normalizeMenuValue(this.companionMenu?.value) || 'TRADICIONAL';
        const birthdate = this.companionBirthdate?.value || '';
        const gender = this.companionGender?.value || '';

        if (!docNumber) {
            this.showAlert('Ingresa el número de documento del acompañante');
            return;
        }

        if (!name) {
            this.showAlert('Ingresa el nombre del acompañante');
            return;
        }

        if (age === null || age < 0 || age > 120) {
            this.showAlert('Ingresa una edad válida para el acompañante');
            return;
        }

        if (!birthdate) {
            this.showAlert('Ingresa la fecha de nacimiento del acompañante');
            return;
        }

        if (!gender) {
            this.showAlert('Selecciona el género del acompañante');
            return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showAlert('El email del acompañante no es válido');
            return;
        }

        const packageType = this.getPackageTypeFromAge(age, packageChoice);

        const participantPayload = {
            id: this.editingCompanionId || this.generateIdempotencyKey(),
            document_type: docType,
            document_number: docNumber,
            name,
            email,
            age,
            packageType,
            menu: menuChoice,
            birthdate,
            gender,
            isLeader: false
        };

        if (this.editingCompanionId) {
            const targetId = String(this.editingCompanionId);
            const existing = this.participants.find(p => String(p.id) === targetId && !p.isLeader);
            if (existing) {
                Object.assign(existing, participantPayload, { id: targetId });
            } else {
                this.participants.push(participantPayload);
            }
            this.editingCompanionId = null;
            this.setCompanionFormMode(false);
        } else {
            this.participants.push(participantPayload);
        }

        this.hideCompanionForm();
        this.renderParticipants();
        this.updateSummary();
    }

    removeParticipant(id) {
        const targetId = String(id);
        this.participants = this.participants.filter(p => String(p.id) !== targetId);
        this.renderParticipants();
        this.updateSummary();
    }

    renderParticipants() {
        if (!this.companionsList || !this.summaryList) return;

        const companions = this.participants.filter(p => !p.isLeader);

        // Main list
        if (companions.length === 0) {
            this.companionsList.innerHTML = '';
            this.companionsEmpty?.classList.remove('hidden');
        } else {
            this.companionsEmpty?.classList.add('hidden');
            this.companionsList.innerHTML = companions.map(p => this.renderParticipantItem(p)).join('');

            // Bind remove buttons
            this.companionsList.querySelectorAll('.btn-remove-participant').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.participantId;
                    if (!id) return;
                    this.removeParticipant(id);
                });
            });

            this.companionsList.querySelectorAll('.btn-edit-participant').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.participantId;
                    if (!id) return;
                    this.startCompanionEdit(id);
                });
            });
        }

        // Summary list
        if (this.participants.length === 0) {
            this.summaryList.innerHTML = '<p class="italic text-white/30 text-xs">Agrega participantes...</p>';
        } else {
            this.summaryList.innerHTML = this.participants.map(p => this.renderSummaryItem(p)).join('');
        }
    }

    renderParticipantItem(p) {
        const price = this.getPrice(p.packageType);
        const ageLabel = p.age !== null ? ` · ${p.age} años` : '';
        const normalizedMenu = this.normalizeMenuValue(p.menu);
        const menuLabel = normalizedMenu && normalizedMenu !== 'TRADICIONAL'
            ? ` · 🍽️ ${this.formatMenuLabel(normalizedMenu)}`
            : '';
        const docLabel = p.document_number ? ` · ${p.document_type} ${p.document_number}` : '';

        return `
      <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
        <div class="flex-1">
          <div class="font-bold text-[#293C74] text-sm">${p.name}</div>
          <div class="text-xs text-slate-500">${this.getTypeLabel(p.packageType)}${ageLabel}${docLabel}</div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-[#293C74]">${this.formatPrice(price)}</span>
          <button type="button" class="btn-edit-participant text-brand-teal hover:text-[#293C74] text-xs underline" data-participant-id="${p.id}">Editar</button>
          <button type="button" class="btn-remove-participant text-red-500 hover:text-red-700 text-xs underline" data-participant-id="${p.id}">Eliminar</button>
        </div>
      </div>
    `;
    }

    renderSummaryItem(p) {
        const price = this.getPrice(p.packageType);
        const leaderBadge = p.isLeader ? ' <span class="text-brand-teal text-[10px]">(Responsable)</span>' : '';

        return `
      <div class="flex justify-between text-xs text-white/80">
        <span>${p.name}${leaderBadge}</span>
        <span class="opacity-70">${this.formatPrice(price)}</span>
      </div>
    `;
    }

    // Pricing Logic
    updateCurrencyFromCountry(value) {
        if (this.currencyOverride) return;
        const raw = String(value || '').trim().toUpperCase();
        const isColombia = raw === 'CO' || raw === 'COL' || raw.includes('COLOMBIA');
        const isVirtual = raw === 'VIRTUAL' || raw === 'ONLINE' || raw === 'N/A';
        const nextCurrency = (isColombia || isVirtual) ? 'COP' : 'USD';
        if (this.currency !== nextCurrency) {
            this.currency = nextCurrency;
            if (this.currencySelect) this.currencySelect.value = nextCurrency;
            this.paymentAmountTouched = false;
            this.updateSummary();
        }
    }

    normalizeCurrency(value) {
        return value === 'USD' ? 'USD' : 'COP';
    }

    getInstallmentDeadline() {
        return this.form?.dataset?.installmentDeadline || '2026-05-15';
    }

    formatInputDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatLongDateWithYear(value) {
        try {
            const [year, month, day] = value.split('-').map(Number);
            const date = new Date(year, (month || 1) - 1, day || 1);
            return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
        } catch {
            return value;
        }
    }

    getDepositMinDate() {
        const base = new Date();
        base.setDate(base.getDate() + 1);
        return this.formatInputDate(base);
    }

    syncDepositSchedule() {
        if (!this.depositDueDate) return;
        const deadline = this.getInstallmentDeadline();
        const minDate = this.getDepositMinDate();
        this.depositDueDate.min = minDate;
        this.depositDueDate.max = deadline;
        if (this.depositDeadlineLabel) {
            this.depositDeadlineLabel.textContent = this.formatLongDateWithYear(deadline);
        }
        const current = this.depositDueDate.value;
        if (!current || current < minDate || current > deadline) {
            const next = deadline >= minDate ? deadline : minDate;
            this.depositDueDate.value = next;
        }
    }

    validateDepositSchedule() {
        if (!this.depositDueDate) return '';
        const value = this.depositDueDate.value;
        const deadline = this.getInstallmentDeadline();
        const minDate = this.getDepositMinDate();
        const deadlineLabel = this.formatLongDateWithYear(deadline);
        if (!value) return 'Selecciona la fecha del segundo pago';
        if (value < minDate) return 'La fecha del segundo pago debe ser desde mañana';
        if (value > deadline) return `La fecha del segundo pago debe ser hasta el ${deadlineLabel} (incluido)`;
        return '';
    }

    getAgeFromBirthdate(value) {
        if (!value) return null;
        const parts = value.split('-').map((item) => Number(item));
        if (parts.length !== 3) return null;
        const [year, month, day] = parts;
        if (!year || !month || !day) return null;
        const birth = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(birth.getTime())) return null;
        const now = new Date();
        let age = now.getUTCFullYear() - birth.getUTCFullYear();
        const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
        if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
            age -= 1;
        }
        return age < 0 ? null : age;
    }

    parseAge(value) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    getPackageTypeFromAge(age, lodgingChoice) {
        if (age <= 4) return 'child_0_7';
        if (age <= 10) return 'child_7_13';
        return lodgingChoice === 'no_lodging' ? 'no_lodging' : 'lodging';
    }

    getPrice(packageType) {
        const priceMap = this.currency === 'COP' ? this.prices.COP : this.prices.USD;
        return priceMap[packageType] || 0;
    }

    getTypeLabel(type) {
        const labels = {
            lodging: 'Con Alojamiento',
            no_lodging: 'Sin Alojamiento',
            child_0_7: 'Niño 0-4 años',
            child_7_13: 'Niño 5-10 años'
        };
        return labels[type] || type;
    }

    formatPrice(amount) {
        if (this.currency === 'COP') {
            return new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 0
            }).format(amount);
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 2
        }).format(amount);
    }

    formatInputAmount(amount) {
        if (!Number.isFinite(amount)) return '';
        if (this.currency === 'COP') {
            return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(amount);
        }
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount);
    }

    getTotal() {
        const items = [...this.participants];
        const hasLeader = items.some((p) => p.isLeader);
        if (!hasLeader && this.leaderDraft?.packageType) {
            items.push(this.leaderDraft);
        }
        return items.reduce((sum, p) => sum + this.getPrice(p.packageType), 0);
    }

    getDepositAmount(total) {
        return Math.round(total * 0.5 * 100) / 100;
    }

    getSelectedPaymentOption() {
        return document.querySelector('input[name="payment_option"]:checked')?.value || 'FULL';
    }

    getDefaultPaymentAmount() {
        const total = this.getTotal();
        const option = this.getSelectedPaymentOption();
        if (option === 'DEPOSIT') return this.getDepositAmount(total);
        if (option === 'INSTALLMENTS') return this.lastInstallmentAmount || 0;
        return total;
    }

    updatePaymentHint() {
        if (!this.paymentAmountHint) return;
        if (this.isEditMode && !this.canEditPayment) {
            this.paymentAmountHint.textContent = 'Pago online: gestionado automáticamente';
            return;
        }
        if (this.isEditMode && this.canEditPayment) {
            const paid = Number(this.paymentSummary?.total_paid || 0);
            const remaining = Math.max(this.getTotal() - paid, 0);
            this.paymentAmountHint.textContent = `Ingresa solo el nuevo abono. Pendiente: ${this.formatPrice(remaining)}`;
            return;
        }
        const suggested = this.getDefaultPaymentAmount();
        const customEnabled = Boolean(this.paymentCustomToggle?.checked);
        const label = customEnabled ? 'Sugerido' : 'Automático';
        this.paymentAmountHint.textContent = `${label}: ${this.formatPrice(suggested)}`;
    }

    syncPaymentAmount(force = false) {
        if (!this.paymentAmountInput) return;
        if (this.isEditMode && !this.canEditPayment) {
            this.paymentAmountInput.readOnly = true;
            this.paymentAmountInput.classList.add('bg-slate-100', 'cursor-not-allowed', 'text-slate-500');
            this.paymentAmountInput.classList.remove('bg-white', 'bg-slate-50');
            this.updatePaymentHint();
            return;
        }
        const customEnabled = Boolean(this.paymentCustomToggle?.checked);
        this.paymentAmountInput.readOnly = !customEnabled;
        this.paymentAmountInput.classList.remove('cursor-not-allowed', 'text-slate-500');
        this.paymentAmountInput.classList.toggle('bg-white', customEnabled);
        this.paymentAmountInput.classList.toggle('bg-slate-50', !customEnabled);

        const shouldSync = (!customEnabled && (force || !this.paymentAmountTouched || !this.paymentAmountInput.value));
        if (shouldSync) {
            const defaultAmount = this.getDefaultPaymentAmount();
            this.paymentAmountInput.value = defaultAmount ? this.formatInputAmount(defaultAmount) : '';
            if (force) this.paymentAmountTouched = false;
        } else if (!this.isEditMode && customEnabled && force && !this.paymentAmountInput.value) {
            const defaultAmount = this.getDefaultPaymentAmount();
            this.paymentAmountInput.value = defaultAmount ? this.formatInputAmount(defaultAmount) : '';
        }
        this.updatePaymentHint();
    }

    parsePaymentAmount(rawValue) {
        if (!this.paymentAmountInput && rawValue === undefined) return null;
        const raw = (rawValue ?? this.paymentAmountInput?.value ?? '').toString().trim();
        if (!raw) return null;
        if (this.currency === 'COP') {
            const digits = raw.replace(/[^\d]/g, '');
            if (!digits) return null;
            const amount = Number(digits);
            return Number.isFinite(amount) ? amount : null;
        }
        const normalized = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
        if (!normalized) return null;
        const amount = Number(normalized);
        return Number.isFinite(amount) ? amount : null;
    }

    updateSummary() {
        const total = this.getTotal();

        if (this.summarySubtotal) this.summarySubtotal.textContent = this.formatPrice(total);
        if (this.summaryTotal) this.summaryTotal.textContent = this.formatPrice(total);

        // Update deposit amount
        const deposit = this.getDepositAmount(total);
        if (this.depositAmountLabel) {
            this.depositAmountLabel.textContent = this.formatPrice(deposit);
        }

        this.updateInstallmentPreview();
        this.syncPaymentAmount();
        this.updatePaymentSummaryUI();
    }

    formatDateTime(value) {
        if (!value) return 'Sin fecha';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Sin fecha';
        return date.toLocaleString('es-CO', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    updatePaymentSummaryUI() {
        if (!this.paymentSummaryBox) return;
        const hasSummary = Boolean(this.isEditMode && this.paymentSummary);
        this.paymentSummaryBox.classList.toggle('hidden', !hasSummary);
        if (!hasSummary) return;

        const totalAmount = this.isEditMode
            ? this.getTotal()
            : Number(this.paymentSummary?.total_amount || 0);
        const totalPaid = Number(this.paymentSummary?.total_paid || 0);
        const remaining = Math.max(totalAmount - totalPaid, 0);

        this.paymentSummary.total_amount = totalAmount;
        this.paymentSummary.remaining_amount = remaining;

        if (this.summaryTotalAmount) this.summaryTotalAmount.textContent = this.formatPrice(totalAmount);
        if (this.summaryTotalPaid) this.summaryTotalPaid.textContent = this.formatPrice(totalPaid);
        if (this.summaryRemaining) this.summaryRemaining.textContent = this.formatPrice(remaining);
    }

    renderManualPaymentsHistory() {
        if (!this.manualPaymentsHistorySection || !this.manualPaymentsHistoryList || !this.manualPaymentsHistoryEmpty) return;
        const hasEditMode = Boolean(this.isEditMode);
        this.manualPaymentsHistorySection.classList.toggle('hidden', !hasEditMode);
        if (!hasEditMode) return;

        const payments = Array.isArray(this.manualPayments) ? this.manualPayments : [];
        if (!payments.length) {
            this.manualPaymentsHistoryList.innerHTML = '';
            this.manualPaymentsHistoryEmpty.classList.remove('hidden');
            return;
        }

        this.manualPaymentsHistoryEmpty.classList.add('hidden');
        this.manualPaymentsHistoryList.innerHTML = payments.map((payment) => {
            const amount = Number(payment.amount || 0);
            const reference = (payment.reference || '').toString().trim() || 'sin referencia';
            const createdAt = this.formatDateTime(payment.created_at);
            return `
                <div class="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-[#293C74] truncate">${reference}</p>
                    <p class="text-[11px] text-slate-500">${createdAt}</p>
                  </div>
                  <p class="text-sm font-bold text-emerald-700 whitespace-nowrap">${this.formatPrice(amount)}</p>
                </div>
            `;
        }).join('');
    }

    updateDeleteBookingUI() {
        const canShowDelete = Boolean(this.isEditMode && this.canDeleteBooking && this.editBookingId);
        if (this.deleteBookingBtn) {
            this.deleteBookingBtn.classList.toggle('hidden', !canShowDelete);
        }
        if (this.deleteBookingHint) {
            const showHint = Boolean(this.isEditMode && !this.canDeleteBooking);
            this.deleteBookingHint.classList.toggle('hidden', !showHint);
        }
    }

    // Payment UI
    updatePaymentUI() {
        const scrollContainer = document.getElementById('modal-scroll-container');
        const previousScroll = scrollContainer ? scrollContainer.scrollTop : 0;
        const customEnabled = Boolean(this.paymentCustomToggle?.checked);
        const lockPaymentEdition = this.isEditMode && !this.canEditPayment;

        this.updatePaymentSummaryUI();
        this.renderManualPaymentsHistory();
        this.updateDeleteBookingUI();

        if (this.paymentOptionsContainer) {
            if (this.isEditMode || lockPaymentEdition) {
                this.paymentOptionsContainer.classList.add('hidden');
            } else {
                this.paymentOptionsContainer.classList.toggle('hidden', customEnabled);
            }
        }

        if (this.paymentLockedHint) {
            this.paymentLockedHint.classList.toggle('hidden', !lockPaymentEdition);
        }

        if (lockPaymentEdition) {
            if (this.installmentDetails) this.installmentDetails.classList.add('hidden');
            if (this.depositSchedule) this.depositSchedule.classList.add('hidden');
            this.syncPaymentAmount(true);
            if (scrollContainer) {
                requestAnimationFrame(() => {
                    scrollContainer.scrollTop = previousScroll;
                });
            }
            return;
        }

        const selected = document.querySelector('input[name="payment_option"]:checked');
        const value = selected?.value || 'FULL';

        if (customEnabled || this.isEditMode) {
            if (this.installmentDetails) this.installmentDetails.classList.add('hidden');
            if (this.depositSchedule) this.depositSchedule.classList.add('hidden');
        } else {
            if (this.installmentDetails) {
                this.installmentDetails.classList.toggle('hidden', value !== 'INSTALLMENTS');
            }
            if (this.depositSchedule) {
                this.depositSchedule.classList.toggle('hidden', value !== 'DEPOSIT');
            }
        }

        if (value === 'INSTALLMENTS') {
            this.updateInstallmentPreview();
        }
        if (value === 'DEPOSIT') {
            this.syncDepositSchedule();
        }
        this.syncPaymentAmount(true);

        if (scrollContainer) {
            requestAnimationFrame(() => {
                scrollContainer.scrollTop = previousScroll;
            });
        }
    }

    handleCustomPaymentToggle() {
        this.updatePaymentUI();
    }

    updateInstallmentPreview() {
        const preview = this.getInstallmentPreview();
        if (this.installmentCount) this.installmentCount.textContent = preview.count;
        if (this.installmentAmount) this.installmentAmount.textContent = this.formatPrice(preview.amount);
        this.lastInstallmentAmount = preview.amount;
        this.lastInstallmentCount = preview.count;
    }

    getInstallmentPreview() {
        const total = this.getTotal();
        const frequency = document.querySelector('input[name="installment_frequency"]:checked')?.value || 'MONTHLY';
        const deadline = this.getInstallmentDeadline();

        const [year, month, day] = deadline.split('-').map(Number);
        const end = new Date(Date.UTC(year, month - 1, day));
        const now = new Date();
        const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        if (end < current) {
            return { count: 1, amount: Math.round(total) };
        }

        const dueDates = [];
        let tempDate = new Date(current);

        while (tempDate <= end) {
            dueDates.push(new Date(tempDate));
            if (frequency === 'BIWEEKLY') {
                tempDate.setUTCDate(tempDate.getUTCDate() + 14);
            } else {
                tempDate.setUTCMonth(tempDate.getUTCMonth() + 1);
            }
        }

        const count = Math.max(1, dueDates.length);
        const rawAmount = total / count;
        const amount = this.currency === 'COP'
            ? Math.round(rawAmount)
            : Math.round(rawAmount * 100) / 100;
        return { count, amount };
    }

    generateIdempotencyKey() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    // Form Submission
    async handleSubmit(e) {
        e.preventDefault();

        if (this.participants.length === 0) {
            this.showAlert('Debes agregar al menos un participante (el responsable)');
            return;
        }

        const missingParticipant = this.participants.find(p => !p.birthdate || !p.gender);
        if (missingParticipant) {
            this.showAlert('Falta fecha de nacimiento y género en uno o más participantes');
            return;
        }

        if (!this.selectedChurch) {
            this.showAlert('Selecciona una iglesia para continuar');
            return;
        }

        const isVirtual = this.selectedChurch?.id === 'virtual' || this.selectedChurch?.isVirtual;
        if (isVirtual && !this.countryInput?.value?.trim()) {
            this.showAlert('Escribe el país o región para Maná Virtual');
            return;
        }

        const paymentOption = document.querySelector('input[name="payment_option"]:checked')?.value || 'FULL';
        if (paymentOption === 'DEPOSIT') {
            const depositError = this.validateDepositSchedule();
            if (depositError) {
                this.showAlert(depositError);
                return;
            }
        }

        const totalAmount = this.getTotal();
        const lockPaymentEdition = this.isEditMode && !this.canEditPayment;
        const paymentAmount = lockPaymentEdition ? null : this.parsePaymentAmount();
        const customEnabled = lockPaymentEdition ? false : Boolean(this.paymentCustomToggle?.checked);
        if (customEnabled && paymentAmount == null && !this.isEditMode) {
            this.showAlert('Ingresa el valor pagado hoy para el aporte libre');
            return;
        }
        if (paymentAmount != null) {
            if (paymentAmount < 0) {
                this.showAlert('El monto pagado no puede ser negativo');
                return;
            }
            const paidFromSummary = Number(this.paymentSummary?.total_paid || 0);
            const maxPayable = this.isEditMode
                ? Math.max(totalAmount - paidFromSummary, 0)
                : totalAmount;
            if (paymentAmount > maxPayable) {
                this.showAlert(`El monto pagado no puede superar ${this.formatPrice(maxPayable)}`);
                return;
            }
        }

        const formData = this.collectFormData();
        if (!this.isEditMode) {
            const submissionSignature = JSON.stringify(formData);
            if (!this.idempotencyKey || this.lastSubmissionSignature !== submissionSignature) {
                this.idempotencyKey = this.generateIdempotencyKey();
                this.lastSubmissionSignature = submissionSignature;
            }
            formData.idempotencyKey = this.idempotencyKey;
        }

        if (this.statusMsg) {
            this.statusMsg.textContent = this.isEditMode ? 'Guardando cambios...' : 'Registrando grupo...';
            this.statusMsg.className = 'mt-4 text-sm text-center text-white/60';
        }

        try {
            const authHeaders = (typeof window.getPortalAuthHeaders === 'function')
                ? await window.getPortalAuthHeaders()
                : ((window.portalAuthHeaders && Object.keys(window.portalAuthHeaders).length)
                    ? window.portalAuthHeaders
                    : {});

            const endpoint = this.isEditMode ? '/api/portal/iglesia/booking' : '/api/portal/iglesia/register-group';
            const method = this.isEditMode ? 'PUT' : 'POST';

            const response = await fetch(endpoint, {
                method,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders,
                },
                body: JSON.stringify(formData),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Error al registrar el grupo');
            }

            if (this.isEditMode) {
                this.showAlert('Cambios guardados correctamente', 'success', 'Actualización Exitosa');
            } else {
                this.showAlert('Grupo registrado exitosamente', 'success', '¡Registro Exitoso!');
            }

            if (this.statusMsg) {
                this.statusMsg.textContent = this.isEditMode ? '✓ Cambios guardados' : '✓ Grupo registrado exitosamente';
                this.statusMsg.className = 'mt-4 text-sm text-center text-green-400 font-bold';
            }

            setTimeout(() => {
                this.close();
                window.location.reload(); // Refresh to show new registrations
            }, 2000);

        } catch (error) {
            console.error('Registration error:', error);
            this.showAlert(`${this.isEditMode ? 'Error al actualizar' : 'Error al registrar'}: ${error.message}`);
            if (this.statusMsg) {
                this.statusMsg.textContent = `Error: ${error.message}`;
                this.statusMsg.className = 'mt-4 text-sm text-center text-red-400';
            }
        }
    }

    async handleDeleteBooking() {
        if (!this.isEditMode || !this.editBookingId) {
            this.showAlert('No hay una reserva seleccionada para eliminar');
            return;
        }
        if (!this.canDeleteBooking) {
            this.showAlert('Este registro no se puede eliminar desde aquí. Si tiene pagos online, requiere revisión y devolución.');
            return;
        }

        const bookingCode = String(this.editBookingId).slice(0, 8).toUpperCase();
        const firstConfirm = window.confirm('Esta acción eliminará el registro manual y sus participantes. ¿Deseas continuar?');
        if (!firstConfirm) return;

        const typedCode = window.prompt(`Para confirmar, escribe el código ${bookingCode}`);
        if ((typedCode || '').trim().toUpperCase() !== bookingCode) {
            this.showAlert('Confirmación cancelada. El código no coincide.');
            return;
        }

        if (this.statusMsg) {
            this.statusMsg.textContent = 'Eliminando registro manual...';
            this.statusMsg.className = 'mt-4 text-sm text-center text-amber-200 font-semibold';
        }

        try {
            const authHeaders = (typeof window.getPortalAuthHeaders === 'function')
                ? await window.getPortalAuthHeaders()
                : ((window.portalAuthHeaders && Object.keys(window.portalAuthHeaders).length)
                    ? window.portalAuthHeaders
                    : {});

            const response = await fetch('/api/portal/iglesia/booking', {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders,
                },
                body: JSON.stringify({ booking_id: this.editBookingId }),
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.ok) {
                throw new Error(result?.error || 'No se pudo eliminar la reserva');
            }

            this.showAlert('Registro manual eliminado correctamente', 'success', 'Eliminación Exitosa');
            if (this.statusMsg) {
                this.statusMsg.textContent = '✓ Registro manual eliminado';
                this.statusMsg.className = 'mt-4 text-sm text-center text-green-400 font-bold';
            }
            setTimeout(() => {
                this.close();
                window.location.reload();
            }, 1500);
        } catch (error) {
            this.showAlert(`Error al eliminar: ${error.message}`);
            if (this.statusMsg) {
                this.statusMsg.textContent = `Error: ${error.message}`;
                this.statusMsg.className = 'mt-4 text-sm text-center text-red-400';
            }
        }
    }

    collectFormData() {
        const paymentOption = document.querySelector('input[name="payment_option"]:checked')?.value || 'FULL';
        const installmentFrequency = document.querySelector('input[name="installment_frequency"]:checked')?.value || 'MONTHLY';
        const depositDueDate = this.depositDueDate?.value || '';
        const paymentAmount = this.parsePaymentAmount();

        // Get fresh leader data from DOM
        const leaderDocType = document.getElementById('reg-leader-doc-type')?.value || 'CC';
        const leaderDocNumber = document.getElementById('reg-leader-doc-number')?.value || '';
        const leaderEmail = document.getElementById('reg-leader-email')?.value || '';
        const leaderPhone = document.getElementById('reg-leader-phone')?.value || '';
        const leaderBirthdate = this.leaderBirthdate?.value || '';
        const leaderGender = this.leaderGender?.value || '';

        const isManualChurch = this.selectedChurch?.id === 'MANUAL';
        const isSpecialChurch = Boolean(this.selectedChurch?.isSpecial) && !isManualChurch;
        const churchId = (isManualChurch || isSpecialChurch) ? null : this.selectedChurch?.id;
        const manualChurchName = isManualChurch
            ? (this.selectedChurch.manual_name || this.selectedChurch.name)
            : (isSpecialChurch ? this.selectedChurch?.name : null);

        const payload = {
            church_id: churchId,
            manual_church_name: manualChurchName,
            country: this.countryInput?.value || 'Colombia',
            city: this.cityInput?.value || '',
            participants: this.participants.map(p => {
                if (p.isLeader) {
                    // For leader, we must grab the current values from the inputs
                    // because they might have been edited after being added to the list
                    return {
                        ...p,
                        document_type: leaderDocType,
                        document_number: leaderDocNumber,
                        email: leaderEmail,
                        phone: leaderPhone,
                        birthdate: leaderBirthdate,
                        gender: leaderGender,
                        menu: p.menu || (this.normalizeMenuValue(this.leaderMenu?.value) || 'TRADICIONAL')
                    };
                }
                // For companions, the data in 'p' is already correct (saved from saveCompanion form)
                // Ensure they have defaults if missing (should be caught by validation though)
                return {
                    ...p,
                    document_type: p.document_type || 'TI',
                    document_number: p.document_number || ''
                };
            }),
            payment_option: paymentOption,
            installment_frequency: installmentFrequency,
            deposit_due_date: paymentOption === 'DEPOSIT' ? depositDueDate : null,
            total_amount: this.getTotal(),
            currency: this.currency,
            payment_amount: (this.isEditMode && !this.canEditPayment) ? null : paymentAmount,
        };
        if (this.isEditMode && this.editBookingId) {
            payload.booking_id = this.editBookingId;
        }
        if (this.isEditMode && this.editPaymentId) {
            payload.payment_id = this.editPaymentId;
        }
        return payload;
    }

    loadBookingForEdit(payload) {
        if (!payload?.booking) return;
        this.reset();
        this.isEditMode = true;
        this.editBookingId = payload.booking.id || null;
        this.editPaymentId = payload.payment?.id || null;
        this.canEditPayment = payload?.permissions?.can_edit_payment !== false;
        this.canDeleteBooking = payload?.permissions?.can_delete_booking === true;
        this.paymentSummary = payload?.payment_summary || null;
        this.manualPayments = Array.isArray(payload?.manual_payments) ? payload.manual_payments : [];
        const bookingRef = (payload.booking.id || '').slice(0, 8).toUpperCase();
        this.setModalMode(true, bookingRef);

        const booking = payload.booking;
        const participantsRaw = Array.isArray(payload.participants) ? payload.participants : [];
        const participants = participantsRaw.map((item, index) => {
            const birthdate = item.birthdate || '';
            const age = item.age != null ? Number(item.age) : this.getAgeFromBirthdate(birthdate);
            const packageType = item.package_type || item.packageType || (age != null ? this.getPackageTypeFromAge(age, 'lodging') : 'lodging');
            return {
                id: item.id || `${Date.now()}-${index}`,
                name: item.full_name || item.name || '',
                email: item.email || '',
                age: age ?? null,
                packageType,
                menu: item.diet_type || item.menu || 'TRADICIONAL',
                birthdate,
                gender: item.gender || '',
                document_type: item.document_type || '',
                document_number: item.document_number || '',
                isLeader: String(item.relationship || '').toLowerCase() === 'responsable',
            };
        });

        if (!participants.some((p) => p.isLeader) && participants.length) {
            participants[0].isLeader = true;
        }

        this.participants = participants;

        const leader = participants.find((p) => p.isLeader) || participants[0] || null;
        if (leader) {
            if (this.leaderName) this.leaderName.value = booking.contact_name || leader.name || '';
            const leaderAge = leader.age != null ? leader.age : this.getAgeFromBirthdate(leader.birthdate || '');
            if (this.leaderAge && leaderAge != null) this.leaderAge.value = String(leaderAge);
            if (this.leaderBirthdate) this.leaderBirthdate.value = leader.birthdate || '';
            if (this.leaderGender) this.leaderGender.value = leader.gender || '';
            if (this.leaderMenu) {
                const menuValue = this.normalizeMenuValue(leader.menu) || 'TRADICIONAL';
                this.updateMenuOptions(this.leaderMenu, leader.age);
                this.leaderMenu.value = menuValue;
            }
            if (this.leaderPackage) {
                this.leaderPackage.value = leader.packageType === 'no_lodging' ? 'no_lodging' : 'lodging';
            }
            const docType = booking.contact_document_type || leader.document_type || 'CC';
            const docNumber = booking.contact_document_number || leader.document_number || '';
            const email = booking.contact_email || leader.email || '';
            const phone = booking.contact_phone || '';
            const docTypeInput = document.getElementById('reg-leader-doc-type');
            const docNumberInput = document.getElementById('reg-leader-doc-number');
            const emailInput = document.getElementById('reg-leader-email');
            const phoneInput = document.getElementById('reg-leader-phone');
            if (docTypeInput) docTypeInput.value = docType;
            if (docNumberInput) docNumberInput.value = docNumber;
            if (emailInput) emailInput.value = email;
            if (phoneInput) phoneInput.value = phone;
        }

        const currency = this.normalizeCurrency(booking.currency || this.currency);
        this.currencyOverride = true;
        this.currency = currency;
        if (this.currencySelect) this.currencySelect.value = currency;

        if (payload.church) {
            this.setChurch(payload.church);
        }

        if (this.countryInput) this.countryInput.value = booking.contact_country || '';
        if (this.cityInput) this.cityInput.value = booking.contact_city || '';

        if (this.paymentAmountInput) {
            if (this.canEditPayment) {
                this.paymentAmountInput.value = '';
                this.paymentAmountInput.placeholder = 'Nuevo abono';
            } else {
                const paidAmount = payload?.payment_summary?.total_paid ?? payload.payment?.amount ?? booking.total_paid ?? null;
                this.paymentAmountInput.value = paidAmount != null ? this.formatInputAmount(Number(paidAmount)) : '';
                this.paymentAmountInput.placeholder = 'Pago gestionado por pasarela';
            }
        }
        this.paymentAmountTouched = false;

        this.updateLeaderParticipant();
        this.updatePaymentUI();
        this.open();
    }

    // Modal Controls
    open() {
        this.modal?.classList.remove('hidden');
        this.modal?.classList.add('flex');
        document.body.style.overflow = 'hidden';

        // Ensure leader is added
        this.updateLeaderParticipant();
    }

    close() {
        this.modal?.classList.add('hidden');
        this.modal?.classList.remove('flex');
        document.body.style.overflow = '';
        this.reset();
    }

    reset() {
        this.participants = [];
        this.selectedChurch = null;
        this.currencyOverride = false;
        this.paymentAmountTouched = false;
        this.leaderDraft = null;
        this.idempotencyKey = null;
        this.lastSubmissionSignature = null;
        this.editingCompanionId = null;
        this.editBookingId = null;
        this.editPaymentId = null;
        this.isEditMode = false;
        this.canEditPayment = true;
        this.canDeleteBooking = false;
        this.paymentSummary = null;
        this.manualPayments = [];
        this.form?.reset();

        // Reset menus
        this.updateMenuOptions(this.leaderMenu, null);
        this.updateMenuOptions(this.companionMenu, null);

        if (this.currencySelect) {
            this.currency = this.normalizeCurrency(this.currencySelect.value);
        } else if (this.countryInput) {
            this.updateCurrencyFromCountry(this.countryInput.value);
        }
        this.renderParticipants();
        this.updateSummary();
        if (this.statusMsg) this.statusMsg.textContent = '';
        if (this.paymentAmountInput) {
            this.paymentAmountInput.placeholder = '0';
        }
        if (this.selectedChurchDisplay) {
            this.selectedChurchDisplay.textContent = 'Seleccionar iglesia...';
            this.selectedChurchDisplay.classList.add('text-slate-400');
            this.selectedChurchDisplay.classList.remove('text-[#293C74]', 'font-medium');
        }
        this.setModalMode(false);
    }

    setChurch(church) {
        this.selectedChurch = church;
        this.selectedChurchDisplay = document.getElementById('selected-church-display');
        this.selectedChurchId = document.getElementById('selected-church-id');
        const isManual = church.id === 'MANUAL';
        const isSpecial = Boolean(church.isSpecial) && !isManual;
        if (this.selectedChurchDisplay) {
            if (isManual) {
                this.selectedChurchDisplay.textContent = `Manual: ${church.manual_name || church.name}`;
            } else {
                const locationLabel = church.city || church.country || '';
                this.selectedChurchDisplay.textContent = locationLabel ? `${church.name} - ${locationLabel}` : `${church.name}`;
            }
            this.selectedChurchDisplay.classList.remove('text-slate-400');
            this.selectedChurchDisplay.classList.add('text-[#293C74]', 'font-medium');
        }
        if (this.selectedChurchId) {
            this.selectedChurchId.value = church.id;
        }

        // Auto-fill city and country
        if (!isManual && !isSpecial) {
            if (this.cityInput && church.city) this.cityInput.value = church.city;
            if (this.countryInput && church.country) this.countryInput.value = church.country;
            this.updateCurrencyFromCountry(church.country);
        }
    }
}
