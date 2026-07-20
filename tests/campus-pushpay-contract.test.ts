import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MISIONEROS } from '../src/data/misioneros.ts';

const EXPECTED_PUSHPAY_LINKS = new Map([
  ['amaury-padilla', 'https://ppay.co/kTQL9jo0ulA'],
  ['ariel-guzman', 'https://ppay.co/3Zvh5mQk2bI'],
  ['leidy-gaviria', 'https://ppay.co/ArPBqCx0Ras'],
  ['maria-camila-rios', 'https://ppay.co/IdG9WhlsxDs'],
  ['oscar-hernandez', 'https://ppay.co/XbQ7em0s1sA'],
  ['rocio-nino', 'https://ppay.co/9l7CieVtH4M'],
]);

test('asigna un enlace Pushpay oficial, único y estable a cada misionero', () => {
  assert.equal(MISIONEROS.length, EXPECTED_PUSHPAY_LINKS.size);
  assert.deepEqual(
    new Set(MISIONEROS.map((missionary) => missionary.pushpayUrl)).size,
    MISIONEROS.length,
  );

  for (const missionary of MISIONEROS) {
    assert.equal(missionary.pushpayUrl, EXPECTED_PUSHPAY_LINKS.get(missionary.slug));
    assert.match(missionary.pushpayUrl || '', /^https:\/\/ppay\.co\/[A-Za-z0-9]+$/);
  }
});

test('Pushpay es una alternativa USD accesible y no reemplaza el checkout existente', async () => {
  const [formSource, scriptSource] = await Promise.all([
    readFile(new URL('../src/components/campus/DonationForm.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/campus-donation.js', import.meta.url), 'utf8'),
  ]);

  assert.match(formSource, /pushpay-option/);
  assert.match(formSource, /min-h-11/);
  assert.match(formSource, /target="_blank"/);
  assert.match(formSource, /rel="noopener noreferrer external"/);
  assert.match(scriptSource, /this\.currency !== 'USD'/);
  assert.match(scriptSource, /fetch\('\/api\/campus\/checkout'/);
  assert.doesNotMatch(formSource, /embedded\.pushpay\.com/);
});
