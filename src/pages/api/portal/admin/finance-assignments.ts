import type { APIRoute } from 'astro';
import {
  financeAssignmentScopeLabel,
  normalizeFinanceAssignmentInput,
} from '@lib/financeAssignments';
import { isFinanceUuid } from '@lib/financeScope';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { ensureUserProfile } from '@lib/portalAuth';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';

export const prerender = false;

type AdminContext = {
  ok: boolean;
  status: number;
  error: string;
  userId: string | null;
};

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
    },
  });
}

function isMissingFinanceHierarchy(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01'
    || code === '42703'
    || message.includes('portal_role_assignments')
    || message.includes('finance_scope_type')
    || message.includes('finance_scope_country_key')
    || message.includes('finance_region_id');
}

async function getAdminContext(request: Request): Promise<AdminContext> {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    return {
      ok: false,
      status: 403,
      error: 'Esta función requiere una cuenta individual de superadmin.',
      userId: null,
    };
  }
  const profile = await ensureUserProfile(user);
  if (!profile || String(profile.role || '').toLowerCase() !== 'superadmin') {
    return { ok: false, status: 403, error: 'Solo superadmin puede administrar Finanzas.', userId: user.id };
  }
  return { ok: true, status: 200, error: '', userId: user.id };
}

async function authorize(request: Request, clientAddress?: string) {
  const ipCheck = await enforceAdminIp({
    request,
    clientAddress,
    identifier: 'portal.admin.finance-assignments',
    allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
  });
  if (!ipCheck.ok) return { response: json({ ok: false, error: 'No autorizado.' }, 403), ctx: null };
  const ctx = await getAdminContext(request);
  if (!ctx.ok) return { response: json({ ok: false, error: ctx.error }, ctx.status), ctx: null };
  return { response: null, ctx };
}

async function isHierarchyReady(): Promise<{ ready: boolean; error?: any }> {
  if (!supabaseAdmin) return { ready: false };
  const { error } = await supabaseAdmin
    .from('donations')
    .select('finance_scope_type,finance_scope_country_key,finance_region_id', { head: true })
    .limit(1);
  if (!error) return { ready: true };
  if (isMissingFinanceHierarchy(error)) return { ready: false };
  return { ready: false, error };
}

async function loadTargetProfile(userId: string) {
  if (!supabaseAdmin) return { data: null, error: new Error('Supabase no configurado.') };
  return supabaseAdmin
    .from('user_profiles')
    .select('user_id,email,full_name,first_name,last_name,role')
    .eq('user_id', userId)
    .maybeSingle();
}

async function listAssignments(userId: string) {
  if (!supabaseAdmin) return { assignments: [], error: new Error('Supabase no configurado.') };
  const { data, error } = await supabaseAdmin
    .from('portal_role_assignments')
    .select('id,user_id,role,scope_type,scope_id,scope_key,status,created_at,updated_at')
    .eq('user_id', userId)
    .eq('role', 'finance')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) return { assignments: [], error };

  const rows = data || [];
  const regionIds = rows.filter((row: any) => row.scope_type === 'region' && row.scope_id).map((row: any) => row.scope_id);
  const churchIds = rows.filter((row: any) => row.scope_type === 'church' && row.scope_id).map((row: any) => row.scope_id);
  const [regionsResult, churchesResult] = await Promise.all([
    regionIds.length
      ? supabaseAdmin.from('regions').select('id,code,name,country').in('id', regionIds)
      : Promise.resolve({ data: [], error: null }),
    churchIds.length
      ? supabaseAdmin.from('churches').select('id,name,city,country').in('id', churchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (regionsResult.error || churchesResult.error) {
    return { assignments: [], error: regionsResult.error || churchesResult.error };
  }
  const regionMap = new Map((regionsResult.data || []).map((region: any) => [region.id, region]));
  const churchMap = new Map((churchesResult.data || []).map((church: any) => [church.id, church]));

  return {
    assignments: rows.map((row: any) => {
      const region: any = row.scope_type === 'region' ? regionMap.get(row.scope_id) : null;
      const church: any = row.scope_type === 'church' ? churchMap.get(row.scope_id) : null;
      const regionLabel = region
        ? [region.code, region.name, region.country].filter(Boolean).join(' · ')
        : null;
      const churchLabel = church
        ? [church.name, church.city, church.country].filter(Boolean).join(' · ')
        : null;
      return {
        id: row.id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        scope_key: row.scope_key,
        scope_label: financeAssignmentScopeLabel({
          scopeType: row.scope_type,
          scopeKey: row.scope_key,
          regionLabel,
          churchLabel,
        }),
        created_at: row.created_at,
      };
    }),
    error: null,
  };
}

async function migrationStatusResponse(userId: string) {
  const hierarchy = await isHierarchyReady();
  if (hierarchy.error) {
    console.error('[portal.admin.finance-assignments] hierarchy check failed', hierarchy.error);
    return json({ ok: false, error: 'No se pudo verificar la jerarquía financiera.' }, 500);
  }
  if (!hierarchy.ready) {
    return json({
      ok: true,
      migration_required: true,
      user_id: userId,
      assignments: [],
      message: 'Ejecuta docs/sql/finance_scopes_hierarchy.sql para activar estas asignaciones.',
    });
  }
  return null;
}

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await authorize(request, clientAddress);
  if (auth.response) return auth.response;
  const userId = String(url.searchParams.get('user_id') || '').trim().toLowerCase();
  if (!isFinanceUuid(userId)) return json({ ok: false, error: 'Usuario inválido.' }, 400);

  const { data: profile, error: profileError } = await loadTargetProfile(userId);
  if (profileError) return json({ ok: false, error: 'No se pudo validar el usuario.' }, 500);
  if (!profile?.user_id) return json({ ok: false, error: 'Usuario no encontrado.' }, 404);
  const migrationResponse = await migrationStatusResponse(userId);
  if (migrationResponse) return migrationResponse;

  const result = await listAssignments(userId);
  if (result.error) {
    if (isMissingFinanceHierarchy(result.error)) {
      const response = await migrationStatusResponse(userId);
      return response || json({ ok: false, error: 'La jerarquía financiera está incompleta.' }, 503);
    }
    return json({ ok: false, error: 'No se pudieron cargar las asignaciones financieras.' }, 500);
  }
  return json({ ok: true, migration_required: false, user: profile, assignments: result.assignments });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await authorize(request, clientAddress);
  if (auth.response || !auth.ctx?.userId) return auth.response || json({ ok: false, error: 'No autorizado.' }, 403);
  const payload = await request.json().catch(() => null);
  const normalized = normalizeFinanceAssignmentInput({
    userId: payload?.userId,
    scopeType: payload?.scopeType,
    scopeId: payload?.scopeId,
    scopeKey: payload?.scopeKey,
  });
  if (!normalized.ok) return json({ ok: false, error: normalized.error }, 400);
  const input = normalized.value;

  const { data: profile, error: profileError } = await loadTargetProfile(input.userId);
  if (profileError) return json({ ok: false, error: 'No se pudo validar el usuario.' }, 500);
  if (!profile?.user_id) return json({ ok: false, error: 'Usuario no encontrado.' }, 404);
  if (['admin', 'superadmin'].includes(String(profile.role || '').toLowerCase())) {
    return json({ ok: false, error: 'Admin y superadmin ya tienen acceso financiero global por su rol principal.' }, 409);
  }
  const migrationResponse = await migrationStatusResponse(input.userId);
  if (migrationResponse) {
    if (migrationResponse.status >= 500) return migrationResponse;
    return json({
      ok: false,
      migration_required: true,
      error: 'Ejecuta docs/sql/finance_scopes_hierarchy.sql antes de asignar Finanzas.',
    }, 409);
  }

  if (input.scopeType === 'region') {
    const { data: region, error } = await supabaseAdmin.from('regions').select('id').eq('id', input.scopeId).eq('is_active', true).maybeSingle();
    if (error || !region?.id) return json({ ok: false, error: 'La región seleccionada no está disponible.' }, 400);
  }
  if (input.scopeType === 'church') {
    const { data: church, error } = await supabaseAdmin.from('churches').select('id').eq('id', input.scopeId).maybeSingle();
    if (error || !church?.id) return json({ ok: false, error: 'La iglesia seleccionada no está disponible.' }, 400);
  }

  let matchingQuery = supabaseAdmin
    .from('portal_role_assignments')
    .select('id,status')
    .eq('user_id', input.userId)
    .eq('role', 'finance')
    .eq('scope_type', input.scopeType);
  if (input.scopeType === 'global') matchingQuery = matchingQuery.is('scope_id', null).is('scope_key', null);
  if (input.scopeType === 'country') matchingQuery = matchingQuery.is('scope_id', null).eq('scope_key', input.scopeKey);
  if (input.scopeType === 'region' || input.scopeType === 'church') {
    matchingQuery = matchingQuery.eq('scope_id', input.scopeId).is('scope_key', null);
  }
  const { data: matchingRows, error: matchingError } = await matchingQuery.order('updated_at', { ascending: false }).limit(1);
  if (matchingError) {
    if (isMissingFinanceHierarchy(matchingError)) {
      return json({ ok: false, migration_required: true, error: 'Ejecuta la migración de alcances financieros.' }, 409);
    }
    return json({ ok: false, error: 'No se pudo validar la asignación.' }, 500);
  }

  const existing = matchingRows?.[0];
  let assignmentId = existing?.id || null;
  if (existing?.status !== 'active') {
    const values = {
      user_id: input.userId,
      role: 'finance',
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_key: input.scopeKey,
      status: 'active',
      created_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    };
    const mutation = existing?.id
      ? supabaseAdmin.from('portal_role_assignments').update(values).eq('id', existing.id).select('id').single()
      : supabaseAdmin.from('portal_role_assignments').insert(values).select('id').single();
    const { data: saved, error: saveError } = await mutation;
    if (saveError) {
      if (isMissingFinanceHierarchy(saveError)) {
        return json({ ok: false, migration_required: true, error: 'Ejecuta la migración de alcances financieros.' }, 409);
      }
      if (String(saveError.code || '') !== '23505') {
        console.error('[portal.admin.finance-assignments] save failed', saveError);
        return json({ ok: false, error: 'No se pudo guardar la asignación financiera.' }, 500);
      }
    }
    assignmentId = saved?.id || assignmentId;
  }

  const result = await listAssignments(input.userId);
  if (result.error) return json({ ok: false, error: 'La asignación se guardó, pero no pudo recargarse.' }, 500);
  console.info('[portal.admin.finance-assignments] assignment active', {
    actorUserId: auth.ctx.userId,
    targetUserId: input.userId,
    assignmentId,
    scopeType: input.scopeType,
  });
  void logSecurityEvent({
    type: 'admin_action',
    identifier: 'finance-assignment-active',
    detail: input.scopeType,
    meta: {
      actor_user_id: auth.ctx.userId,
      target_user_id: input.userId,
      assignment_id: assignmentId,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_key: input.scopeKey,
    },
  });
  return json({ ok: true, assignment_id: assignmentId, user: profile, assignments: result.assignments });
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await authorize(request, clientAddress);
  if (auth.response || !auth.ctx?.userId) return auth.response || json({ ok: false, error: 'No autorizado.' }, 403);
  const payload = await request.json().catch(() => null);
  const userId = String(payload?.userId || '').trim().toLowerCase();
  const assignmentId = String(payload?.assignmentId || '').trim().toLowerCase();
  if (!isFinanceUuid(userId) || !isFinanceUuid(assignmentId)) {
    return json({ ok: false, error: 'Asignación inválida.' }, 400);
  }
  const migrationResponse = await migrationStatusResponse(userId);
  if (migrationResponse) {
    if (migrationResponse.status >= 500) return migrationResponse;
    return json({ ok: false, migration_required: true, error: 'Ejecuta la migración de alcances financieros.' }, 409);
  }

  const [{ data: profile, error: profileError }, { data: assignment, error: assignmentError }, activeCountResult] = await Promise.all([
    loadTargetProfile(userId),
    supabaseAdmin
      .from('portal_role_assignments')
      .select('id,user_id,status')
      .eq('id', assignmentId)
      .eq('user_id', userId)
      .eq('role', 'finance')
      .maybeSingle(),
    supabaseAdmin
      .from('portal_role_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'finance')
      .eq('status', 'active'),
  ]);
  if (profileError || assignmentError || activeCountResult.error) {
    return json({ ok: false, error: 'No se pudo validar la asignación.' }, 500);
  }
  if (!profile?.user_id || !assignment?.id || assignment.status !== 'active') {
    return json({ ok: false, error: 'La asignación ya no está activa.' }, 404);
  }
  if (String(profile.role || '').toLowerCase() === 'finance' && Number(activeCountResult.count || 0) <= 1) {
    return json({
      ok: false,
      error: 'Esta cuenta conserva el rol principal Finanzas. Asígnale otro alcance antes de retirar el último, o cambia primero su rol principal.',
    }, 409);
  }

  const { error: updateError } = await supabaseAdmin
    .from('portal_role_assignments')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .eq('user_id', userId)
    .eq('role', 'finance')
    .eq('status', 'active');
  if (updateError) return json({ ok: false, error: 'No se pudo retirar la asignación financiera.' }, 500);

  const result = await listAssignments(userId);
  if (result.error) return json({ ok: false, error: 'La asignación se retiró, pero no pudo recargarse.' }, 500);
  console.info('[portal.admin.finance-assignments] assignment inactive', {
    actorUserId: auth.ctx.userId,
    targetUserId: userId,
    assignmentId,
  });
  void logSecurityEvent({
    type: 'admin_action',
    identifier: 'finance-assignment-inactive',
    detail: 'finance',
    meta: {
      actor_user_id: auth.ctx.userId,
      target_user_id: userId,
      assignment_id: assignmentId,
    },
  });
  return json({ ok: true, assignments: result.assignments });
};
