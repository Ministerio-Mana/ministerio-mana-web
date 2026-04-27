// portal-campus.js - Campus Donor Management
import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const loadingEl = document.getElementById('donors-loading');
const contentEl = document.getElementById('donors-content');
const emptyEl = document.getElementById('donors-empty');
const subtitleEl = document.getElementById('campus-subtitle');
const adminStatsEl = document.getElementById('admin-stats');

// Stats elements (admins only)
const statTotalDonors = document.getElementById('stat-total-donors');
const statMonthDonations = document.getElementById('stat-month-donations');
const statActiveMissionaries = document.getElementById('stat-active-missionaries');

async function loadDonors() {
    try {
        const auth = await ensureAuthenticated();
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }
        const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
        const response = await fetch('/api/portal/campus/donors', {
            headers,
            credentials: 'include'
        });
        const data = await response.json();

        if (!data.ok) {
            throw new Error(data.error || 'Failed to load donors');
        }

        const { donors, stats, isAdmin, isCampusMissionary } = data;

        // Update subtitle based on role
        if (isCampusMissionary) {
            subtitleEl.textContent = 'Tus donantes y personas que te apoyan';
        } else if (isAdmin) {
            subtitleEl.textContent = 'Vista global de donantes y misioneros';
        }

        // Show admin stats if applicable
        if (isAdmin && stats) {
            adminStatsEl.classList.remove('hidden');
            statTotalDonors.textContent = stats.totalDonors || 0;
            statMonthDonations.textContent = formatCurrency(stats.totalAmount, stats.currency);
            statActiveMissionaries.textContent = stats.activeMissionaries || 0;
        }

        // Render donors
        if (!donors || donors.length === 0) {
            loadingEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            return;
        }

        contentEl.innerHTML = donors.map(donor => {
            const lastDonationDate = new Date(donor.lastDonation).toLocaleDateString('es-CO', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            // Only show amounts for admins
            const amountDisplay = isAdmin && donor.totalAmount !== null
                ? `
                    <div class="text-right">
                        <p class="text-xs text-slate-400 uppercase tracking-widest mb-1">Total Donado</p>
                        <p class="text-xl font-bold text-brand-teal">${formatCurrency(donor.totalAmount, donor.currency)}</p>
                    </div>
                `
                : '';

            return `
                <div class="p-6 border border-slate-100 rounded-2xl hover:shadow-md transition-all bg-white">
                    <div class="flex items-start justify-between gap-6">
                        <div class="flex items-start gap-4 flex-1">
                            <!-- Donor Avatar -->
                            <div class="w-14 h-14 rounded-full bg-gradient-to-br from-brand-teal to-[#293C74] flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                                ${donor.name.charAt(0).toUpperCase()}
                            </div>
                            
                            <!-- Donor Info -->
                            <div class="flex-1">
                                <h3 class="text-lg font-bold text-[#293C74] mb-1">${donor.name}</h3>
                                ${donor.email ? `<p class="text-sm text-slate-600 mb-1">${donor.email}</p>` : ''}
                                ${donor.phone ? `<p class="text-sm text-slate-500">${donor.phone}</p>` : ''}
                                
                                <div class="flex items-center gap-4 mt-3">
                                    <div class="text-xs text-slate-400">
                                        <span class="font-bold">${donor.donationCount}</span> donación${donor.donationCount > 1 ? 'es' : ''}
                                    </div>
                                    <div class="text-xs text-slate-400">
                                        Última: <span class="font-bold">${lastDonationDate}</span>
                                    </div>
                                </div>

                                ${isAdmin && donor.missionary?.name ? `
                                    <div class="mt-2">
                                        <span class="inline-flex items-center gap-1 px-3 py-1 bg-[#293C74]/10 text-[#293C74] rounded-full text-xs font-bold">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                            ${donor.missionary.name}
                                        </span>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        ${amountDisplay}
                    </div>
                </div>
            `;
        }).join('');

        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');

    } catch (error) {
        console.error('[campus] Error loading donors:', error);
        loadingEl.innerHTML = `
            <div class="text-red-500">
                <p class="font-bold mb-2">Error al cargar donantes</p>
                <p class="text-sm">${error.message}</p>
            </div>
        `;
    }
}

function formatCurrency(amount, currency) {
    if (!amount && amount !== 0) return '$0';
    const formatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    return formatter.format(amount);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadDonors();
});
