import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.PUBLIC_UI_AUDIT_BASE_URL || 'https://ministeriomana.org').replace(/\/+$/, '');
const chromePath = process.env.PUBLIC_UI_AUDIT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = Number(process.env.PUBLIC_UI_AUDIT_PORT || 9341);
const timeoutMs = Number(process.env.PUBLIC_UI_AUDIT_TIMEOUT_MS || 9000);
const settleMs = Number(process.env.PUBLIC_UI_AUDIT_SETTLE_MS || 1200);

const routes = String(process.env.PUBLIC_UI_AUDIT_ROUTES || [
  '/peticiones/',
  '/iglesias/',
  '/peregrinaciones/turquia-islas-griegas-2026',
  '/home-ministerio',
  '/campus/',
  '/devocional/',
].join(','))
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

const viewports = [
  { key: 'desktop', width: 1440, height: 900, mobile: false },
  { key: 'tablet', width: 768, height: 1024, mobile: false },
  { key: 'mobile', width: 390, height: 844, mobile: true },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForChrome() {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await sleep(120);
  }
  throw new Error('Chrome no abrió el puerto de auditoría.');
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Tiempo agotado en ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    this.socket.close();
  }
}

async function createPage() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`No se pudo abrir la pestaña: ${response.status}`);
  const target = await response.json();
  const page = new CdpClient(target.webSocketDebuggerUrl);
  await Promise.all([
    page.send('Page.enable'),
    page.send('Runtime.enable'),
    page.send('Network.enable'),
  ]);
  return page;
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Falló la evaluación del navegador.');
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
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  });
}

async function navigate(page, url) {
  const started = performance.now();
  await page.send('Page.navigate', { url });
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < timeoutMs) {
    try {
      const state = await evaluate(page, 'document.readyState');
      if (state === 'interactive' || state === 'complete') break;
    } catch {
      // The execution context changes during navigation.
    }
    await sleep(100);
  }
  await sleep(settleMs);
  return Math.round(performance.now() - started);
}

async function collectState(page) {
  return evaluate(page, `(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const labelFor = (element) => {
      if (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')) return true;
      if (element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]')) return true;
      return Boolean(element.closest('label'));
    };
    const targets = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], .leaflet-marker-icon'))
      .filter(visible)
      .map((element) => {
        const control = element.matches('input[type="radio"], input[type="checkbox"]') && element.closest('label')
          ? element.closest('label')
          : element;
        const rect = control.getBoundingClientRect();
        return {
          tag: control.tagName.toLowerCase(),
          text: String(element.getAttribute('aria-label') || element.getAttribute('alt') || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    const notes = Array.from(document.querySelectorAll('[data-prayer-card]')).filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, orientation: element.dataset.paperOrientation || '' };
    });
    const noteOverlaps = [];
    notes.forEach((first, index) => notes.slice(index + 1).forEach((second, secondIndex) => {
      if (first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y) {
        noteOverlaps.push([index, index + secondIndex + 1]);
      }
    }));
    return {
      title: document.title,
      path: location.pathname,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      headingOneCount: document.querySelectorAll('h1').length,
      brokenImages: Array.from(document.images).filter((image) => visible(image) && image.complete && image.naturalWidth === 0).length,
      imagesWithoutAlt: Array.from(document.images).filter((image) => !image.hasAttribute('alt')).length,
      fieldsWithoutLabels: Array.from(document.querySelectorAll('input, select, textarea')).filter((field) => visible(field) && !labelFor(field)).length,
      smallTargets: targets.filter((target) => target.width < 44 || target.height < 44).slice(0, 24),
      prayer: {
        notes: notes.length,
        orientations: Array.from(new Set(notes.map((note) => note.orientation).filter(Boolean))),
        undersized: notes.filter((note) => note.width < 44 || note.height < 44).length,
        overlaps: noteOverlaps,
      },
      churches: {
        map: document.querySelectorAll('.leaflet-container').length,
        markers: document.querySelectorAll('.leaflet-marker-icon').length,
        markersWithoutName: Array.from(document.querySelectorAll('.leaflet-marker-icon')).filter((marker) => !marker.getAttribute('aria-label') && !marker.getAttribute('alt')).length,
        cards: document.querySelectorAll('#churches-grid article').length,
      },
      story: {
        decks: document.querySelectorAll('[data-mana-story-deck]').length,
        scenes: document.querySelectorAll('[data-story-scene], [data-mana-story-scene], [data-cumbre-panel]').length,
      },
    };
  })()`);
}

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/mana-public-ui-audit-${Date.now()}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-extensions',
  '--disable-sync',
  '--window-size=1440,900',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let page;
try {
  await waitForChrome();
  page = await createPage();
  const results = [];
  for (const viewport of viewports) {
    await setViewport(page, viewport);
    for (const route of routes) {
      const elapsedMs = await navigate(page, `${baseUrl}${route}`);
      const state = await collectState(page);
      results.push({ route, viewport: viewport.key, elapsedMs, ...state });
    }
  }
  process.stdout.write(`${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
} finally {
  page?.close();
  chrome.kill('SIGTERM');
}
