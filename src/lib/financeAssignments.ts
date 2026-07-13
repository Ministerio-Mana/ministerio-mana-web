import { isFinanceUuid, normalizeFinanceCountryKey } from './financeScope.ts';

export const FINANCE_ASSIGNMENT_SCOPE_TYPES = ['global', 'country', 'region', 'church'] as const;

export type FinanceAssignmentScopeType = typeof FINANCE_ASSIGNMENT_SCOPE_TYPES[number];

export type NormalizedFinanceAssignment = {
  userId: string;
  scopeType: FinanceAssignmentScopeType;
  scopeId: string | null;
  scopeKey: string | null;
};

type FinanceAssignmentValidation =
  | { ok: true; value: NormalizedFinanceAssignment }
  | { ok: false; error: string };

export function normalizeFinanceAssignmentInput(input: {
  userId?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  scopeKey?: unknown;
}): FinanceAssignmentValidation {
  const userId = String(input?.userId || '').trim().toLowerCase();
  const scopeType = String(input?.scopeType || '').trim().toLowerCase() as FinanceAssignmentScopeType;
  const scopeId = String(input?.scopeId || '').trim().toLowerCase();
  const scopeKey = normalizeFinanceCountryKey(String(input?.scopeKey || ''));

  if (!isFinanceUuid(userId)) return { ok: false, error: 'Usuario inválido.' };
  if (!FINANCE_ASSIGNMENT_SCOPE_TYPES.includes(scopeType)) {
    return { ok: false, error: 'Selecciona un alcance financiero válido.' };
  }

  if (scopeType === 'global') {
    return { ok: true, value: { userId, scopeType, scopeId: null, scopeKey: null } };
  }
  if (scopeType === 'country') {
    if (scopeKey.length < 2) return { ok: false, error: 'Selecciona el país del equipo financiero.' };
    return { ok: true, value: { userId, scopeType, scopeId: null, scopeKey } };
  }
  if (!isFinanceUuid(scopeId)) {
    return {
      ok: false,
      error: scopeType === 'region'
        ? 'Selecciona la región del equipo financiero.'
        : 'Selecciona la iglesia del equipo financiero.',
    };
  }

  return { ok: true, value: { userId, scopeType, scopeId, scopeKey: null } };
}

export function financeAssignmentScopeLabel(params: {
  scopeType?: string | null;
  scopeKey?: string | null;
  regionLabel?: string | null;
  churchLabel?: string | null;
}): string {
  const scopeType = String(params.scopeType || '').trim().toLowerCase();
  if (scopeType === 'global') return 'Global · todas las cuentas autorizadas';
  if (scopeType === 'country') {
    const country = String(params.scopeKey || '')
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return `Nacional · ${country || 'País'}`;
  }
  if (scopeType === 'region') return `Regional · ${params.regionLabel || 'Región asignada'}`;
  if (scopeType === 'church') return `Local · ${params.churchLabel || 'Iglesia asignada'}`;
  return 'Alcance sin identificar';
}
