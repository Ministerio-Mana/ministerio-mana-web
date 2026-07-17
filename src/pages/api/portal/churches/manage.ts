export const prerender = false;

import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { requireChurchPageEditor } from '@lib/churchPageAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { normalizeCountryRegion } from '@lib/normalization';
import {
  canCreateChurch,
  canEditChurch,
  normalizeChurchCode,
  normalizeChurchManagementInput,
  validateChurchManagementInput,
} from '@lib/churchManagement';

const MANAGED_FIELDS = 'id,code,name,kind,lifecycle_status,is_public,show_on_map,city,country,continent,region_id,address,maps_url,lat,lng,contact_name,contact_email,contact_phone,service,notes,version,created_at,updated_at';
const MAX_BODY_CHARS = 16_000;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function isManagementSchemaMissing(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || code === '42P01' || message.includes('church_directory_audit_logs');
}

function normalizeComparableCountry(value: unknown): string {
  return normalizeCountryRegion(String(value || '')).toLocaleLowerCase('es');
}

function continentForCountry(country: string): string {
  const key = normalizeComparableCountry(country).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['francia', 'espana', 'alemania', 'suiza', 'italia', 'portugal', 'reino unido', 'inglaterra'].includes(key)) return 'Europa';
  if (['australia', 'nueva zelanda'].includes(key)) return 'Oceanía';
  if (['sudafrica', 'kenia', 'nigeria', 'ghana'].includes(key)) return 'África';
  if (['japon', 'china', 'india', 'corea del sur', 'filipinas'].includes(key)) return 'Asia';
  return 'América';
}

async function loadRegion(regionId: string | null) {
  if (!regionId || !supabaseAdmin) return null;
  const result = await supabaseAdmin
    .from('regions')
    .select('id,country,code,name,is_active')
    .eq('id', regionId)
    .eq('is_active', true)
    .maybeSingle();
  if (result.error || !result.data?.id) return null;
  return result.data;
}

async function resolveScopedInput(
  access: any,
  raw: Record<string, unknown>,
  current?: Record<string, any> | null,
): Promise<{ ok: true; input: ReturnType<typeof normalizeChurchManagementInput> } | { ok: false; status: number; error: string }> {
  const input = normalizeChurchManagementInput(raw);
  const region = await loadRegion(input.region_id);
  if (input.region_id && !region) {
    return { ok: false, status: 400, error: 'Selecciona una región activa.' };
  }

  if (access.isRegional) {
    const regionId = input.region_id || current?.region_id || '';
    if (!regionId || !access.allowedRegionIds.includes(regionId)) {
      return { ok: false, status: 403, error: 'La iglesia debe quedar dentro de tu región.' };
    }
    const scopedRegion = region?.id === regionId ? region : await loadRegion(regionId);
    if (!scopedRegion) return { ok: false, status: 400, error: 'La región seleccionada no está disponible.' };
    input.region_id = scopedRegion.id;
    input.country = scopedRegion.country;
  } else if (access.isNational) {
    const allowedCountry = String(access.allowedCountry || current?.country || '').trim();
    if (!allowedCountry) return { ok: false, status: 403, error: 'Tu cuenta no tiene país asignado.' };
    if (region && normalizeComparableCountry(region.country) !== normalizeComparableCountry(allowedCountry)) {
      return { ok: false, status: 403, error: 'La región no pertenece a tu país.' };
    }
    input.country = allowedCountry;
  } else if (access.allowedChurchId) {
    input.country = String(current?.country || '').trim();
    input.region_id = current?.region_id || null;
  } else if (region) {
    input.country = region.country;
  }

  const errors = validateChurchManagementInput(input);
  if (errors.length) return { ok: false, status: 400, error: errors[0] };
  return { ok: true, input };
}

async function audit(params: {
  churchId: string;
  action: string;
  previous?: unknown;
  next?: unknown;
  actorUserId: string;
  actorEmail?: string | null;
  requestIp?: string | null;
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from('church_directory_audit_logs').insert({
    church_id: params.churchId,
    action: params.action,
    previous_snapshot: params.previous || null,
    next_snapshot: params.next || null,
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail || null,
    request_ip: params.requestIp || null,
  });
  if (result.error && !isManagementSchemaMissing(result.error)) {
    console.error('[church-management] audit failed', { code: result.error.code, message: result.error.message });
  }
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const readiness = await supabaseAdmin.from('churches').select('id,kind,lifecycle_status,is_public,show_on_map,service,notes,version').limit(1);
  const schemaReady = !isManagementSchemaMissing(readiness.error);
  if (readiness.error && schemaReady) {
    console.error('[church-management] readiness failed', { code: readiness.error.code, message: readiness.error.message });
    return json({ ok: false, error: 'No se pudo validar la gestión de iglesias.' }, 500);
  }

  let regionQuery = supabaseAdmin
    .from('regions')
    .select('id,country,code,name,is_active')
    .eq('is_active', true)
    .order('country')
    .order('name');
  if (auth.access.isRegional && auth.access.allowedRegionIds.length) {
    regionQuery = regionQuery.in('id', auth.access.allowedRegionIds);
  } else if (auth.access.isNational && auth.access.allowedCountry) {
    regionQuery = regionQuery.eq('country', auth.access.allowedCountry);
  } else if (auth.access.allowedChurchId) {
    regionQuery = regionQuery.limit(0);
  }
  const regionsResult = await regionQuery;
  const regions = regionsResult.error && !isManagementSchemaMissing(regionsResult.error) ? [] : (regionsResult.data || []);
  const countries = Array.from(new Set([
    ...regions.map((region: any) => String(region.country || '').trim()),
    auth.access.allowedCountry || '',
    auth.access.profile?.country || '',
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));

  return json({
    ok: true,
    schema_ready: schemaReady,
    sql: schemaReady ? null : 'docs/sql/church_directory_management.sql',
    capabilities: {
      can_create: schemaReady && canCreateChurch(auth.access),
      can_edit: schemaReady && canEditChurch(auth.access),
      role: auth.access.role,
      fixed_country: auth.access.allowedCountry,
      fixed_region_ids: auth.access.allowedRegionIds,
      fixed_church_id: auth.access.allowedChurchId,
    },
    countries,
    regions,
  });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!canCreateChurch(auth.access)) return json({ ok: false, error: 'Tu rol no puede crear iglesias.' }, 403);
  const allowed = await enforceRateLimit(`church-create:${auth.access.userId}`, 300, 8, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Espera un momento antes de crear otra iglesia.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return json({ ok: false, error: 'La información supera el tamaño permitido.' }, 413);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(rawBody || '{}'); } catch { return json({ ok: false, error: 'La información no es válida.' }, 400); }
  const scoped = await resolveScopedInput(auth.access, body);
  if (!scoped.ok) return json({ ok: false, error: scoped.error }, scoped.status);

  const now = new Date().toISOString();
  const baseCode = normalizeChurchCode(`${scoped.input.country}-${scoped.input.city}-${scoped.input.name}`) || `iglesia-${Date.now().toString(36)}`;
  const existing = await supabaseAdmin.from('churches').select('id').eq('code', baseCode).maybeSingle();
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) || Date.now().toString(36).slice(-6);
  const code = existing.data?.id ? `${baseCode.slice(0, 112)}-${suffix}` : baseCode;
  const payload = {
    ...scoped.input,
    code,
    continent: continentForCountry(scoped.input.country),
    lifecycle_status: scoped.input.status,
    created_by: auth.access.userId,
    updated_by: auth.access.userId,
    created_at: now,
    updated_at: now,
    version: 1,
  } as Record<string, unknown>;
  delete payload.status;
  const result = await supabaseAdmin.from('churches').insert(payload).select(MANAGED_FIELDS).single();
  if (isManagementSchemaMissing(result.error)) {
    return json({ ok: false, setup_required: true, error: 'Falta ejecutar docs/sql/church_directory_management.sql.' }, 503);
  }
  if (result.error) {
    console.error('[church-management] create failed', { code: result.error.code, message: result.error.message });
    return json({ ok: false, error: result.error.code === '23505' ? 'Ya existe una iglesia con ese identificador.' : 'No se pudo crear la iglesia.' }, result.error.code === '23505' ? 409 : 500);
  }
  await audit({ churchId: result.data.id, action: 'church.create', next: result.data, actorUserId: auth.access.userId!, actorEmail: auth.access.email, requestIp: clientAddress });
  return json({ ok: true, church: result.data }, 201);
};

export const PATCH: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const auth = await requireChurchPageEditor(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!canEditChurch(auth.access)) return json({ ok: false, error: 'Tu rol no puede editar los datos de la iglesia.' }, 403);
  const allowed = await enforceRateLimit(`church-update:${auth.access.userId}`, 60, 30, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiados cambios seguidos. Espera un momento.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return json({ ok: false, error: 'La información supera el tamaño permitido.' }, 413);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(rawBody || '{}'); } catch { return json({ ok: false, error: 'La información no es válida.' }, 400); }
  const churchId = String(body.church_id || '').trim();
  const expectedVersion = Number(body.expected_version || 0);
  if (!churchId) return json({ ok: false, error: 'Selecciona una iglesia.' }, 400);
  if (!(await isChurchAllowedForAccess(churchId, auth.access))) return json({ ok: false, error: 'No tienes permiso sobre esta iglesia.' }, 403);

  const currentResult = await supabaseAdmin.from('churches').select(MANAGED_FIELDS).eq('id', churchId).maybeSingle();
  if (isManagementSchemaMissing(currentResult.error)) {
    return json({ ok: false, setup_required: true, error: 'Falta ejecutar docs/sql/church_directory_management.sql.' }, 503);
  }
  if (currentResult.error || !currentResult.data) return json({ ok: false, error: 'No se encontró la iglesia.' }, 404);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(currentResult.data.version || 1)) {
    return json({ ok: false, conflict: true, error: 'La iglesia cambió en otra sesión. Recarga antes de guardar.' }, 409);
  }
  const scoped = await resolveScopedInput(auth.access, body, currentResult.data);
  if (!scoped.ok) return json({ ok: false, error: scoped.error }, scoped.status);

  const payload = {
    ...scoped.input,
    lifecycle_status: scoped.input.status,
    continent: continentForCountry(scoped.input.country),
    updated_by: auth.access.userId,
    updated_at: new Date().toISOString(),
    version: expectedVersion + 1,
  } as Record<string, unknown>;
  delete payload.status;
  const result = await supabaseAdmin
    .from('churches')
    .update(payload)
    .eq('id', churchId)
    .eq('version', expectedVersion)
    .select(MANAGED_FIELDS)
    .maybeSingle();
  if (!result.data && !result.error) return json({ ok: false, conflict: true, error: 'La iglesia cambió en otra sesión. Recarga antes de guardar.' }, 409);
  if (result.error) {
    console.error('[church-management] update failed', { code: result.error.code, message: result.error.message });
    return json({ ok: false, error: 'No se pudieron guardar los datos de la iglesia.' }, 500);
  }
  await audit({ churchId, action: 'church.update', previous: currentResult.data, next: result.data, actorUserId: auth.access.userId!, actorEmail: auth.access.email, requestIp: clientAddress });
  return json({ ok: true, church: result.data });
};
