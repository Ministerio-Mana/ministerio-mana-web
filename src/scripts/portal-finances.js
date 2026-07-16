import { ensureAuthenticated, redirectToLogin } from '@lib/portalAuthClient';
import { financeRecordOriginLabel } from '@lib/financeReporting';

const statTotalCop = document.getElementById('stat-total-cop');
const statTotalUsd = document.getElementById('stat-total-usd');
const statTransactionCount = document.getElementById('stat-transaction-count');
const gateEl = document.getElementById('finances-gate');
const secureContentEl = document.getElementById('finances-secure-content');
const loadingEl = document.getElementById('finances-loading');
const tableEl = document.getElementById('finances-table');
const emptyEl = document.getElementById('finances-empty');
const tbody = tableEl?.querySelector('tbody');
const categoriesEl = document.getElementById('finances-categories');
const issuesListEl = document.getElementById('finances-issues-list');
const issuesEmptyEl = document.getElementById('finances-issues-empty');
const pageInfoEl = document.getElementById('finances-page-info');
const loadMoreBtn = document.getElementById('finances-load-more');
const issuesPageInfoEl = document.getElementById('finances-issues-page-info');
const issuesLoadMoreBtn = document.getElementById('finances-issues-load-more');
const scopeLabelEl = document.getElementById('finances-scope-label');
const filtersForm = document.getElementById('finances-filters');
const periodFilter = document.getElementById('finances-period-filter');
const accountFilter = document.getElementById('finances-account-filter');
const currencyFilter = document.getElementById('finances-currency-filter');
const customDatesEl = document.getElementById('finances-custom-dates');
const dateFromFilter = document.getElementById('finances-date-from');
const dateToFilter = document.getElementById('finances-date-to');
const filterFeedbackEl = document.getElementById('finances-filter-feedback');
const filterSummaryEl = document.getElementById('finances-filter-summary');
const clearFiltersBtn = document.getElementById('finances-clear-filters');
const applyFiltersBtn = document.getElementById('finances-apply-filters');
const exportCopBtn = document.getElementById('finances-export-cop');
const exportUsdBtn = document.getElementById('finances-export-usd');
const reconciliationSection = document.getElementById('finance-reconciliation');
const reconciliationForm = document.getElementById('finance-reconciliation-form');
const reconciliationProvider = document.getElementById('finance-reconciliation-provider');
const reconciliationFile = document.getElementById('finance-reconciliation-file');
const reconciliationPreviewButton = document.getElementById('finance-reconciliation-preview-button');
const reconciliationFeedback = document.getElementById('finance-reconciliation-feedback');
const reconciliationPreview = document.getElementById('finance-reconciliation-preview');
const reconciliationPreviewTitle = document.getElementById('finance-reconciliation-preview-title');
const reconciliationPreviewMeta = document.getElementById('finance-reconciliation-preview-meta');
const reconciliationExactness = document.getElementById('finance-reconciliation-exactness');
const reconciliationTotals = document.getElementById('finance-reconciliation-totals');
const reconciliationWarnings = document.getElementById('finance-reconciliation-warnings');
const reconciliationCancel = document.getElementById('finance-reconciliation-cancel');
const reconciliationCommit = document.getElementById('finance-reconciliation-commit');

const REQUEST_TIMEOUT_MS = 15000;
const EXPORT_TIMEOUT_MS = 30000;
const TRANSACTIONS_PAGE_SIZE = 10;
const ISSUES_PAGE_SIZE = 10;
const DEFAULT_CATEGORIES = [
  'Diezmos',
  'Ofrendas',
  'Misiones',
  'Campus',
  'Eventos',
  'Peregrinaciones',
  'General',
  'Otros',
];

let currentAuthHeaders = {};
let transactionsPagination = createEmptyPagination(TRANSACTIONS_PAGE_SIZE);
let issuesPagination = createEmptyPagination(ISSUES_PAGE_SIZE);
let loadedTotalsByCurrency = {};
let loadedByCategory = createEmptyCategoryStats();
let loadedTransactionCount = 0;
let dataRevision = 0;
let transactionAppendSequence = 0;
let issuesAppendSequence = 0;
let reconciliationPreviewHash = '';

function createEmptyPagination(pageSize) {
  return {
    page: 1,
    pageSize,
    totalRows: 0,
    totalPages: 0,
    visibleFrom: 0,
    visibleTo: 0,
    hasNextPage: false,
  };
}

function createEmptyCategoryStats() {
  return Object.fromEntries(
    DEFAULT_CATEGORIES.map((label) => [label, { byCurrency: {} }]),
  );
}

function resetLoadedStats() {
  loadedTotalsByCurrency = {};
  loadedByCategory = createEmptyCategoryStats();
  loadedTransactionCount = 0;
}

function scopeLabel(scope = {}) {
  if (scope.is_global) return 'Alcance global';
  const countries = Array.isArray(scope.country_keys) ? scope.country_keys : [];
  const regions = Array.isArray(scope.region_ids) ? scope.region_ids : [];
  const churches = Array.isArray(scope.church_ids) ? scope.church_ids : [];
  if (countries.length) {
    const names = countries.map((value) => String(value).replace(/-/g, ' ')).join(', ');
    return `Alcance nacional · ${names}`;
  }
  if (regions.length) return `Alcance regional · ${regions.length} ${regions.length === 1 ? 'región' : 'regiones'}`;
  if (churches.length) return `Alcance local · ${churches.length} ${churches.length === 1 ? 'iglesia' : 'iglesias'}`;
  return 'Sin alcance financiero';
}

function formatCurrency(val, currency) {
  const normalizedCurrency = String(currency || 'COP').toUpperCase() === 'USD' ? 'USD' : 'COP';
  const fractionDigits = normalizedCurrency === 'USD' ? 2 : 0;
  return new Intl.NumberFormat(normalizedCurrency === 'USD' ? 'en-US' : 'es-CO', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(val || 0);
}

function formatMinorAmount(amountMinor, currency, exponent = 2) {
  if (amountMinor === null || amountMinor === undefined) return 'Pendiente';
  return formatCurrency(Number(amountMinor) / (10 ** Number(exponent || 0)), currency);
}

function setReconciliationFeedback(message = '', tone = 'error') {
  if (!reconciliationFeedback) return;
  if (!message) {
    reconciliationFeedback.textContent = '';
    reconciliationFeedback.className = 'mt-4 hidden rounded-md border px-4 py-4 text-sm';
    return;
  }
  const styles = tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-700';
  reconciliationFeedback.className = `mt-4 rounded-md border px-4 py-4 text-sm ${styles}`;
  reconciliationFeedback.textContent = message;
}

function resetReconciliationPreview({ focusFile = false } = {}) {
  reconciliationPreviewHash = '';
  reconciliationPreview?.classList.add('hidden');
  if (reconciliationCommit) {
    reconciliationCommit.disabled = true;
    reconciliationCommit.textContent = 'Importar reporte';
  }
  if (focusFile) window.requestAnimationFrame(() => reconciliationFile?.focus());
}

function configureReconciliationAccess(scope = {}) {
  const countries = Array.isArray(scope.country_keys) ? scope.country_keys : [];
  const canImportWompi = Boolean(scope.is_global || countries.includes('colombia'));
  const canImportStripe = Boolean(scope.is_global);
  reconciliationSection?.classList.toggle('hidden', !canImportWompi && !canImportStripe);
  const stripeOption = reconciliationProvider?.querySelector('option[value="STRIPE"]');
  if (stripeOption) stripeOption.disabled = !canImportStripe;
  if (!canImportStripe && reconciliationProvider?.value === 'STRIPE') reconciliationProvider.value = canImportWompi ? 'WOMPI' : 'AUTO';
}

function renderReconciliationPreview(data) {
  const preview = data?.preview || {};
  reconciliationPreviewHash = data?.canCommit ? String(preview.fileSha256 || '') : '';
  reconciliationPreview?.classList.remove('hidden');
  if (reconciliationPreviewTitle) {
    reconciliationPreviewTitle.textContent = `${preview.provider === 'WOMPI' ? 'Wompi' : 'Stripe'} · ${preview.sourceFileName || 'Reporte CSV'}`;
  }
  if (reconciliationPreviewMeta) {
    const rows = new Intl.NumberFormat('es-CO').format(Number(preview.rowCount || 0));
    const settlements = new Intl.NumberFormat('es-CO').format(Number(preview.settlementCount || 0));
    reconciliationPreviewMeta.textContent = `${rows} movimientos · ${settlements} abonos identificados · ${String(preview.periodStart || '').slice(0, 10)} a ${String(preview.periodEnd || '').slice(0, 10)}`;
  }
  if (reconciliationExactness) {
    const exact = Boolean(preview.exactNet);
    reconciliationExactness.className = exact
      ? 'w-fit rounded-full bg-emerald-100 px-4 py-2 text-xs font-bold text-emerald-800'
      : 'w-fit rounded-full bg-amber-100 px-4 py-2 text-xs font-bold text-amber-800';
    reconciliationExactness.textContent = exact ? 'Neto exacto del proveedor' : 'Neto pendiente';
  }
  if (reconciliationTotals) {
    reconciliationTotals.innerHTML = (preview.totals || []).map((total) => `
      <article class="rounded-md border border-slate-200 bg-white p-4">
        <p class="text-xs font-bold uppercase tracking-widest text-slate-500">${escapeHtml(total.currency)}</p>
        <dl class="mt-4 grid gap-4 text-sm">
          <div class="flex items-center justify-between gap-4"><dt class="text-slate-500">Bruto</dt><dd class="font-bold text-[#293C74]">${escapeHtml(formatMinorAmount(total.grossAmountMinor, total.currency, total.currencyExponent))}</dd></div>
          <div class="flex items-center justify-between gap-4"><dt class="text-slate-500">Comisión</dt><dd class="font-bold text-[#293C74]">${escapeHtml(formatMinorAmount(total.feeAmountMinor, total.currency, total.currencyExponent))}</dd></div>
          <div class="flex items-center justify-between gap-4 border-t border-slate-100 pt-4"><dt class="font-semibold text-slate-700">Neto</dt><dd class="font-bold text-emerald-800">${escapeHtml(formatMinorAmount(total.netAmountMinor, total.currency, total.currencyExponent))}</dd></div>
        </dl>
      </article>
    `).join('');
  }
  if (reconciliationWarnings) {
    reconciliationWarnings.innerHTML = (preview.warnings || []).map((warning) => `
      <p class="rounded-md border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">${escapeHtml(warning.message)}</p>
    `).join('');
  }
  if (reconciliationCommit) {
    reconciliationCommit.disabled = !data?.canCommit;
    reconciliationCommit.textContent = data?.duplicate ? 'Archivo ya importado' : 'Importar reporte';
  }
  if (data?.duplicate) {
    setReconciliationFeedback('Este mismo archivo ya fue importado. No se permitirá duplicarlo.', 'warning');
  } else {
    setReconciliationFeedback('Vista previa lista. Verifica bruto, comisión y neto antes de importar.', 'success');
  }
}

async function sendReconciliationReport(action) {
  const file = reconciliationFile?.files?.[0];
  if (!file) {
    setReconciliationFeedback('Selecciona un archivo CSV.');
    reconciliationFile?.focus();
    return;
  }
  const button = action === 'commit' ? reconciliationCommit : reconciliationPreviewButton;
  const originalText = button?.textContent || '';
  if (button) {
    button.disabled = true;
    button.textContent = action === 'commit' ? 'Importando…' : 'Revisando…';
  }
  setReconciliationFeedback();
  try {
    const form = new FormData();
    form.set('action', action);
    form.set('provider', reconciliationProvider?.value || 'AUTO');
    form.set('report', file);
    if (action === 'commit') form.set('confirmationSha256', reconciliationPreviewHash);
    const { res, data } = await fetchJsonWithTimeout('/api/portal/finance-reconciliation-import', {
      method: 'POST',
      headers: currentAuthHeaders,
      credentials: 'include',
      body: form,
    }, EXPORT_TIMEOUT_MS, action === 'commit' ? 'La importación' : 'La revisión del reporte');
    if (!res.ok || !data.ok) throw new Error(data.error || 'No fue posible procesar el reporte.');
    if (action === 'preview') {
      renderReconciliationPreview(data);
      window.requestAnimationFrame(() => reconciliationPreview?.focus?.());
      return;
    }
    reconciliationPreviewHash = '';
    if (reconciliationCommit) {
      reconciliationCommit.disabled = true;
      reconciliationCommit.textContent = 'Reporte importado';
    }
    setReconciliationFeedback(`Reporte importado sin cargas parciales: ${new Intl.NumberFormat('es-CO').format(Number(data?.result?.row_count || data?.preview?.rowCount || 0))} movimientos procesados.`, 'success');
  } catch (error) {
    setReconciliationFeedback(error?.message || 'No fue posible procesar el reporte.');
  } finally {
    if (button && !(action === 'commit' && !reconciliationPreviewHash)) {
      button.disabled = action === 'commit' ? !reconciliationPreviewHash : false;
      button.textContent = originalText;
    } else if (button && action === 'preview') {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
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

function appendFinanceFilterParams(params, { currencyOverride = '' } = {}) {
  const period = periodFilter?.value || 'all';
  const account = accountFilter?.value || '';
  const currency = currencyOverride || currencyFilter?.value || '';
  params.set('period', period);
  if (account) params.set('account', account);
  if (currency) params.set('currency', currency);
  if (period === 'custom') {
    if (dateFromFilter?.value) params.set('dateFrom', dateFromFilter.value);
    if (dateToFilter?.value) params.set('dateTo', dateToFilter.value);
  }
  return params;
}

function setFilterFeedback(message = '', tone = 'error') {
  if (!filterFeedbackEl) return;
  if (!message) {
    filterFeedbackEl.textContent = '';
    filterFeedbackEl.className = 'mt-4 hidden rounded-md px-4 py-4 text-sm';
    return;
  }
  const styles = tone === 'success'
    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border border-red-200 bg-red-50 text-red-700';
  filterFeedbackEl.className = `mt-4 rounded-md px-4 py-4 text-sm ${styles}`;
  filterFeedbackEl.textContent = message;
}

function validateFilters() {
  if (periodFilter?.value !== 'custom') return true;
  const from = dateFromFilter?.value || '';
  const to = dateToFilter?.value || '';
  if (!from || !to) {
    setFilterFeedback('Selecciona la fecha inicial y la fecha final.');
    return false;
  }
  if (from > to) {
    setFilterFeedback('La fecha inicial no puede ser posterior a la fecha final.');
    return false;
  }
  return true;
}

function updateCustomDatesVisibility() {
  const visible = periodFilter?.value === 'custom';
  customDatesEl?.classList.toggle('hidden', !visible);
  customDatesEl?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (dateFromFilter) dateFromFilter.required = visible;
  if (dateToFilter) dateToFilter.required = visible;
}

function optionLabel(select, fallback) {
  const option = select?.options?.[select.selectedIndex];
  return option?.textContent?.trim() || fallback;
}

function renderFilterSummary(filters = {}) {
  if (!filterSummaryEl) return;
  const periodLabel = optionLabel(periodFilter, 'Todo el historial');
  const accountLabel = optionLabel(accountFilter, 'Todas las cuentas autorizadas');
  const currencyLabel = filters.currency || currencyFilter?.value || '';
  const currencyText = currencyLabel ? `Solo ${currencyLabel}` : 'COP y USD separados';
  const dateText = filters.dateFrom && filters.dateTo
    ? `${filters.dateFrom} a ${filters.dateTo}`
    : periodLabel;
  filterSummaryEl.textContent = `${dateText} · ${accountLabel} · ${currencyText}`;
}

function exportFilenameFromResponse(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const candidate = match?.[1] || fallback;
  return candidate.replace(/[^a-zA-Z0-9._-]/g, '-') || fallback;
}

async function downloadFinanceExport(currency, button) {
  if (!validateFilters()) return;
  const originalText = button?.textContent || `Descargar CSV · ${currency}`;
  if (button) {
    button.disabled = true;
    button.textContent = `Preparando ${currency}...`;
  }
  setFilterFeedback();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
  try {
    const params = appendFinanceFilterParams(new URLSearchParams({ format: 'csv' }), {
      currencyOverride: currency,
    });
    const response = await fetch(`/api/portal/finances?${params.toString()}`, {
      headers: currentAuthHeaders,
      credentials: 'include',
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `No se pudo exportar ${currency}.`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = exportFilenameFromResponse(response, `finanzas-${currency.toLowerCase()}.csv`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setFilterFeedback(`Reporte ${currency} preparado. No contiene movimientos de otra moneda.`, 'success');
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'La exportación tardó demasiado. Selecciona un período más corto.'
      : error?.message || `No se pudo exportar ${currency}.`;
    setFilterFeedback(message);
  } finally {
    window.clearTimeout(timeoutId);
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function setLoading(message = 'Cargando datos...') {
  if (!loadingEl) return;
  gateEl?.classList.remove('hidden');
  secureContentEl?.classList.add('hidden');
  loadingEl.className = 'py-12 text-center text-slate-400 animate-pulse';
  loadingEl.textContent = message;
  loadingEl.classList.remove('hidden');
  tableEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');
  issuesEmptyEl?.classList.add('hidden');
  if (tbody) tbody.innerHTML = '';
  if (issuesListEl) issuesListEl.innerHTML = '';
  setLoadMoreState(false);
  setIssuesLoadMoreState(false);
  updatePaginationText();
  updateIssuesPaginationText();
}

function showLoadError(error) {
  if (!loadingEl) return;
  gateEl?.classList.remove('hidden');
  secureContentEl?.classList.add('hidden');
  const message = error?.name === 'TimeoutError'
    ? 'La carga tardó demasiado. Revisa la señal y vuelve a intentar.'
    : error?.message || 'No se pudieron cargar las finanzas.';
  loadingEl.className = 'py-12 text-center';
  loadingEl.innerHTML = `
    <div class="mx-auto max-w-md rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-red-700">
      <p class="font-bold mb-2">Error al cargar finanzas</p>
      <p class="text-sm">${escapeHtml(message)}</p>
      <button type="button" id="btn-retry-finances" class="mt-4 min-h-11 rounded-full border border-red-100 bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm">
        Reintentar
      </button>
    </div>
  `;
  document.getElementById('btn-retry-finances')?.addEventListener('click', () => {
    void loadFinances();
  });
}

function showForbidden() {
  gateEl?.classList.add('hidden');
  secureContentEl?.classList.add('hidden');
  tableEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');
  setLoadMoreState(false);
  setIssuesLoadMoreState(false);
  window.location.replace('/portal');
}

async function init() {
  setLoading();
  try {
    const auth = await withTimeout(ensureAuthenticated(), REQUEST_TIMEOUT_MS, 'La autenticación del portal');
    if (!auth.isAuthenticated) {
      redirectToLogin();
      return;
    }
    currentAuthHeaders = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    await loadFinances();
  } catch (err) {
    console.error(err);
    showLoadError(err);
  }
}

async function loadFinances({ appendTransactions = false, appendIssues = false } = {}) {
  const includeTransactions = !appendIssues;
  const includeIssues = !appendTransactions;
  const nextTransactionsPage = appendTransactions ? transactionsPagination.page + 1 : 1;
  const nextIssuesPage = appendIssues ? issuesPagination.page + 1 : 1;
  let requestRevision = dataRevision;
  let appendSequence = 0;

  if (!appendTransactions && !appendIssues) {
    requestRevision = ++dataRevision;
    transactionAppendSequence += 1;
    issuesAppendSequence += 1;
    resetLoadedStats();
    transactionsPagination = createEmptyPagination(TRANSACTIONS_PAGE_SIZE);
    issuesPagination = createEmptyPagination(ISSUES_PAGE_SIZE);
    setLoading();
  } else if (appendTransactions) {
    appendSequence = ++transactionAppendSequence;
    setLoadMoreState(true);
  } else if (appendIssues) {
    appendSequence = ++issuesAppendSequence;
    setIssuesLoadMoreState(true);
  }

  const isCurrentRequest = () => {
    if (requestRevision !== dataRevision) return false;
    if (appendTransactions) return appendSequence === transactionAppendSequence;
    if (appendIssues) return appendSequence === issuesAppendSequence;
    return true;
  };

  try {
    const params = new URLSearchParams({
      page: String(nextTransactionsPage),
      pageSize: String(TRANSACTIONS_PAGE_SIZE),
      issuesPage: String(nextIssuesPage),
      issuesPageSize: String(ISSUES_PAGE_SIZE),
      includeTransactions: includeTransactions ? 'true' : 'false',
      includeIssues: includeIssues ? 'true' : 'false',
    });
    appendFinanceFilterParams(params);

    const { res, data } = await fetchJsonWithTimeout(`/api/portal/finances?${params.toString()}`, {
      headers: currentAuthHeaders,
      credentials: 'include',
    }, REQUEST_TIMEOUT_MS, 'La carga de finanzas');

    if (res.status === 403) {
      showForbidden();
      return;
    }

    if (!res.ok || !data.ok) throw new Error(data.error || 'Error de carga');
    if (!isCurrentRequest()) return;

    renderDashboard(data, { appendTransactions, appendIssues, includeTransactions, includeIssues });
  } catch (err) {
    if (!isCurrentRequest()) return;
    console.error(err);
    if (appendTransactions) {
      setLoadMoreState(false);
      if (loadMoreBtn) loadMoreBtn.textContent = 'Reintentar carga';
      setFilterFeedback(err?.message || 'No se pudieron cargar más movimientos.');
      return;
    }
    if (appendIssues) {
      setIssuesLoadMoreState(false);
      if (issuesLoadMoreBtn) issuesLoadMoreBtn.textContent = 'Reintentar carga';
      setFilterFeedback(err?.message || 'No se pudieron cargar más alertas.');
      return;
    }
    showLoadError(err);
  }
}

function renderDashboard(data, options = {}) {
  const {
    appendTransactions = false,
    appendIssues = false,
    includeTransactions = true,
    includeIssues = true,
  } = options;

  if (loadingEl) loadingEl.classList.add('hidden');
  gateEl?.classList.add('hidden');
  secureContentEl?.classList.remove('hidden');
  if (scopeLabelEl) scopeLabelEl.textContent = scopeLabel(data.financeScope);
  configureReconciliationAccess(data.financeScope);
  renderFilterSummary(data.filters || {});

  if (includeTransactions) {
    mergeLoadedStats(data.stats || {});
    renderStats();
    renderCategories(loadedByCategory);
    renderTransactions(data.transactions || [], data.transactionsPagination || data.pagination || {}, { append: appendTransactions });
  }

  if (includeIssues) {
    renderIssues(data.issues || [], data.issuesPagination || {}, { append: appendIssues });
  }
}

function mergeLoadedStats(stats) {
  loadedTransactionCount += Number(stats.loadedRows || 0);
  Object.entries(stats.totalByCurrency || {}).forEach(([currency, amount]) => {
    const key = String(currency || 'COP').toUpperCase();
    loadedTotalsByCurrency[key] = (loadedTotalsByCurrency[key] || 0) + Number(amount || 0);
  });

  Object.entries(stats.byCategory || {}).forEach(([label, value]) => {
    const current = loadedByCategory[label] || { byCurrency: {} };
    const nextByCurrency = value?.byCurrency || {};
    Object.entries(nextByCurrency).forEach(([currency, amount]) => {
      const key = String(currency || 'COP').toUpperCase();
      current.byCurrency[key] = (current.byCurrency[key] || 0) + Number(amount || 0);
    });
    loadedByCategory[label] = current;
  });
}

function renderStats() {
  if (statTotalCop) statTotalCop.textContent = formatCurrency(loadedTotalsByCurrency.COP || 0, 'COP');
  if (statTotalUsd) statTotalUsd.textContent = formatCurrency(loadedTotalsByCurrency.USD || 0, 'USD');
  if (statTransactionCount) statTransactionCount.textContent = new Intl.NumberFormat('es-CO').format(loadedTransactionCount);
}

function renderTransactions(transactions, pagination, { append = false } = {}) {
  transactionsPagination = normalizePagination(
    pagination,
    transactions.length,
    transactionsPagination,
    append,
    TRANSACTIONS_PAGE_SIZE,
  );
  updatePaginationText();
  setLoadMoreState(false);

  if (!append && transactions.length === 0) {
    emptyEl?.classList.remove('hidden');
    tableEl?.classList.add('hidden');
    return;
  }

  if (tbody) {
    const rows = transactions.map((t) => `
      <tr>
        <td data-label="Fecha" class="py-4 pl-2">${formatDate(t.created_at)}</td>
        <td data-label="Concepto" class="py-4 font-medium text-[#293C74]">${escapeHtml(t.concept_label || 'Aporte')}</td>
        <td data-label="Donante" class="py-4 text-slate-500">${escapeHtml(t.donor_name || 'Anónimo')}</td>
        <td data-label="Cuenta" class="py-4 text-xs font-semibold text-slate-600">${escapeHtml(financeRecordOriginLabel(t))}</td>
        <td data-label="Estado" class="py-4"><span class="portal-chip bg-green-100 text-green-800">${escapeHtml(t.status || 'APROBADO')}</span></td>
        <td data-label="Monto" class="py-4 text-right font-bold pr-2">${formatCurrency(t.amount, t.currency)}</td>
      </tr>
    `).join('');

    if (append) {
      tbody.insertAdjacentHTML('beforeend', rows);
    } else {
      tbody.innerHTML = rows;
    }
  }

  tableEl?.classList.remove('hidden');
  emptyEl?.classList.add('hidden');
}

function normalizePagination(pagination, rowCount, current, append, fallbackPageSize) {
  const next = {
    page: Number(pagination.page || (append ? current.page + 1 : 1)),
    pageSize: Number(pagination.pageSize || current.pageSize || fallbackPageSize),
    totalRows: Number(pagination.totalRows || current.totalRows || rowCount || 0),
    totalPages: Number(pagination.totalPages || current.totalPages || 0),
    visibleFrom: append
      ? Number(current.visibleFrom || pagination.visibleFrom || 0)
      : Number(pagination.visibleFrom || 0),
    visibleTo: Number(pagination.visibleTo || (append ? current.visibleTo + rowCount : rowCount)),
    hasNextPage: Boolean(pagination.hasNextPage),
  };
  return next;
}

function updatePaginationText() {
  if (!pageInfoEl) return;
  if (!transactionsPagination.totalRows) {
    pageInfoEl.textContent = 'Sin registros para mostrar';
    return;
  }
  pageInfoEl.textContent = `Mostrando ${transactionsPagination.visibleFrom}-${transactionsPagination.visibleTo} de ${transactionsPagination.totalRows}`;
}

function setLoadMoreState(isLoading = false) {
  if (!loadMoreBtn) return;
  loadMoreBtn.classList.toggle('hidden', !transactionsPagination.hasNextPage && !isLoading);
  loadMoreBtn.disabled = isLoading;
  loadMoreBtn.textContent = isLoading ? 'Cargando...' : 'Cargar más';
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function renderCategories(byCategory) {
  if (!categoriesEl) return;
  const entries = Object.entries(byCategory || {});
  const finalEntries = entries.length
    ? entries
    : DEFAULT_CATEGORIES.map((label) => [label, { byCurrency: {} }]);

  categoriesEl.innerHTML = finalEntries.map(([label, value]) => {
    const currencyMap = value?.byCurrency || {};
    const copValue = Number(currencyMap.COP || 0);
    const usdValue = Number(currencyMap.USD || 0);
    const copLine = copValue ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(copValue, 'COP')}</span>` : '';
    const usdLine = usdValue ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(usdValue, 'USD')}</span>` : '';
    const emptyLine = (!copValue && !usdValue) ? `<span class="text-sm font-bold text-[#293C74]">${formatCurrency(0, 'COP')}</span>` : '';
    return `
      <div class="rounded-md border border-slate-200 bg-slate-50/70 p-4">
        <p class="text-xs font-bold uppercase text-slate-500">${escapeHtml(label)}</p>
        <div class="mt-2 flex flex-col gap-2">
          ${copLine}
          ${usdLine}
          ${emptyLine}
        </div>
      </div>
    `;
  }).join('');
}

function renderIssues(issues, pagination, { append = false } = {}) {
  if (!issuesListEl || !issuesEmptyEl) return;

  issuesPagination = normalizePagination(
    pagination,
    issues.length,
    issuesPagination,
    append,
    ISSUES_PAGE_SIZE,
  );
  updateIssuesPaginationText();
  setIssuesLoadMoreState(false);

  if (!append && !issues.length) {
    issuesEmptyEl.classList.remove('hidden');
    issuesListEl.innerHTML = '';
    return;
  }

  if (issues.length) issuesEmptyEl.classList.add('hidden');
  const html = issues.map(issueCardHtml).join('');
  if (append) {
    issuesListEl.insertAdjacentHTML('beforeend', html);
  } else {
    issuesListEl.innerHTML = html;
  }
  bindCopyButtons();
}

function updateIssuesPaginationText() {
  if (!issuesPageInfoEl) return;
  if (!issuesPagination.totalRows) {
    issuesPageInfoEl.textContent = 'Sin alertas';
    return;
  }
  issuesPageInfoEl.textContent = `Alertas ${issuesPagination.visibleFrom}-${issuesPagination.visibleTo} de ${issuesPagination.totalRows}`;
}

function setIssuesLoadMoreState(isLoading = false) {
  if (!issuesLoadMoreBtn) return;
  issuesLoadMoreBtn.classList.toggle('hidden', !issuesPagination.hasNextPage && !isLoading);
  issuesLoadMoreBtn.disabled = isLoading;
  issuesLoadMoreBtn.textContent = isLoading ? 'Cargando...' : 'Cargar más alertas';
}

function issueCardHtml(issue) {
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
  const provider = financeRecordOriginLabel(issue);
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
    mailto ? `<a class="inline-flex min-h-11 items-center rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300" href="${escapeHtml(mailto)}">Correo</a>` : '',
    whatsapp ? `<a class="inline-flex min-h-11 items-center rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '',
    `<button type="button" class="min-h-11 rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300" data-copy-text="${encodedMessage}">Copiar mensaje</button>`,
  ].filter(Boolean).join('');

  return `
    <div class="rounded-md border border-slate-200 p-4">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="portal-chip ${statusClass}">${statusLabel}</span>
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
      <div class="mt-4 border-l-2 border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
        Motivo: ${escapeHtml(reason)}
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        ${actions}
      </div>
    </div>
  `;
}

function bindCopyButtons() {
  document.querySelectorAll('[data-copy-text]').forEach((button) => {
    if (button.dataset.copyBound === '1') return;
    button.dataset.copyBound = '1';
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

loadMoreBtn?.addEventListener('click', () => {
  void loadFinances({ appendTransactions: true });
});

issuesLoadMoreBtn?.addEventListener('click', () => {
  void loadFinances({ appendIssues: true });
});

periodFilter?.addEventListener('change', () => {
  updateCustomDatesVisibility();
  setFilterFeedback();
});

filtersForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validateFilters()) return;
  const originalText = applyFiltersBtn?.textContent || 'Aplicar filtros';
  if (applyFiltersBtn) {
    applyFiltersBtn.disabled = true;
    applyFiltersBtn.textContent = 'Aplicando...';
  }
  setFilterFeedback();
  try {
    await loadFinances();
  } finally {
    if (applyFiltersBtn) {
      applyFiltersBtn.disabled = false;
      applyFiltersBtn.textContent = originalText;
      window.requestAnimationFrame(() => applyFiltersBtn.focus());
    }
  }
});

clearFiltersBtn?.addEventListener('click', async () => {
  const originalText = clearFiltersBtn.textContent;
  clearFiltersBtn.disabled = true;
  clearFiltersBtn.textContent = 'Limpiando…';
  if (periodFilter) periodFilter.value = 'all';
  if (accountFilter) accountFilter.value = '';
  if (currencyFilter) currencyFilter.value = '';
  if (dateFromFilter) dateFromFilter.value = '';
  if (dateToFilter) dateToFilter.value = '';
  updateCustomDatesVisibility();
  setFilterFeedback();
  try {
    await loadFinances();
  } finally {
    clearFiltersBtn.disabled = false;
    clearFiltersBtn.textContent = originalText;
    window.requestAnimationFrame(() => clearFiltersBtn.focus());
  }
});

exportCopBtn?.addEventListener('click', () => {
  void downloadFinanceExport('COP', exportCopBtn);
});

exportUsdBtn?.addEventListener('click', () => {
  void downloadFinanceExport('USD', exportUsdBtn);
});

reconciliationForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  resetReconciliationPreview();
  void sendReconciliationReport('preview');
});

reconciliationCommit?.addEventListener('click', () => {
  if (!reconciliationPreviewHash) {
    setReconciliationFeedback('Vuelve a revisar el archivo antes de importarlo.');
    return;
  }
  void sendReconciliationReport('commit');
});

reconciliationCancel?.addEventListener('click', () => {
  resetReconciliationPreview({ focusFile: true });
  setReconciliationFeedback();
});

reconciliationFile?.addEventListener('change', () => {
  resetReconciliationPreview();
  setReconciliationFeedback();
});

reconciliationProvider?.addEventListener('change', () => {
  resetReconciliationPreview();
  setReconciliationFeedback();
});

updateCustomDatesVisibility();
init();
