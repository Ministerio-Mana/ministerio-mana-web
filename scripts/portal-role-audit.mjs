import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const BASE_URL = String(process.env.PORTAL_AUDIT_BASE_URL || 'https://ministeriomana.org').replace(/\/+$/, '');
const USERS_JSON = process.env.PORTAL_AUDIT_USERS || '';
const OUTPUT_DIR = process.env.PORTAL_AUDIT_OUTPUT_DIR || 'tmp';
const API_WARN_MS = Number(process.env.PORTAL_AUDIT_API_WARN_MS || 2500);
const API_FAIL_MS = Number(process.env.PORTAL_AUDIT_API_FAIL_MS || 5000);
const LOGIN_WARN_MS = Number(process.env.PORTAL_AUDIT_LOGIN_WARN_MS || 2500);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const ENDPOINTS = [
  {
    key: 'session',
    label: 'Sesión',
    method: 'GET',
    path: '/api/portal/session',
    expected: ({ authenticated }) => authenticated,
    summarize: (body) => ({
      role: body?.profile?.effective_role || body?.profile?.role || null,
      secondary_roles: body?.profile?.secondary_roles || [],
      scope: body?.scope || null,
      creatable_roles: body?.creatable_roles || [],
      permissions: body?.permissions || null,
    }),
  },
  {
    key: 'users',
    label: 'Usuarios',
    method: 'GET',
    path: '/api/portal/admin/users/list',
    expected: ({ permissions }) => Boolean(permissions?.can_manage_users),
    summarize: (body) => ({ count: Array.isArray(body?.users) ? body.users.length : null }),
  },
  {
    key: 'events',
    label: 'Gestión de Eventos',
    method: 'GET',
    path: '/api/portal/events',
    expected: ({ permissions }) => Boolean(
      permissions?.can_manage_local_events
        || permissions?.can_manage_regional_events
        || permissions?.can_manage_national_events
        || permissions?.can_manage_global_events
    ),
    summarize: (body) => ({ count: Array.isArray(body?.events) ? body.events.length : null }),
  },
  {
    key: 'regions',
    label: 'Regiones',
    method: 'GET',
    path: '/api/portal/regions',
    expected: ({ permissions }) => Boolean(permissions?.can_manage_users),
    summarize: (body) => ({ count: Array.isArray(body?.regions) ? body.regions.length : null }),
  },
  {
    key: 'campus',
    label: 'Campus',
    method: 'GET',
    path: '/api/portal/campus/donors',
    expected: ({ permissions }) => Boolean(permissions?.can_access_campus),
    summarize: (body) => ({
      donors: Array.isArray(body?.donors) ? body.donors.length : null,
      isAdmin: body?.isAdmin ?? null,
      isCampusMissionary: body?.isCampusMissionary ?? null,
    }),
  },
  {
    key: 'donations',
    label: 'Donaciones',
    method: 'GET',
    path: '/api/portal/donations?page=1&pageSize=25',
    expected: ({ permissions }) => Boolean(permissions?.can_access_finances),
    summarize: (body) => ({
      rows: Array.isArray(body?.donations) ? body.donations.length : null,
      totalRows: body?.pagination?.totalRows ?? body?.stats?.totalRows ?? null,
    }),
  },
  {
    key: 'finances',
    label: 'Finanzas',
    method: 'GET',
    path: '/api/portal/finances?page=1&pageSize=25&issuesPage=1&issuesPageSize=10',
    expected: ({ permissions }) => Boolean(permissions?.can_access_finances),
    summarize: (body) => ({
      transactions: Array.isArray(body?.transactions) ? body.transactions.length : null,
      issues: Array.isArray(body?.issues) ? body.issues.length : null,
      totalRows: body?.pagination?.totalRows ?? body?.transactionsPagination?.totalRows ?? null,
    }),
  },
  {
    key: 'prayers',
    label: 'Peticiones',
    method: 'GET',
    path: '/api/prayer/admin/list?status=all&visibility=all',
    expected: ({ permissions }) => Boolean(permissions?.can_access_prayers),
    summarize: (body) => ({
      rows: Array.isArray(body?.rows) ? body.rows.length : null,
      guardRole: body?.role || null,
    }),
  },
  {
    key: 'content',
    label: 'Contenido CMS',
    method: 'GET',
    path: '/api/portal/content/pages',
    expected: ({ role }) => ['superadmin', 'admin'].includes(role),
    summarize: (body) => ({
      pages: Array.isArray(body?.pages) ? body.pages.length : null,
      schemaReady: body?.schemaReady ?? null,
    }),
  },
];

const HTML_PAGES = [
  ['/portal/ingresar', 'Login'],
  ['/portal', 'Portal'],
  ['/portal/users', 'Usuarios'],
  ['/portal/events', 'Eventos'],
  ['/portal/campus', 'Campus'],
  ['/portal/donations', 'Donaciones'],
  ['/portal/finances', 'Finanzas'],
  ['/portal/peticiones', 'Peticiones'],
  ['/portal/regions', 'Regiones'],
  ['/portal/content', 'Contenido'],
];

function parseUsers(raw) {
  if (!raw.trim()) {
    throw new Error([
      'Falta PORTAL_AUDIT_USERS.',
      'Ejemplo:',
      'PORTAL_AUDIT_USERS=\'[{"label":"Admin","email":"admin@example.com","password":"***"}]\' node scripts/portal-role-audit.mjs',
    ].join('\n'));
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('PORTAL_AUDIT_USERS debe ser un arreglo JSON no vacío.');
  }
  return parsed.map((user, index) => {
    const label = String(user.label || user.expectedRole || user.email || `user-${index + 1}`);
    const email = String(user.email || '').trim().toLowerCase();
    const password = String(user.password || '');
    if (!email || !password) throw new Error(`Credenciales incompletas para ${label}.`);
    return {
      label,
      email,
      password,
      expectedRole: user.expectedRole ? String(user.expectedRole) : null,
    };
  });
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return email;
  return `${local.slice(0, 3)}***@${domain}`;
}

function statusExpectationMatches(status, shouldAllow) {
  if (shouldAllow) return status >= 200 && status < 300;
  return status === 401 || status === 403;
}

function classifyTiming(elapsedMs, warnMs = API_WARN_MS) {
  if (elapsedMs >= API_FAIL_MS) return 'critical';
  if (elapsedMs >= warnMs) return 'slow';
  return 'ok';
}

async function timedJsonFetch(url, options = {}) {
  const started = performance.now();
  let response;
  let text = '';
  let body = null;
  let error = null;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    text = await response.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  } catch (err) {
    error = err;
  }
  const elapsedMs = Math.round(performance.now() - started);
  return {
    status: response?.status ?? 0,
    ok: Boolean(response?.ok),
    elapsedMs,
    body,
    error: error ? String(error?.message || error) : null,
    bytes: Buffer.byteLength(text || ''),
  };
}

async function timedTextFetch(url, options = {}) {
  const started = performance.now();
  let response;
  let text = '';
  let error = null;
  try {
    response = await fetch(url, options);
    text = await response.text();
  } catch (err) {
    error = err;
  }
  const elapsedMs = Math.round(performance.now() - started);
  return {
    status: response?.status ?? 0,
    ok: Boolean(response?.ok),
    elapsedMs,
    error: error ? String(error?.message || error) : null,
    bytes: Buffer.byteLength(text || ''),
    title: (text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || '').trim(),
  };
}

async function signInUser(supabase, auditUser) {
  const started = performance.now();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: auditUser.email,
    password: auditUser.password,
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (error || !data?.session?.access_token) {
    return {
      ok: false,
      elapsedMs,
      error: error?.message || 'No se recibió access_token',
      token: null,
    };
  }
  return {
    ok: true,
    elapsedMs,
    error: null,
    token: data.session.access_token,
    userId: data.user?.id || null,
  };
}

async function auditUser(supabase, auditUser) {
  const login = await signInUser(supabase, auditUser);
  const result = {
    label: auditUser.label,
    email: maskEmail(auditUser.email),
    expectedRole: auditUser.expectedRole,
    login: {
      ok: login.ok,
      elapsedMs: login.elapsedMs,
      timing: classifyTiming(login.elapsedMs, LOGIN_WARN_MS),
      error: login.error,
    },
    role: null,
    permissions: null,
    endpoints: [],
    mismatches: [],
    slow: [],
  };

  if (!login.ok) {
    result.mismatches.push({
      endpoint: 'login',
      message: login.error,
    });
    return result;
  }

  const authHeaders = { Authorization: `Bearer ${login.token}` };

  let sessionContext = {
    authenticated: true,
    role: 'user',
    permissions: {},
  };

  for (const endpoint of ENDPOINTS) {
    const shouldAllow = endpoint.expected(sessionContext);
    const response = await timedJsonFetch(`${BASE_URL}${endpoint.path}`, {
      method: endpoint.method,
      headers: authHeaders,
    });
    const summary = endpoint.summarize(response.body);
    const timing = classifyTiming(response.elapsedMs);
    const matched = statusExpectationMatches(response.status, shouldAllow);
    const item = {
      key: endpoint.key,
      label: endpoint.label,
      path: endpoint.path,
      expected: shouldAllow ? 'allow' : 'deny',
      status: response.status,
      ok: response.ok,
      matched,
      elapsedMs: response.elapsedMs,
      timing,
      bytes: response.bytes,
      error: response.error || response.body?.error || null,
      summary,
    };
    result.endpoints.push(item);

    if (endpoint.key === 'session' && response.ok && response.body?.ok) {
      const role = String(response.body?.profile?.effective_role || response.body?.profile?.role || 'user');
      const permissions = response.body?.permissions || {};
      sessionContext = {
        authenticated: true,
        role,
        permissions,
      };
      result.role = role;
      result.permissions = permissions;
      if (auditUser.expectedRole && auditUser.expectedRole !== role) {
        result.mismatches.push({
          endpoint: 'session',
          expectedRole: auditUser.expectedRole,
          actualRole: role,
        });
      }
    }

    if (!matched) {
      result.mismatches.push({
        endpoint: endpoint.key,
        expected: item.expected,
        status: response.status,
        error: item.error,
      });
    }
    if (timing !== 'ok') {
      result.slow.push({
        endpoint: endpoint.key,
        elapsedMs: response.elapsedMs,
        timing,
      });
    }
  }

  return result;
}

async function auditHtmlPages() {
  const pages = [];
  for (const [pagePath, label] of HTML_PAGES) {
    const response = await timedTextFetch(`${BASE_URL}${pagePath}`, {
      headers: { accept: 'text/html' },
    });
    pages.push({
      label,
      path: pagePath,
      status: response.status,
      ok: response.ok,
      elapsedMs: response.elapsedMs,
      timing: classifyTiming(response.elapsedMs),
      bytes: response.bytes,
      title: response.title,
      error: response.error,
    });
  }
  return pages;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Auditoría Portal Maná`);
  lines.push('');
  lines.push(`- Fecha: ${report.generatedAt}`);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Usuarios auditados: ${report.users.length}`);
  lines.push('');

  lines.push(`## Resumen`);
  lines.push('');
  lines.push(`| Rol prueba | Rol detectado | Login ms | Mismatches | Lentos |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: |`);
  for (const user of report.users) {
    lines.push(`| ${user.label} | ${user.role || '-'} | ${user.login.elapsedMs} | ${user.mismatches.length} | ${user.slow.length} |`);
  }
  lines.push('');

  lines.push(`## Endpoints Por Rol`);
  for (const user of report.users) {
    lines.push('');
    lines.push(`### ${user.label} (${user.role || 'sin rol'})`);
    if (user.login.error) {
      lines.push('');
      lines.push(`Login falló: ${user.login.error}`);
      continue;
    }
    lines.push('');
    lines.push(`| Área | Esperado | Status | ms | Resultado | Resumen |`);
    lines.push(`| --- | --- | ---: | ---: | --- | --- |`);
    for (const endpoint of user.endpoints) {
      const result = endpoint.matched ? (endpoint.timing === 'ok' ? 'OK' : endpoint.timing) : 'REVISAR';
      const summary = JSON.stringify(endpoint.summary || {}).replace(/\|/g, '\\|');
      lines.push(`| ${endpoint.label} | ${endpoint.expected} | ${endpoint.status} | ${endpoint.elapsedMs} | ${result} | \`${summary}\` |`);
    }
  }

  lines.push('');
  lines.push(`## HTML Público`);
  lines.push('');
  lines.push(`| Página | Status | ms | KB | Title |`);
  lines.push(`| --- | ---: | ---: | ---: | --- |`);
  for (const page of report.htmlPages) {
    lines.push(`| ${page.label} | ${page.status} | ${page.elapsedMs} | ${(page.bytes / 1024).toFixed(1)} | ${page.title || '-'} |`);
  }

  if (report.allMismatches.length) {
    lines.push('');
    lines.push(`## Hallazgos`);
    for (const mismatch of report.allMismatches) {
      lines.push(`- ${mismatch.user}: ${mismatch.endpoint} esperado=${mismatch.expected ?? '-'} status=${mismatch.status ?? '-'} ${mismatch.message || mismatch.error || ''}`.trim());
    }
  }

  if (report.allSlow.length) {
    lines.push('');
    lines.push(`## Lentos`);
    for (const slow of report.allSlow) {
      lines.push(`- ${slow.user}: ${slow.endpoint} ${slow.elapsedMs}ms (${slow.timing})`);
    }
  }

  lines.push('');
  lines.push(`> Auditoría no destructiva: no crea, bloquea, borra, cambia roles, publica contenido ni envía correos.`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Faltan PUBLIC_SUPABASE_URL/PUBLIC_SUPABASE_ANON_KEY o SUPABASE_URL/SUPABASE_ANON_KEY.');
  }

  const auditUsers = parseUsers(USERS_JSON);
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const users = [];
  for (const user of auditUsers) {
    users.push(await auditUser(supabase, user));
    await supabase.auth.signOut().catch(() => {});
  }

  const htmlPages = await auditHtmlPages();
  const generatedAt = new Date().toISOString();
  const allMismatches = users.flatMap((user) => user.mismatches.map((item) => ({ user: user.label, ...item })));
  const allSlow = users.flatMap((user) => user.slow.map((item) => ({ user: user.label, ...item })));
  const report = {
    generatedAt,
    baseUrl: BASE_URL,
    thresholds: {
      apiWarnMs: API_WARN_MS,
      apiFailMs: API_FAIL_MS,
      loginWarnMs: LOGIN_WARN_MS,
    },
    users,
    htmlPages,
    allMismatches,
    allSlow,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `portal-role-audit-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `portal-role-audit-${stamp}.md`);
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
      mismatches: user.mismatches.length,
      slow: user.slow.length,
    })),
    htmlPages: htmlPages.map((page) => ({
      path: page.path,
      status: page.status,
      elapsedMs: page.elapsedMs,
      timing: page.timing,
    })),
    allMismatches,
    allSlow,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (allMismatches.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
