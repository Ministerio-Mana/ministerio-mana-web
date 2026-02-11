// Church Selector Logic
export class ChurchSelector {
    constructor(churches = []) {
        this.allChurches = churches;
        this.filteredChurches = churches;
        this.selectedChurch = null;
        this.onSelectCallback = null;

        this.specialOptions = [
            { id: 'virtual', name: 'Ministerio Maná Virtual', city: '', country: '', isSpecial: true, isVirtual: true },
            { id: 'none', name: 'No asisto a ninguna iglesia', city: '', country: '', isSpecial: true },
            { id: 'other', name: 'Otra iglesia', city: '', country: '', isSpecial: true }
        ];

        this.init();
    }

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.populateFilters();
        this.render();
    }

    cacheDOM() {
        this.modal = document.getElementById('church-selector-modal');
        this.searchInput = document.getElementById('church-search-input');
        this.countryFilter = document.getElementById('church-country-filter');
        this.cityFilter = document.getElementById('church-city-filter');
        this.resultsList = document.getElementById('church-results-list');
        this.noResults = document.getElementById('church-no-results');
        this.loading = document.getElementById('church-loading');
        this.closeBtn = document.getElementById('close-church-selector');
        this.manualChurchContainer = document.getElementById('manual-church-container');
        this.manualChurchInput = document.getElementById('manual-church-input');
        this.manualChurchConfirm = document.getElementById('manual-church-confirm');
        this.specialBtns = this.modal?.querySelectorAll('.special-church-btn') || [];
    }

    bindEvents() {
        // Search with debounce
        let searchTimeout;
        this.searchInput?.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearch(e.target.value), 300);
        });

        // Filters
        this.countryFilter?.addEventListener('change', () => this.applyFilters());
        this.cityFilter?.addEventListener('change', () => this.applyFilters());

        // Special options
        this.specialBtns?.forEach(btn => {
            btn.addEventListener('click', () => {
                const specialId = btn.dataset.special;

                if (specialId === 'other') {
                    // Show manual input
                    if (this.manualChurchContainer) {
                        this.manualChurchContainer.classList.remove('hidden');
                        this.manualChurchInput?.focus();
                    }
                } else {
                    // Hide manual input for other options
                    if (this.manualChurchContainer) {
                        this.manualChurchContainer.classList.add('hidden');
                    }
                    const special = this.specialOptions.find(s => s.id === specialId);
                    if (special) this.selectChurch(special);
                }
            });
        });

        // Manual Church Confirm
        this.manualChurchConfirm?.addEventListener('click', () => this.handleManualSubmit());
        this.manualChurchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleManualSubmit();
        });

        // Close
        this.closeBtn?.addEventListener('click', () => this.close());
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    handleManualSubmit() {
        const value = this.manualChurchInput?.value?.trim();
        if (!value) {
            // Visual feedback for empty input
            if (this.manualChurchInput) {
                this.manualChurchInput.classList.add('border-red-400', 'bg-red-500/10');
                setTimeout(() => {
                    this.manualChurchInput.classList.remove('border-red-400', 'bg-red-500/10');
                }, 2000);
                this.manualChurchInput.focus();
            }
            return;
        }

        const manualChurch = {
            id: 'MANUAL',
            name: value, // Use the raw value as name for display
            city: 'Manual',
            country: 'Manual',
            isSpecial: true,
            isManual: true,
            manual_name: value
        };

        this.selectChurch(manualChurch);
    }

    populateFilters() {
        // Get unique countries
        const countries = [...new Set(this.allChurches.map(c => c.country))].filter(Boolean).sort();
        this.countryFilter.innerHTML = '<option value="">Todos los países</option>' +
            countries.map(c => `<option value="${c}">${c}</option>`).join('');

        // Cities will be populated based on country selection
        this.updateCityFilter();
    }

    updateCityFilter() {
        const selectedCountry = this.countryFilter?.value;
        let cities = [];

        if (selectedCountry) {
            cities = [...new Set(
                this.allChurches
                    .filter(c => c.country === selectedCountry)
                    .map(c => c.city)
            )].filter(Boolean).sort();
        } else {
            cities = [...new Set(this.allChurches.map(c => c.city))].filter(Boolean).sort();
        }

        this.cityFilter.innerHTML = '<option value="">Todas las ciudades</option>' +
            cities.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    handleSearch(query) {
        this.searchQuery = query.toLowerCase().trim();
        this.applyFilters();
    }

    applyFilters() {
        const country = this.countryFilter?.value;
        const city = this.cityFilter?.value;
        const query = this.searchQuery || '';

        this.filteredChurches = this.allChurches.filter(church => {
            // Country filter
            if (country && church.country !== country) return false;

            // City filter
            if (city && church.city !== city) return false;

            // Search query
            if (query) {
                const searchableText = `${church.name} ${church.city} ${church.country} ${church.address || ''}`.toLowerCase();
                if (!searchableText.includes(query)) return false;
            }

            return true;
        });

        // Update city filter options based on country
        if (country) this.updateCityFilter();

        this.render();
    }

    render() {
        if (!this.resultsList) return;

        if (this.filteredChurches.length === 0) {
            this.resultsList.innerHTML = '';
            this.noResults?.classList.remove('hidden');
            return;
        }

        this.noResults?.classList.add('hidden');

        // Virtual scrolling: render only visible items (simplified version)
        // For production, consider using a library like react-window or implement proper virtual scrolling
        const html = this.filteredChurches.map((church, index) => this.renderChurchItem(church, index)).join('');
        this.resultsList.innerHTML = html;

        // Bind click events
        this.resultsList.querySelectorAll('.church-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = Number(item.dataset.churchIndex);
                const churchId = item.dataset.churchId;
                const church = Number.isFinite(index) ? this.filteredChurches[index] : null;
                const resolved = church || this.filteredChurches.find(c => c.id === churchId);
                if (resolved) this.selectChurch(resolved);
            });
        });
    }

    renderChurchItem(church, index) {
        const isSelected = this.selectedChurch && this.selectedChurch.id === church.id;
        const locationParts = [church.city, church.country].filter(Boolean);
        const locationLabel = locationParts.length ? locationParts.join(' · ') : 'Ubicación por confirmar';
        return `
      <div class="church-item${isSelected ? ' selected' : ''}" data-church-id="${church.id}" data-church-index="${index}" role="button" tabindex="0">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <h4 class="font-bold text-white text-sm mb-1">${church.name}</h4>
            <p class="text-xs text-white/60">
              <span class="inline-flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                ${locationLabel}
              </span>
            </p>
            ${church.address ? `<p class="text-xs text-white/40 mt-1">${church.address}</p>` : ''}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    `;
    }

    selectChurch(church) {
        this.selectedChurch = church;
        if (this.onSelectCallback) {
            this.onSelectCallback(church);
        }
        this.close();
    }

    open() {
        this.modal?.classList.remove('hidden');
        this.modal?.classList.add('flex');
        document.body.style.overflow = 'hidden';
        this.searchInput?.focus();
    }

    close() {
        this.modal?.classList.add('hidden');
        this.modal?.classList.remove('flex');
        document.body.style.overflow = '';
    }

    onSelect(callback) {
        this.onSelectCallback = callback;
    }

    setChurches(churches) {
        this.allChurches = churches;
        this.filteredChurches = churches;
        this.populateFilters();
        this.render();
    }
}
