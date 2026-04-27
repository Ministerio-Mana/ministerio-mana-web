import type { APIRoute } from 'astro';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

type CityAggregate = {
  country: string;
  city: string;
  churches_count: number;
  region_ids: Set<string>;
};

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function norm(value: unknown): string {
  return String(value || '').trim();
}

function normKey(value: unknown): string {
  return norm(value).toLowerCase();
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions.cities',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const countryFilter = norm(new URL(request.url).searchParams.get('country'));

  let churchQuery = supabaseAdmin.from('churches').select('id, country, city, region_id');
  if (countryFilter) churchQuery = churchQuery.ilike('country', countryFilter);

  const { data: churches, error: churchesError } = await churchQuery;
  if (churchesError) {
    if (churchesError.code === '42P01') {
      return json({ ok: false, error: 'Tabla churches no existe' }, 400);
    }
    if (churchesError.code === '42703') {
      return json({ ok: false, error: 'Falta la columna region_id en churches. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.cities.get] churches error', churchesError);
    return json({ ok: false, error: 'No se pudieron cargar iglesias' }, 500);
  }

  const { data: regions } = await supabaseAdmin
    .from('regions')
    .select('id, country, code, name, is_active');
  const regionMap = new Map<string, any>();
  for (const row of regions || []) {
    if (!row?.id) continue;
    regionMap.set(row.id, row);
  }

  const grouped = new Map<string, CityAggregate>();
  for (const row of churches || []) {
    const country = norm((row as any)?.country);
    const city = norm((row as any)?.city);
    if (!country || !city) continue;
    const key = `${normKey(country)}::${normKey(city)}`;
    let agg = grouped.get(key);
    if (!agg) {
      agg = {
        country,
        city,
        churches_count: 0,
        region_ids: new Set<string>(),
      };
      grouped.set(key, agg);
    }
    agg.churches_count += 1;
    const regionId = norm((row as any)?.region_id);
    if (regionId) agg.region_ids.add(regionId);
  }

  const cities = Array.from(grouped.values())
    .map((item) => {
      const regionIds = Array.from(item.region_ids);
      const singleRegion = regionIds.length === 1 ? regionMap.get(regionIds[0]) : null;
      return {
        country: item.country,
        city: item.city,
        churches_count: item.churches_count,
        mixed_region_assignment: regionIds.length > 1,
        region_id: regionIds.length === 1 ? regionIds[0] : null,
        region_code: singleRegion?.code || null,
        region_name: singleRegion?.name || null,
      };
    })
    .sort((a, b) => {
      const byCountry = a.country.localeCompare(b.country, 'es');
      if (byCountry !== 0) return byCountry;
      return a.city.localeCompare(b.city, 'es');
    });

  return json({ ok: true, cities });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions.cities',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const payload = await request.json().catch(() => null);
  const country = norm(payload?.country);
  const regionId = norm(payload?.region_id || payload?.regionId);
  const citiesRaw = Array.isArray(payload?.cities) ? payload.cities : [payload?.city];
  const cities = Array.from(
    new Set(citiesRaw.map((value: unknown) => norm(value)).filter(Boolean)),
  );

  if (!country || !cities.length) {
    return json({ ok: false, error: 'country y city/cities son requeridos' }, 400);
  }

  if (regionId) {
    const { data: region, error: regionError } = await supabaseAdmin
      .from('regions')
      .select('id, country, code, name')
      .eq('id', regionId)
      .maybeSingle();

    if (regionError) {
      console.error('[portal.admin.regions.cities.post] region error', regionError);
      return json({ ok: false, error: 'No se pudo validar la región' }, 500);
    }
    if (!region?.id) return json({ ok: false, error: 'Región no encontrada' }, 404);
    if (normKey(region.country) !== normKey(country)) {
      return json({ ok: false, error: 'La región no pertenece al país indicado' }, 400);
    }
  }

  const { data: churches, error: churchesError } = await supabaseAdmin
    .from('churches')
    .select('id, country, city')
    .ilike('country', country);

  if (churchesError) {
    console.error('[portal.admin.regions.cities.post] churches error', churchesError);
    return json({ ok: false, error: 'No se pudieron cargar iglesias del país' }, 500);
  }

  const citySet = new Set(cities.map((value: string) => normKey(value)));
  const targetChurchIds = (churches || [])
    .filter((row: any) => citySet.has(normKey(row?.city)))
    .map((row: any) => row.id)
    .filter(Boolean);

  if (!targetChurchIds.length) {
    return json({ ok: false, error: 'No se encontraron iglesias para esas ciudades' }, 404);
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('churches')
    .update({ region_id: regionId || null })
    .in('id', targetChurchIds)
    .select('id');

  if (updateError) {
    if (updateError.code === '42703') {
      return json({ ok: false, error: 'Falta la columna region_id en churches. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.cities.post] update error', updateError);
    return json({ ok: false, error: 'No se pudo actualizar ciudad/región' }, 500);
  }

  return json({
    ok: true,
    updated_churches: (updated || []).length,
    affected_cities: cities,
    country,
    region_id: regionId || null,
  });
};
