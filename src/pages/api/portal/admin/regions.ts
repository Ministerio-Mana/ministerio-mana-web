import type { APIRoute } from 'astro';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeCode(value: unknown): string {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '-');
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const includeInactive = new URL(request.url).searchParams.get('include_inactive') === '1';

  let query = supabaseAdmin
    .from('regions')
    .select('id, country, code, name, is_active, created_at, updated_at')
    .order('country', { ascending: true })
    .order('code', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data: regions, error } = await query;
  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return json({ ok: false, error: 'Tabla regions no existe. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.get] error', error);
    return json({ ok: false, error: 'No se pudieron cargar regiones' }, 500);
  }

  const regionList = regions || [];
  const regionIds = regionList.map((row: any) => row.id).filter(Boolean);
  const countsByRegion = new Map<string, { churches: number; cities: Set<string>; leaders: number }>();

  for (const regionId of regionIds) {
    countsByRegion.set(regionId, { churches: 0, cities: new Set(), leaders: 0 });
  }

  if (regionIds.length) {
    const { data: churches, error: churchesError } = await supabaseAdmin
      .from('churches')
      .select('id, city, region_id')
      .in('region_id', regionIds);

    if (!churchesError) {
      for (const church of churches || []) {
        const regionId = String((church as any)?.region_id || '');
        const city = normalizeText((church as any)?.city).toLowerCase();
        const bucket = countsByRegion.get(regionId);
        if (!bucket) continue;
        bucket.churches += 1;
        if (city) bucket.cities.add(city);
      }
    }

    const { data: leaders, error: leadersError } = await supabaseAdmin
      .from('region_leadership_assignments')
      .select('region_id, status')
      .in('region_id', regionIds)
      .eq('status', 'active');

    if (!leadersError) {
      for (const row of leaders || []) {
        const regionId = String((row as any)?.region_id || '');
        const bucket = countsByRegion.get(regionId);
        if (!bucket) continue;
        bucket.leaders += 1;
      }
    }
  }

  const enriched = regionList.map((row: any) => {
    const bucket = countsByRegion.get(row.id);
    return {
      ...row,
      churches_count: bucket?.churches || 0,
      cities_count: bucket?.cities?.size || 0,
      active_assignments_count: bucket?.leaders || 0,
    };
  });

  return json({ ok: true, regions: enriched });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const payload = await request.json().catch(() => null);
  const country = normalizeText(payload?.country);
  const code = normalizeCode(payload?.code);
  const name = normalizeText(payload?.name);
  const isActive = payload?.is_active === undefined ? true : Boolean(payload?.is_active);

  if (!country || !code || !name) {
    return json({ ok: false, error: 'country, code y name son requeridos' }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from('regions')
    .upsert(
      {
        country,
        code,
        name,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'country,code' },
    )
    .select('id, country, code, name, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return json({ ok: false, error: 'Tabla regions no existe. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.post] error', error);
    return json({ ok: false, error: 'No se pudo guardar la región' }, 500);
  }

  return json({ ok: true, region: data });
};

export const PATCH: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const payload = await request.json().catch(() => null);
  const id = normalizeText(payload?.id);
  if (!id) return json({ ok: false, error: 'id requerido' }, 400);

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (payload?.country !== undefined) patch.country = normalizeText(payload.country);
  if (payload?.code !== undefined) patch.code = normalizeCode(payload.code);
  if (payload?.name !== undefined) patch.name = normalizeText(payload.name);
  if (payload?.is_active !== undefined) patch.is_active = Boolean(payload.is_active);

  if (Object.keys(patch).length === 1) {
    return json({ ok: false, error: 'No hay cambios para actualizar' }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from('regions')
    .update(patch)
    .eq('id', id)
    .select('id, country, code, name, is_active, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[portal.admin.regions.patch] error', error);
    return json({ ok: false, error: 'No se pudo actualizar la región' }, 500);
  }
  if (!data) return json({ ok: false, error: 'Región no encontrada' }, 404);

  return json({ ok: true, region: data });
};
