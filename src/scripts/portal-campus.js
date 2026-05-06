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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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
            subtitleEl.textContent = 'Tus donantes para enviar agradecimientos';
        } else if (isAdmin) {
            subtitleEl.textContent = 'Solo donaciones Campus, con donante, monto y misionero';
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
            const donorName = escapeHtml(donor.name || 'Donante Anónimo');
            const donorEmail = escapeHtml(donor.email || '');
            const donorPhone = escapeHtml(donor.phone || '');
            const phoneDigits = String(donor.phone || '').replace(/\D/g, '');
            const thanksMessage = encodeURIComponent(`Hola ${donor.name || ''}, gracias por apoyar Campus Maná. Tu generosidad nos ayuda a seguir compartiendo el evangelio en las universidades.`);
            const contactActions = [
                donor.email ? `<a class="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 hover:border-slate-300" href="mailto:${encodeURIComponent(donor.email)}?subject=${encodeURIComponent('Gracias por apoyar Campus Maná')}&body=${thanksMessage}">Correo</a>` : '',
                phoneDigits.length >= 8 ? `<a class="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600" href="https://wa.me/${phoneDigits}?text=${thanksMessage}" target="_blank" rel="noreferrer">WhatsApp</a>` : ''
            ].filter(Boolean).join('');
            const donationLines = Array.isArray(donor.donations) && donor.donations.length
                ? `
                    <div class="mt-4 rounded-2xl bg-slate-50 p-4 space-y-2">
                        ${donor.donations.slice(0, 4).map((donation) => {
                            const date = donation.created_at ? new Date(donation.created_at).toLocaleDateString('es-CO') : '';
                            const names = donation.missionary?.names?.length
                                ? donation.missionary.names.join(', ')
                                : donation.missionary?.name || 'Campus';
                            const amount = isAdmin && donation.amount !== null
                                ? `<span class="font-bold text-brand-teal">${formatCurrency(donation.amount, donation.currency)}</span>`
                                : '';
                            const perMissionary = isAdmin && donation.amountPerMissionary
                                ? `<span class="text-slate-400">(${formatCurrency(donation.amountPerMissionary, donation.currency)} por misionero)</span>`
                                : '';
                            return `
                                <div class="flex flex-col gap-1 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
                                    <span><strong class="text-[#293C74]">${escapeHtml(names)}</strong> ${date ? `· ${escapeHtml(date)}` : ''}</span>
                                    <span>${amount} ${perMissionary}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `
                : '';

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
                                ${donorName.charAt(0).toUpperCase()}
                            </div>
                            
                            <!-- Donor Info -->
                            <div class="flex-1">
                                <h3 class="text-lg font-bold text-[#293C74] mb-1">${donorName}</h3>
                                ${donor.email ? `<p class="text-sm text-slate-600 mb-1">${donorEmail}</p>` : ''}
                                ${donor.phone ? `<p class="text-sm text-slate-500">${donorPhone}</p>` : ''}
                                
                                <div class="flex items-center gap-4 mt-3">
                                    <div class="text-xs text-slate-400">
                                        <span class="font-bold">${donor.donationCount}</span> donación${donor.donationCount > 1 ? 'es' : ''}
                                    </div>
                                    <div class="text-xs text-slate-400">
                                        Última: <span class="font-bold">${lastDonationDate}</span>
                                    </div>
                                </div>

                                ${donor.missionary?.name ? `
                                    <div class="mt-2">
                                        <span class="inline-flex items-center gap-1 px-3 py-1 bg-[#293C74]/10 text-[#293C74] rounded-full text-xs font-bold">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                            ${escapeHtml(donor.missionary.name)}
                                        </span>
                                    </div>
                                ` : ''}
                                ${contactActions ? `<div class="mt-4 flex flex-wrap gap-2">${contactActions}</div>` : ''}
                                ${donationLines}
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
