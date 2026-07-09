import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const BASE_URL = String(process.env.PORTAL_AUDIT_BASE_URL || 'https://ministeriomana.org').replace(/\/+$/, '');
const USERS_JSON = process.env.PORTAL_AUDIT_USERS || '';
const OUTPUT_DIR = process.env.PORTAL_AUDIT_OUTPUT_DIR || 'tmp';
const CHROME_PATH = process.env.PORTAL_UI_AUDIT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.PORTAL_UI_AUDIT_PORT || 9339);
const HEADLESS = process.env.PORTAL_UI_AUDIT_HEADLESS !== '0';
const PAGE_TIMEOUT_MS = Number(process.env.PORTAL_UI_AUDIT_PAGE_TIMEOUT_MS || 6000);
const SETTLE_MS = Number(process.env.PORTAL_UI_AUDIT_SETTLE_MS || 1800);
const WARN_PAGE_MS = Number(process.env.PORTAL_UI_AUDIT_WARN_PAGE_MS || 3000);
const CRITICAL_PAGE_MS = Number(process.env.PORTAL_UI_AUDIT_CRITICAL_PAGE_MS || 5000);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900, mobile: false },
  { key: 'mobile', width: 430, height: 932, mobile: true },
];

const MODULE_PAGES = [
  { key: 'home', label: 'Portal', path: '/portal', expected: () => true },
  { key: 'users', label: 'Usuarios', path: '/portal/users', expected: ({ permissions }) => Boolean(permissions?.can_manage_users) },
  {
    key: 'events',
    label: 'Eventos',
    path: '/portal/events',
    expected: ({ permissions }) => Boolean(
      permissions?.can_manage_local_events
        || permissions?.can_manage_regional_events
        || permissions?.can_manage_national_events
        || permissions?.can_manage_global_events
    ),
  },
  { key: 'campus', label: 'Campus', path: '/portal/campus', expected: ({ permissions }) => Boolean(permissions?.can_access_campus) },
  { key: 'donations', label: 'Donaciones', path: '/portal/donations', expected: ({ permissions }) => Boolean(permissions?.can_access_finances) },
  { key: 'finances', label: 'Finanzas', path: '/portal/finances', expected: ({ permissions }) => Boolean(permissions?.can_access_finances) },
  { key: 'prayers', label: 'Peticiones', path: '/portal/peticiones', expected: ({ permissions }) => Boolean(permissions?.can_access_prayers) },
  { key: 'regions', label: 'Regiones', path: '/portal/regions', expected: ({ role }) => ['admin', 'superadmin'].includes(role) },
  { key: 'content', label: 'Contenido', path: '/portal/content', expected: ({ role }) => ['admin', 'superadmin'].includes(role) },
];

const NAV_EXPECTATIONS = [
  { id: 'nav-link-users', key: 'users' },
  { id: 'nav-link-events', key: 'events' },
  { id: 'nav-link-campus', key: 'campus' },
  { id: 'nav-link-donations', key: 'donations' },
  { id: 'nav-link-finances', key: 'finances' },
  { id: 'nav-link-prayers', key: 'prayers' },
  { id: 'nav-link-regions', key: 'regions' },
  { id: 'nav-link-content', key: 'content' },
];

function parseUsers(raw) {
  if (!raw.trim()) {
    throw new Error('Falta PORTAL_AUDIT_USERS con un arreglo JSON de credenciales de prueba.');
  }
  const parsed = JSON.parse(raw);
  return parsed.map((user, index) => {
    const label = String(user.label || user.expectedRole || user.email || `user-${index + 1}`);
    const email = String(user.email || '').trim().toLowerCase();
    const password = String(user.password || '');
    if (!email || !password) throw new Error(`Credenciales incompletas para ${label}.`);
    return { label, email, password, expectedRole: user.expectedRole ? String(user.expectedRole) : null };
  });
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return email;
  return `${local.slice(0, 3)}***@${domain}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageKeyFromSupabaseUrl(url) {
  const host = new URL(url).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

function classifyTiming(ms) {
  if (ms >= CRITICAL_PAGE_MS) return 'critical';
  if (ms >= WARN_PAGE_MS) return 'slow';
  return 'ok';
}

async function waitForHttp(url, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Chrome no abrió puerto remoto ${url}`);
}

async function launchChrome() {
  const userDataDir = path.join('/tmp', `portal-ui-audit-${Date.now()}`);
  await fs.mkdir(userDataDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--window-size=1440,900',
  ];
  if (HEADLESS) args.push('--headless=new');

  const proc = spawn(CHROME_PATH, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  return {
    proc,
    userDataDir,
    close: async () => {
      proc.kill('SIGTERM');
      await sleep(300);
    },
  };
}

async function createTarget() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`No se pudo crear target Chrome: ${response.status}`);
  const target = await response.json();
  return target.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const handlers = this.events.get(message.method) || [];
        handlers.forEach((handler) => handler(message.params || {}));
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, PAGE_TIMEOUT_MS);
    });
  }

  on(method, handler) {
    const handlers = this.events.get(method) || [];
    handlers.push(handler);
    this.events.set(method, handlers);
  }

  async close() {
    await this.ready.catch(() => {});
    this.ws.close();
  }
}

async function createPage() {
  const wsUrl = await createTarget();
  const page = new CdpClient(wsUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  return page;
}

async function evaluate(page, expression, awaitPromise = true) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate exception');
  }
  return result.result?.value;
}

async function setViewport(page, viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.mobile ? 3 : 1,
    mobile: viewport.mobile,
  });
  await page.send('Emulation.setUserAgentOverride', {
    userAgent: viewport.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  });
}

async function navigate(page, url) {
  const started = performance.now();
  await page.send('Page.navigate', { url });
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < PAGE_TIMEOUT_MS) {
    try {
      const state = await evaluate(page, `document.readyState`, true);
      if (state === 'interactive' || state === 'complete') break;
    } catch {
      // The execution context can be briefly unavailable during navigation.
    }
    await sleep(100);
  }
  await sleep(SETTLE_MS);
  return Math.round(performance.now() - started);
}

async function waitUntilNotLoading(page, timeoutMs = 2500) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    lastState = await evaluate(page, `(() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const ownText = (el) => Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      const loadingTexts = Array.from(document.querySelectorAll('body *'))
        .filter(visible)
        .map(ownText)
        .filter((text) => /Cargando|Validando|Sincronizando/i.test(text));
      return { loadingTexts: Array.from(new Set(loadingTexts)).slice(0, 6) };
    })()`);
    if (!lastState?.loadingTexts?.length) break;
    await sleep(250);
  }
  return lastState;
}

async function installSession(page, session) {
  const key = storageKeyFromSupabaseUrl(supabaseUrl);
  await navigate(page, `${BASE_URL}/portal/ingresar`);
  await evaluate(page, `(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))});
    return true;
  })()`);
}

async function fetchPortalSession(token) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/api/portal/session`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    ok: response.ok && body?.ok !== false,
    elapsedMs: Math.round(performance.now() - started),
    body,
  };
}

async function signInUser(supabase, user) {
  const started = performance.now();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (error || !data?.session?.access_token) {
    return { ok: false, elapsedMs, error: error?.message || 'Sin access_token' };
  }
  return {
    ok: true,
    elapsedMs,
    session: data.session,
    token: data.session.access_token,
    userId: data.user?.id || null,
  };
}

function expectedForModule(key, context) {
  return MODULE_PAGES.find((page) => page.key === key)?.expected(context) ?? false;
}

async function collectUiState(page) {
  return evaluate(page, `(() => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const norm = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
    const ownText = (el) => Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const visibleOwnTexts = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map(ownText)
      .filter(Boolean);
    const visibleLoadingTexts = Array.from(new Set(
      visibleOwnTexts.filter((text) => /Cargando|Validando|Sincronizando/i.test(text))
    )).slice(0, 6);
    const nav = {};
    ${JSON.stringify(NAV_EXPECTATIONS.map((item) => item.id))}.forEach((id) => {
      const el = document.getElementById(id);
      nav[id] = Boolean(el && visible(el));
    });
    const buttons = Array.from(document.querySelectorAll('button, a[href]'))
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        text: norm(el.textContent).slice(0, 80),
        href: el.getAttribute('href') || '',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      }))
      .filter((item) => item.text || item.id || item.href)
      .slice(0, 80);
    const body = norm(document.body?.textContent || '');
    const visibleText = visibleOwnTexts.join(' ');
    return {
      href: location.href,
      pathname: location.pathname,
      title: document.title,
      nav,
      buttons,
      visibleLoading: visibleLoadingTexts.length > 0,
      visibleLoadingTexts,
      hasErrorText: /No autorizado|Forbidden|Error al|No se pudo|tard[oó] demasiado/i.test(visibleText),
      textSample: body.slice(0, 500),
      counts: {
        tables: document.querySelectorAll('table').length,
        rows: document.querySelectorAll('tbody tr').length,
        cards: document.querySelectorAll('article, [class*="card"], .rounded-2xl').length,
        inputs: document.querySelectorAll('input, select, textarea').length,
      },
      perf: (() => {
        const nav = performance.getEntriesByType('navigation')?.[0];
        if (!nav) return null;
        return {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize || 0,
          encodedBodySize: nav.encodedBodySize || 0,
        };
      })(),
    };
  })()`);
}

async function clickSafeControls(page, pageKey) {
  if (pageKey === 'users') {
    return evaluate(page, `async (() => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const open = document.getElementById('btn-open-create-user');
      if (!open || !visible(open)) return { tested: false, reason: 'create button hidden' };
      open.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const modal = document.getElementById('create-user-modal');
      const roleOptions = Array.from(document.querySelectorAll('#user-role-select option')).map((option) => option.value);
      const visibleModal = modal && !modal.classList.contains('hidden');
      document.getElementById('btn-cancel-create')?.click();
      return { tested: true, modalOpened: Boolean(visibleModal), roleOptions };
    })()`);
  }

  if (pageKey === 'events') {
    return evaluate(page, `async (() => {
      const open = document.getElementById('btn-new-event');
      if (!open) return { tested: false, reason: 'new event button missing' };
      const rect = open.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return { tested: false, reason: 'new event button hidden' };
      open.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const modal = document.getElementById('event-modal');
      const visibleModal = modal && !modal.classList.contains('hidden');
      document.getElementById('close-event-modal')?.click();
      return { tested: true, modalOpened: Boolean(visibleModal) };
    })()`);
  }

  if (pageKey === 'home') {
    return evaluate(page, `async (() => {
      const tabs = Array.from(document.querySelectorAll('[data-tab-trigger]')).slice(0, 3);
      const labels = [];
      for (const tab of tabs) {
        labels.push((tab.textContent || '').replace(/\\s+/g, ' ').trim());
        tab.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return { tested: true, tabs: labels };
    })()`);
  }

  return { tested: false, reason: 'no safe click routine' };
}

async function auditPageForUser(page, viewport, modulePage, context) {
  await setViewport(page, viewport);
  const expected = modulePage.expected(context);
  const elapsedMs = await navigate(page, `${BASE_URL}${modulePage.path}`);
  const loadingState = await waitUntilNotLoading(page);
  if (viewport.mobile) {
    await evaluate(page, `document.getElementById('sidebar-toggle')?.click(); true`);
    await sleep(150);
  }
  const state = await collectUiState(page);
  const safeClick = expected ? await clickSafeControls(page, modulePage.key).catch((error) => ({
    tested: false,
    error: error?.message || String(error),
  })) : { tested: false, reason: 'not expected for role' };
  const redirectedAway = state.pathname !== modulePage.path;
  const mismatch = expected
    ? redirectedAway || /No autorizado|Forbidden/i.test(state.textSample)
    : (!redirectedAway && !/No autorizado|Forbidden/i.test(state.textSample) && modulePage.key !== 'home');
  const loadingTexts = Array.from(new Set([
    ...(loadingState?.loadingTexts || []),
    ...(state.visibleLoadingTexts || []),
  ]));

  return {
    key: modulePage.key,
    label: modulePage.label,
    path: modulePage.path,
    viewport: viewport.key,
    expected: expected ? 'allow' : 'deny',
    elapsedMs,
    timing: classifyTiming(elapsedMs),
    redirectedAway,
    finalPath: state.pathname,
    title: state.title,
    visibleLoadingAfterWait: loadingTexts.length > 0,
    loadingTexts,
    hasErrorText: state.hasErrorText,
    counts: state.counts,
    perf: state.perf,
    nav: state.nav,
    buttons: state.buttons,
    safeClick,
    mismatch,
  };
}

function validateNav(pageResult, context) {
  const issues = [];
  if (pageResult.key !== 'home') return issues;
  for (const nav of NAV_EXPECTATIONS) {
    const expected = expectedForModule(nav.key, context);
    const visible = Boolean(pageResult.nav?.[nav.id]);
    if (visible !== expected) {
      issues.push({
        navId: nav.id,
        module: nav.key,
        expected,
        visible,
        viewport: pageResult.viewport,
      });
    }
  }
  return issues;
}

async function auditUser(supabase, browserPage, user) {
  const login = await signInUser(supabase, user);
  const result = {
    label: user.label,
    email: maskEmail(user.email),
    expectedRole: user.expectedRole,
    login: {
      ok: login.ok,
      elapsedMs: login.elapsedMs,
      error: login.error || null,
    },
    role: null,
    permissions: null,
    pages: [],
    navIssues: [],
    mismatches: [],
    slow: [],
  };
  console.error(`[ui-audit] ${user.label}: login`);
  if (!login.ok) {
    result.mismatches.push({ type: 'login', message: login.error });
    return result;
  }

  const sessionResponse = await fetchPortalSession(login.token);
  if (!sessionResponse.ok) {
    result.mismatches.push({ type: 'session', status: sessionResponse.status });
    return result;
  }
  const sessionBody = sessionResponse.body;
  const role = String(sessionBody?.profile?.effective_role || sessionBody?.profile?.role || 'user');
  const permissions = sessionBody?.permissions || {};
  result.role = role;
  result.permissions = permissions;
  if (user.expectedRole && user.expectedRole !== role) {
    result.mismatches.push({ type: 'role', expectedRole: user.expectedRole, actualRole: role });
  }

  await installSession(browserPage, login.session);
  const context = { role, permissions };
  console.error(`[ui-audit] ${user.label}: role=${role}`);

  for (const viewport of VIEWPORTS) {
    for (const modulePage of MODULE_PAGES) {
      console.error(`[ui-audit] ${user.label}: ${viewport.key} ${modulePage.path}`);
      const pageResult = await auditPageForUser(browserPage, viewport, modulePage, context);
      result.pages.push(pageResult);
      result.navIssues.push(...validateNav(pageResult, context));
      if (pageResult.mismatch) {
        result.mismatches.push({
          type: 'page',
          viewport: viewport.key,
          page: modulePage.key,
          expected: pageResult.expected,
          finalPath: pageResult.finalPath,
          hasErrorText: pageResult.hasErrorText,
        });
      }
      if (pageResult.timing !== 'ok') {
        result.slow.push({
          viewport: viewport.key,
          page: modulePage.key,
          elapsedMs: pageResult.elapsedMs,
          timing: pageResult.timing,
        });
      }
      if (pageResult.visibleLoadingAfterWait) {
        result.mismatches.push({
          type: 'stuck-loading',
          viewport: viewport.key,
          page: modulePage.key,
          loadingTexts: pageResult.loadingTexts,
        });
      }
    }
  }

  if (result.navIssues.length) {
    result.mismatches.push(...result.navIssues.map((issue) => ({ type: 'nav', ...issue })));
  }

  return result;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Auditoría UI Portal Maná');
  lines.push('');
  lines.push(`- Fecha: ${report.generatedAt}`);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Headless: ${report.headless}`);
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('| Usuario | Rol | Login ms | Páginas | Mismatches | Lentos |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const user of report.users) {
    lines.push(`| ${user.label} | ${user.role || '-'} | ${user.login.elapsedMs} | ${user.pages.length} | ${user.mismatches.length} | ${user.slow.length} |`);
  }
  lines.push('');
  lines.push('## Páginas');
  for (const user of report.users) {
    lines.push('');
    lines.push(`### ${user.label} (${user.role || 'sin rol'})`);
    if (user.login.error) {
      lines.push('');
      lines.push(`Login falló: ${user.login.error}`);
      continue;
    }
    lines.push('');
    lines.push('| Viewport | Página | Esperado | Final | ms | Loading | Botones | Click seguro |');
    lines.push('| --- | --- | --- | --- | ---: | --- | ---: | --- |');
    for (const page of user.pages) {
      const safe = page.safeClick?.tested
        ? `sí ${page.safeClick.modalOpened === undefined ? '' : `modal=${page.safeClick.modalOpened}`}`
        : `no`;
      lines.push(`| ${page.viewport} | ${page.label} | ${page.expected} | ${page.finalPath} | ${page.elapsedMs} | ${page.visibleLoadingAfterWait ? 'sí' : 'no'} | ${page.buttons.length} | ${safe} |`);
    }
  }
  if (report.allMismatches.length) {
    lines.push('');
    lines.push('## Hallazgos');
    for (const item of report.allMismatches) {
      lines.push(`- ${item.user}: ${item.type} ${item.page || item.module || ''} ${item.viewport || ''} ${JSON.stringify(item)}`);
    }
  }
  if (report.allSlow.length) {
    lines.push('');
    lines.push('## Lentos');
    for (const item of report.allSlow) {
      lines.push(`- ${item.user}: ${item.page} ${item.viewport} ${item.elapsedMs}ms (${item.timing})`);
    }
  }
  lines.push('');
  lines.push('> Auditoría no destructiva: no envía formularios, no borra, no bloquea, no cambia roles, no publica contenido y no envía correos.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Faltan PUBLIC_SUPABASE_URL/PUBLIC_SUPABASE_ANON_KEY o SUPABASE_URL/SUPABASE_ANON_KEY.');
  }
  const usersToAudit = parseUsers(USERS_JSON);
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const chrome = await launchChrome();
  const browserPage = await createPage();
  const users = [];
  try {
    for (const user of usersToAudit) {
      users.push(await auditUser(supabase, browserPage, user));
      await supabase.auth.signOut().catch(() => {});
    }
  } finally {
    await browserPage.close().catch(() => {});
    await chrome.close().catch(() => {});
  }

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    baseUrl: BASE_URL,
    headless: HEADLESS,
    thresholds: {
      warnPageMs: WARN_PAGE_MS,
      criticalPageMs: CRITICAL_PAGE_MS,
    },
    users,
    allMismatches: users.flatMap((user) => user.mismatches.map((item) => ({ user: user.label, ...item }))),
    allSlow: users.flatMap((user) => user.slow.map((item) => ({ user: user.label, ...item }))),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `portal-ui-audit-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `portal-ui-audit-${stamp}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');

  const summary = {
    generatedAt,
    jsonPath,
    mdPath,
    users: users.map((user) => ({
      label: user.label,
      role: user.role,
      loginMs: user.login.elapsedMs,
      pages: user.pages.length,
      mismatches: user.mismatches.length,
      slow: user.slow.length,
    })),
    allMismatches: report.allMismatches,
    allSlow: report.allSlow,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (report.allMismatches.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
