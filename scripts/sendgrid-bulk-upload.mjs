import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.sendgrid.com/v3';
const API_KEY = process.env.SENDGRID_API_KEY;
const PREFIX = process.env.SENDGRID_TEMPLATE_PREFIX ?? '';
const ROOT = process.cwd();
const TEMPLATE_DIR = path.join(ROOT, 'docs', 'email-templates', 'sendgrid');
const README_PATH = path.join(ROOT, 'docs', 'email-templates', 'README.md');
const OUTPUT_ENV = path.join(ROOT, 'sendgrid-ids.env');
const OUTPUT_JSON = path.join(ROOT, 'sendgrid-ids.json');

if (!API_KEY) {
  console.error('Missing SENDGRID_API_KEY env var. Example: SENDGRID_API_KEY=SG.xxxx node scripts/sendgrid-bulk-upload.mjs');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

async function sg(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`SendGrid API error ${res.status} ${res.statusText}`);
    err.response = json;
    throw err;
  }
  return json;
}

async function loadEnvMap() {
  const envMap = new Map();
  try {
    const content = await fs.readFile(README_PATH, 'utf8');
    const regex = /sendgrid\/([a-z0-9_]+\.html)[^|]*\|\s*`(SENDGRID_TEMPLATE_[A-Z0-9_]+)`/g;
    let match;
    while ((match = regex.exec(content))) {
      const file = match[1];
      const env = match[2];
      envMap.set(file, env);
    }
  } catch (err) {
    console.warn('Warning: could not read README mapping, will auto-generate env names.');
  }
  return envMap;
}

async function listTemplates() {
  const templates = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ generations: 'dynamic', page_size: '200' });
    if (pageToken) params.set('page_token', pageToken);
    const res = await sg(`/templates?${params.toString()}`);
    if (Array.isArray(res?.templates)) templates.push(...res.templates);
    pageToken = res?.next_page_token;
  } while (pageToken);
  return templates;
}

function toEnvName(file) {
  const base = path.basename(file, '.html');
  return `SENDGRID_TEMPLATE_${base.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
}

function templateNameFor(file) {
  const base = path.basename(file, '.html');
  return `${PREFIX}${base}`;
}

async function ensureTemplateId(name, templatesByName) {
  const existing = templatesByName.get(name);
  if (existing) return existing;
  const created = await sg('/templates', {
    method: 'POST',
    body: JSON.stringify({ name, generation: 'dynamic' }),
  });
  if (!created?.id) throw new Error(`Failed to create template: ${name}`);
  templatesByName.set(name, created.id);
  return created.id;
}

async function createVersion(templateId, html) {
  const versionName = `v${new Date().toISOString()}`;
  const payload = {
    name: versionName,
    subject: '{{subject}}',
    html_content: html,
    plain_content: '',
    active: 1,
  };
  await sg(`/templates/${templateId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function main() {
  const envMap = await loadEnvMap();
  const files = (await fs.readdir(TEMPLATE_DIR)).filter((f) => f.endsWith('.html'));
  if (!files.length) {
    console.error(`No HTML templates found in ${TEMPLATE_DIR}`);
    process.exit(1);
  }

  const existing = await listTemplates();
  const templatesByName = new Map(existing.map((t) => [t.name, t.id]));

  const envOut = {};
  const fileOut = {};
  const nameOut = {};

  for (const file of files) {
    const fullPath = path.join(TEMPLATE_DIR, file);
    const html = await fs.readFile(fullPath, 'utf8');
    const name = templateNameFor(file);
    const templateId = await ensureTemplateId(name, templatesByName);
    await createVersion(templateId, html);

    const envName = envMap.get(file) || toEnvName(file);
    envOut[envName] = templateId;
    fileOut[file] = templateId;
    nameOut[name] = templateId;

    console.log(`Uploaded: ${file} -> ${templateId}`);
  }

  const envLines = Object.entries(envOut)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(OUTPUT_ENV, `${envLines}\n`, 'utf8');
  await fs.writeFile(
    OUTPUT_JSON,
    JSON.stringify({ env: envOut, files: fileOut, names: nameOut }, null, 2),
    'utf8'
  );

  console.log(`\nDone. Wrote:`);
  console.log(`- ${path.relative(ROOT, OUTPUT_ENV)}`);
  console.log(`- ${path.relative(ROOT, OUTPUT_JSON)}`);
  if (PREFIX) {
    console.log(`Template prefix used: ${PREFIX}`);
  }
}

main().catch((err) => {
  console.error('Upload failed:', err?.message || err);
  if (err?.response) {
    console.error('SendGrid response:', JSON.stringify(err.response, null, 2));
  }
  process.exit(1);
});
