import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KNOWN_PORTAL_ROLES,
  PORTAL_ROLE_DEFINITIONS,
  PORTAL_ROLE_LABELS,
  getPortalRoleLabel,
  getRoleScope,
} from '../src/lib/portalRbac.ts';
import {
  filterPortalChurches,
  filterPortalRegions,
  findPortalCountry,
  listPortalCountries,
} from '../src/lib/portalGeography.ts';
import {
  hasExactProviderNet,
  normalizeStripeBalanceTransaction,
  normalizeWompiTransaction,
} from '../src/lib/providerReconciliation.ts';

test('mantiene roles, etiquetas y alcances en un único catálogo', () => {
  assert.equal(new Set(KNOWN_PORTAL_ROLES).size, PORTAL_ROLE_DEFINITIONS.length);
  assert.deepEqual(KNOWN_PORTAL_ROLES, PORTAL_ROLE_DEFINITIONS.map(({ role }) => role));
  assert.equal(PORTAL_ROLE_LABELS.finance, 'Equipo financiero');
  assert.equal(getPortalRoleLabel('regional_pastor'), 'Pastor regional');
  assert.equal(getRoleScope('national_collaborator'), 'country');
  assert.equal(getRoleScope('pastor'), 'church');
});

test('filtra país, región e iglesia en jerarquía sin duplicar países', () => {
  const regions = [
    { id: 'r1', country: 'Colombia', name: 'Antioquia', is_active: true },
    { id: 'r2', country: 'Francia', name: 'Île-de-France', is_active: true },
    { id: 'r3', country: 'Colombia', name: 'Inactiva', is_active: false },
  ];
  const churches = [
    { id: 'c1', region_id: 'r1', country: 'colombia', city: 'Medellín', name: 'Maná Medellín' },
    { id: 'c2', region_id: 'r2', country: 'Francia', city: 'París', name: 'Maná París' },
  ];
  assert.deepEqual(listPortalCountries(churches, regions), ['Colombia', 'Francia']);
  assert.equal(findPortalCountry('COLOMBIA', churches, regions), 'Colombia');
  assert.deepEqual(filterPortalRegions(regions, { country: 'Colombia' }).map(({ id }) => id), ['r1']);
  assert.deepEqual(filterPortalChurches(churches, { country: 'Francia', regionId: 'r2' }).map(({ id }) => id), ['c2']);
});

test('Stripe entrega neto exacto y Wompi requiere reporte de desembolso para completarlo', () => {
  const stripe = normalizeStripeBalanceTransaction({
    id: 'txn_123',
    currency: 'usd',
    amount: 10000,
    fee: 320,
    net: 9680,
  });
  assert.equal(hasExactProviderNet(stripe), true);
  assert.equal(stripe.netAmountMinor, 9680);

  const wompi = normalizeWompiTransaction({
    id: '1178211-1783194180-26798',
    currency: 'COP',
    amount_in_cents: 10000000,
  });
  assert.equal(wompi.grossAmountMinor, 10000000);
  assert.equal(wompi.netAmountMinor, null);
  assert.equal(hasExactProviderNet(wompi), false);
});
