#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.SENDGRID_API_KEY;
if (!apiKey) {
  console.error('Missing SENDGRID_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const outFlagIndex = args.indexOf('--out');
const outDir = outFlagIndex !== -1 && args[outFlagIndex + 1]
  ? args[outFlagIndex + 1]
  : 'sendgrid-export';

const headers = { Authorization: `Bearer ${apiKey}` };

async function requestJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid API error ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function safeName(input) {
  return String(input || 'template')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const index = await requestJson('https://api.sendgrid.com/v3/templates?generations=dynamic');
  const templates = index.templates || [];

  await fs.writeFile(
    path.join(outDir, 'templates.json'),
    JSON.stringify(templates, null, 2)
  );

  for (const tpl of templates) {
    const tplData = await requestJson(`https://api.sendgrid.com/v3/templates/${tpl.id}`);
    const tplName = safeName(tplData.name || tpl.name || tpl.id);
    const versions = tplData.versions || [];

    for (const v of versions) {
      const base = `${tplName}__${v.id}`;
      const htmlPath = path.join(outDir, `${base}.html`);
      const jsonPath = path.join(outDir, `${base}.json`);

      await fs.writeFile(htmlPath, v.html_content || '');
      await fs.writeFile(jsonPath, JSON.stringify(v, null, 2));
    }
  }

  console.log(`Export done → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
