import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildFinanceScopeFilter,
  financeScopeCanAccessRecord,
  normalizeFinanceCountryKey,
  resolveFinanceScopeAccess,
} from '../src/lib/financeScope.ts';
import {
  financeAssignmentScopeLabel,
  normalizeFinanceAssignmentInput,
} from '../src/lib/financeAssignments.ts';

const REGION_ANTIOQUIA = '11111111-1111-4111-8111-111111111111';
const REGION_CARIBE = '22222222-2222-4222-8222-222222222222';
const CHURCH_RIONEGRO = '33333333-3333-4333-8333-333333333333';
const CHURCH_BOGOTA = '44444444-4444-4444-8444-444444444444';
const FINANCE_SQL = readFileSync(new URL('../docs/sql/finance_scopes_hierarchy.sql', import.meta.url), 'utf8');

test('normaliza el país para comparar perfiles, iglesias y movimientos', () => {
  assert.equal(normalizeFinanceCountryKey('  Colômbia / Nacional  '), 'colombia-nacional');
  assert.equal(normalizeFinanceCountryKey('Estados Unidos'), 'estados-unidos');
});

test('mantiene acceso global legado para el rol principal finance sin asignaciones', () => {
  const access = resolveFinanceScopeAccess({ primaryRole: 'finance', assignments: [] });
  assert.equal(access.allowed, true);
  assert.equal(access.isGlobal, true);
  assert.equal(access.source, 'legacy-finance');
  assert.equal(buildFinanceScopeFilter(access), null);
});

test('una asignación explícita reemplaza el alcance global legado', () => {
  const access = resolveFinanceScopeAccess({
    primaryRole: 'finance',
    assignments: [{
      role: 'finance',
      status: 'active',
      scope_type: 'region',
      scope_id: REGION_ANTIOQUIA,
    }],
  });

  assert.equal(access.isGlobal, false);
  assert.deepEqual(access.regionIds, [REGION_ANTIOQUIA]);
  assert.match(buildFinanceScopeFilter(access) || '', /finance_region_id\.eq\.11111111/);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: 'colombia',
    finance_region_id: REGION_ANTIOQUIA,
    church_id: CHURCH_RIONEGRO,
  }), true);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: 'colombia',
    finance_region_id: REGION_CARIBE,
    church_id: CHURCH_BOGOTA,
  }), false);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'NATIONAL',
    finance_scope_country_key: 'colombia',
  }), false);
});

test('finanzas nacionales ve lo nacional y los niveles inferiores de su país', () => {
  const access = resolveFinanceScopeAccess({
    primaryRole: 'pastor',
    assignments: [{
      role: 'finance',
      status: 'active',
      scope_type: 'country',
      scope_key: 'Colombia',
    }],
  });

  assert.deepEqual(access.countryKeys, ['colombia']);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'NATIONAL',
    finance_scope_country_key: 'colombia',
  }), true);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: 'colombia',
    finance_region_id: REGION_ANTIOQUIA,
    church_id: CHURCH_RIONEGRO,
  }), true);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'GLOBAL',
  }), false);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'NATIONAL',
    finance_scope_country_key: 'peru',
  }), false);
});

test('finanzas locales solo ve movimientos LOCAL de la iglesia asignada', () => {
  const access = resolveFinanceScopeAccess({
    primaryRole: 'user',
    assignments: [{
      role: 'finance',
      status: 'active',
      scope_type: 'church',
      scope_id: CHURCH_RIONEGRO,
    }],
  });

  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: 'colombia',
    finance_region_id: REGION_ANTIOQUIA,
    church_id: CHURCH_RIONEGRO,
  }), true);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'NATIONAL',
    finance_scope_country_key: 'colombia',
    church_id: CHURCH_RIONEGRO,
  }), false);
  assert.equal(financeScopeCanAccessRecord(access, {
    finance_scope_type: 'LOCAL',
    finance_scope_country_key: 'colombia',
    finance_region_id: REGION_ANTIOQUIA,
    church_id: CHURCH_BOGOTA,
  }), false);
});

test('una asignación financiera incompleta falla cerrada', () => {
  const access = resolveFinanceScopeAccess({
    primaryRole: 'finance',
    assignments: [{
      role: 'finance',
      status: 'active',
      scope_type: 'country',
      scope_key: '',
    }],
  });

  assert.equal(access.allowed, false);
  assert.equal(access.hasAssignments, true);
  assert.equal(access.hasInvalidAssignments, true);
  assert.match(buildFinanceScopeFilter(access) || '', /00000000-0000/);
});

test('normaliza asignaciones financieras sin aceptar alcances ambiguos', () => {
  assert.deepEqual(normalizeFinanceAssignmentInput({
    userId: CHURCH_BOGOTA,
    scopeType: 'country',
    scopeKey: '  Colômbia  ',
    scopeId: REGION_ANTIOQUIA,
  }), {
    ok: true,
    value: {
      userId: CHURCH_BOGOTA,
      scopeType: 'country',
      scopeId: null,
      scopeKey: 'colombia',
    },
  });

  const invalidRegion = normalizeFinanceAssignmentInput({
    userId: CHURCH_BOGOTA,
    scopeType: 'region',
    scopeId: 'antioquia',
  });
  assert.equal(invalidRegion.ok, false);
  if (!invalidRegion.ok) assert.match(invalidRegion.error, /región/i);
});

test('describe cada alcance financiero con lenguaje operativo', () => {
  assert.equal(financeAssignmentScopeLabel({ scopeType: 'global' }), 'Global · todas las cuentas autorizadas');
  assert.equal(financeAssignmentScopeLabel({ scopeType: 'country', scopeKey: 'estados-unidos' }), 'Nacional · Estados Unidos');
  assert.equal(financeAssignmentScopeLabel({ scopeType: 'region', regionLabel: 'ANT · Antioquia' }), 'Regional · ANT · Antioquia');
  assert.equal(financeAssignmentScopeLabel({ scopeType: 'church', churchLabel: 'Maná Rionegro' }), 'Local · Maná Rionegro');
});

test('la migración financiera protege asignaciones y fija la propiedad de los proveedores', () => {
  assert.match(FINANCE_SQL, /alter table public\.portal_role_assignments enable row level security/i);
  assert.match(FINANCE_SQL, /revoke all on table public\.portal_role_assignments from anon, authenticated/i);
  assert.match(FINANCE_SQL, /provider_key = 'WOMPI'[\s\S]*finance_scope_type := 'NATIONAL'/i);
  assert.match(FINANCE_SQL, /provider_key = 'STRIPE'[\s\S]*finance_scope_type := 'GLOBAL'/i);
});
