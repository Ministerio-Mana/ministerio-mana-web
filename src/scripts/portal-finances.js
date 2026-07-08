import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';

const statTotalCop = document.getElementById('stat-total-cop');
const statTotalUsd = document.getElementById('stat-total-usd');
const statTop = document.getElementById('stat-top-concept');
const loadingEl = document.getElementById('finances-loading');
const tableEl = document.getElementById('finances-table');
const emptyEl = document.getElementById('finances-empty');
const tbody = tableEl?.querySelector('tbody');
const categoriesEl = document.getElementById('finances-categories');
const issuesListEl = document.getElementById('finances-issues-list');
const issuesEmptyEl = document.getElementById('finances-issues-empty');

const REQUEST_TIMEOUT_MS = 15000;

const DEFAULT_CATEGORIES = [
    'Diezmos',
    'Ofrendas',
    'Misiones',
    'Campus',
    'Eventos',
    'Peregrinaciones',
    'General',
    'Otros'
];

function formatCurrency(val, currency) {
    return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-CO', {
        style: 'currency',
        currency: currency || 'COP',
        maximumFractionDigits: 0
    }).format(val || 0);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeMailtoEmail(value) {
    const email = String(value || '').trim();
    if (!email || /[\r\n<>"']/.test(email)) return '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function makeTimeoutError(label) {
    const error = new Error(`${label} tardó demasiado. Revisa tu conexión e intenta de nuevo.`);
    error.name = 'TimeoutError';
    return error;
}

async function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = window.setTimeout(() => reject(makeTimeoutError(label)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, label = 'La solicitud') {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({
            ok: false,
            error: 'El servidor respondió sin datos válidos.',
        }));
        return { res, data };
    } catch (err) {
        if (err?.name === 'AbortError') throw makeTimeoutError(label);
        throw err;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function setLoading(message = 'Cargando datos...') {
    if (!loadingEl) return;
    loadingEl.className = 'py-12 text-center text-slate-400 animate-pulse';
    loadingEl.textContent = message;
    loadingEl.classList.remove('hidden');
    tableEl?.classList.add('hidden');
    emptyEl?.classList.add('hidden');
}

function showLoadError(error) {
    if (!loadingEl) return;
    const message = error?.name === 'TimeoutError'
        ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
        : error?.message || 'No se pudieron cargar las finanzas.';
    loadingEl.className = 'py-12 text-center';
    loadingEl.innerHTML = `
        <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-red-700">
            <p class="font-bold mb-2">Error al cargar finanzas</p>
            <p class="text-sm">${escapeHtml(message)}</p>
            <button type="button" id="btn-retry-finances" class="mt-4 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm border border-red-100">
                Reintentar
            </button>
        </div>
    `;
    document.getElementById('btn-retry-finances')?.addEventListener('click', () => {
        void init();
    });
}

async function init() {
    setLoading();
    try {
        const auth = await withTimeout(ensureAuthenticated(), REQUEST_TIMEOUT_MS, 'La autenticación del portal');
        if (!auth.isAuthenticated) {
            redirectToLogin();
            return;
        }
        const token = auth.token;
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const { res, data } = await fetchJsonWithTimeout('/api/portal/finances', {
            headers,
            credentials: 'include'
        }, REQUEST_TIMEOUT_MS, 'La carga de finanzas');

        if (res.status === 403) {
            alert('No tienes permisos para ver finanzas.');
            window.location.href = '/portal';
            return;
        }

        if (!res.ok) throw new Error(data.error || 'Error de carga');

        renderDashboard(data);

    } catch (err) {
        console.error(err);
        showLoadError(err);
    }
}

function renderDashboard(data) {
    if (loadingEl) loadingEl.classList.add('hidden');

    // Stats
    const totalByCurrency = data.stats?.totalByCurrency || {};
    if (statTotalCop) statTotalCop.textContent = formatCurrency(totalByCurrency.COP || 0, 'COP');
    if (statTotalUsd) statTotalUsd.textContent = formatCurrency(totalByCurrency.USD || 0, 'USD');

    // Top Concept
    const byConcept = data.stats?.byCategory || data.stats?.byConcept || {};
    let topConcept = '-';
    let maxVal = 0;
    for (const [key, val] of Object.entries(byConcept)) {
        const numVal = typeof val === 'number'
            ? Number(val)
            : Number(val?.total || 0);
        if (numVal > maxVal) {
            maxVal = numVal;
            topConcept = key;
        }
    }
    if (statTop) statTop.textContent = maxVal > 0 ? topConcept : '-';

    renderCategories(byConcept);

    // Table
    const txs = data.transactions || [];
    if (txs.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
    } else {
        if (tableEl) tableEl.classList.remove('hidden');
        if (tbody) {
            tbody.innerHTML = txs.map(t => `
                <tr>
                    <td class="py-3 pl-2">${new Date(t.created_at).toLocaleDateString()}</td>
                    <td class="py-3 font-medium text-[#293C74]">${escapeHtml(t.concept_label || 'Aporte')}</td>
                    <td class="py-3 text-slate-500">${escapeHtml(t.donor_name || 'Anónimo')}</td>
                    <td class="py-3"><span class="px-2 py-1 rounded-full text-[10px] font-bold bg-green-100 text-green-700">${escapeHtml(t.status || 'APROBADO')}</span></td>
                    <td class="py-3 text-right font-bold pr-2">${formatCurrency(t.amount, t.currency)}</td>
                </tr>
            `).join('');
        }
    }

    renderIssues(data.issues || []);
}

function renderCategories(byCategory) {
    if (!categoriesEl) return;
        const entries = Object.entries(byCategory || {});
        const finalEntries = entries.length
            ? entries
            : DEFAULT_CATEGORIES.map((label) => [label, 0]);

    categoriesEl.innerHTML = finalEntries.map(([label, value]) => {
        const currencyMap = typeof value === 'number'
            ? { COP: Number(value) || 0 }
            : (value?.byCurrency || value || {});
        const copValue = Number(currencyMap.COP || 0);
        const usdValue = Number(currencyMap.USD || 0);
        const copLine = copValue ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(copValue, 'COP')}</span>` : '';
        const usdLine = usdValue ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(usdValue, 'USD')}</span>` : '';
        const emptyLine = (!copValue && !usdValue) ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(0, 'COP')}</span>` : '';
        return `
        <div class="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
            <p class="text-[10px] uppercase tracking-widest text-slate-400">${escapeHtml(label)}</p>
            <div class="mt-2 flex flex-col gap-1">
                ${copLine}
                ${usdLine}
                ${emptyLine}
            </div>
        </div>
    `;
    }).join('');
}

function renderIssues(issues) {
    if (!issuesListEl || !issuesEmptyEl) return;

    if (!issues.length) {
        issuesEmptyEl.classList.remove('hidden');
        issuesListEl.innerHTML = '';
        return;
    }

    issuesEmptyEl.classList.add('hidden');

    issuesListEl.innerHTML = issues.map((issue) => {
        const statusLabel = issue.status === 'FAILED' ? 'FALLIDO' : 'PENDIENTE';
        const statusClass = issue.status === 'FAILED'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700';

        const amount = formatCurrency(issue.amount || 0, issue.currency);
        const name = issue.donor_name || 'Sin nombre';
        const email = issue.donor_email || '';
        const mailtoEmail = sanitizeMailtoEmail(email);
        const phoneRaw = issue.donor_phone || '';
        const phone = phoneRaw.toString().replace(/\D/g, '');
        const reference = issue.reference ? `Ref: ${issue.reference}` : '';
        const provider = issue.provider ? issue.provider.toString().toUpperCase() : '';
        const reason = issue.reason || 'En verificación';
        const dateLabel = issue.created_at ? new Date(issue.created_at).toLocaleDateString() : '';

        const message = `Hola ${name}, tu pago ${issue.status === 'FAILED' ? 'fue rechazado' : 'esta pendiente'} por ${amount}. ${reason ? `Motivo: ${reason}. ` : ''}${reference ? `${reference}. ` : ''}Si ya esta resuelto, ignora este mensaje.`;
        const encodedMessage = encodeURIComponent(message);
        const mailto = mailtoEmail
            ? `mailto:${mailtoEmail}?subject=${encodeURIComponent(`Pago ${statusLabel} · ${issue.concept_label || 'Aporte'}`)}&body=${encodedMessage}`
            : '';
        const whatsapp = phone && phone.length >= 8
            ? `https://wa.me/${phone}?text=${encodedMessage}`
            : '';

        const actions = [
            mailto ? `<a class="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 hover:border-slate-300" href="${escapeHtml(mailto)}">Correo</a>` : '',
            whatsapp ? `<a class="px-3 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600" href="${whatsapp}" target="_blank" rel="noreferrer">WhatsApp</a>` : '',
            `<button class="px-3 py-1.5 rounded-full border border-slate-200 text-xs font-semibold text-slate-600 hover:border-slate-300" data-copy-text="${encodedMessage}">Copiar mensaje</button>`
        ].filter(Boolean).join('');

        return `
            <div class="border border-slate-100 rounded-2xl p-4 md:p-5">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-1 rounded-full text-[10px] font-bold ${statusClass}">${statusLabel}</span>
                            ${provider ? `<span class="text-[10px] uppercase tracking-widest text-slate-400">${escapeHtml(provider)}</span>` : ''}
                        </div>
                        <p class="text-base font-semibold text-slate-800 mt-2">${escapeHtml(name)}</p>
                        <p class="text-xs text-slate-400">${[email, phoneRaw].filter(Boolean).map(escapeHtml).join(' • ')}</p>
                    </div>
                    <div class="text-left md:text-right">
                        <p class="text-sm font-bold text-[#293C74]">${amount}</p>
                        <p class="text-xs text-slate-400">${escapeHtml(reference || dateLabel)}</p>
                    </div>
                </div>
                <div class="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Motivo: ${escapeHtml(reason)}
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                    ${actions}
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('[data-copy-text]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                const encoded = button.getAttribute('data-copy-text') || '';
                const text = decodeURIComponent(encoded);
                await navigator.clipboard.writeText(text);
                button.textContent = 'Copiado';
                setTimeout(() => {
                    button.textContent = 'Copiar mensaje';
                }, 1600);
            } catch (error) {
                console.error('No se pudo copiar el mensaje', error);
            }
        });
    });
}

init();
