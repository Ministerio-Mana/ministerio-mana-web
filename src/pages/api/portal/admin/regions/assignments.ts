import type { APIRoute } from 'astro';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const ALLOWED_ROLES = new Set(['regional_pastor', 'regional_collaborator']);

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function norm(value: unknown): string {
  return String(value || '').trim();
}

async function findUserProfile(payload: any) {
  const userId = norm(payload?.user_id || payload?.userId);
  const email = norm(payload?.email).toLowerCase();

  if (!userId && !email) return { profile: null, error: 'user_id o email es requerido' };

  let query = supabaseAdmin
    ?.from('user_profiles')
    .select('user_id, email, full_name, role, country, region_id')
    .limit(1);

  if (!query) return { profile: null, error: 'Supabase no configurado' };
  if (userId) query = query.eq('user_id', userId);
  else query = query.ilike('email', email);

  const { data, error } = await query.maybeSingle();
  if (error) return { profile: null, error: 'No se pudo cargar el usuario' };
  if (!data?.user_id) return { profile: null, error: 'Usuario no encontrado' };
  return { profile: data, error: null };
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions.assignments',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const url = new URL(request.url);
  const regionId = norm(url.searchParams.get('region_id'));
  const userId = norm(url.searchParams.get('user_id'));

  let query = supabaseAdmin
    .from('region_leadership_assignments')
    .select('id, user_id, region_id, role, status, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (regionId) query = query.eq('region_id', regionId);
  if (userId) query = query.eq('user_id', userId);

  const { data: assignments, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return json({ ok: false, error: 'Tabla region_leadership_assignments no existe' }, 400);
    }
    console.error('[portal.admin.regions.assignments.get] error', error);
    return json({ ok: false, error: 'No se pudieron cargar asignaciones' }, 500);
  }

  const rows = assignments || [];
  const userIds = Array.from(new Set(rows.map((row: any) => row.user_id).filter(Boolean)));
  const regionIds = Array.from(new Set(rows.map((row: any) => row.region_id).filter(Boolean)));

  const userMap = new Map<string, any>();
  const regionMap = new Map<string, any>();

  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, full_name, role, country, region_id')
      .in('user_id', userIds);
    for (const row of profiles || []) {
      userMap.set((row as any).user_id, row);
    }
  }

  if (regionIds.length) {
    const { data: regions } = await supabaseAdmin
      .from('regions')
      .select('id, country, code, name, is_active')
      .in('id', regionIds);
    for (const row of regions || []) {
      regionMap.set((row as any).id, row);
    }
  }

  const enriched = rows.map((row: any) => ({
    ...row,
    user: userMap.get(row.user_id) || null,
    region: regionMap.get(row.region_id) || null,
  }));

  return json({ ok: true, assignments: enriched });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions.assignments',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const payload = await request.json().catch(() => null);
  const role = norm(payload?.role);
  const regionId = norm(payload?.region_id || payload?.regionId);
  const setPrimaryRole = payload?.set_primary_role === undefined ? true : Boolean(payload?.set_primary_role);

  if (!ALLOWED_ROLES.has(role)) {
    return json({ ok: false, error: 'role inválido. Usa regional_pastor o regional_collaborator' }, 400);
  }
  if (!regionId) return json({ ok: false, error: 'region_id requerido' }, 400);

  const { profile, error: profileError } = await findUserProfile(payload);
  if (profileError) return json({ ok: false, error: profileError }, 400);

  const { data: region, error: regionError } = await supabaseAdmin
    .from('regions')
    .select('id, country, code, name')
    .eq('id', regionId)
    .maybeSingle();

  if (regionError) {
    console.error('[portal.admin.regions.assignments.post] region error', regionError);
    return json({ ok: false, error: 'No se pudo validar la región' }, 500);
  }
  if (!region?.id) return json({ ok: false, error: 'Región no encontrada' }, 404);

  const now = new Date().toISOString();
  const { data: assigned, error: assignError } = await supabaseAdmin
    .from('region_leadership_assignments')
    .upsert(
      {
        user_id: profile.user_id,
        region_id: region.id,
        role,
        status: 'active',
        updated_at: now,
      },
      { onConflict: 'user_id,region_id,role,status' },
    )
    .select('id, user_id, region_id, role, status, created_at, updated_at')
    .single();

  if (assignError) {
    if (assignError.code === '42P01') {
      return json({ ok: false, error: 'Tabla region_leadership_assignments no existe. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.assignments.post] assign error', assignError);
    return json({ ok: false, error: 'No se pudo asignar liderazgo regional' }, 500);
  }

  const profilePatch: Record<string, any> = {
    region_id: region.id,
    country: profile.country || region.country || null,
    updated_at: now,
  };
  if (setPrimaryRole) {
    profilePatch.role = role;
  }

  const { error: profileUpdateError } = await supabaseAdmin
    .from('user_profiles')
    .update(profilePatch)
    .eq('user_id', profile.user_id);

  if (profileUpdateError) {
    if (profileUpdateError.code === '42703') {
      return json({ ok: false, error: 'Falta la columna region_id en user_profiles. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.assignments.post] profile sync error', profileUpdateError);
    return json({ ok: false, error: 'Asignación creada, pero falló la sincronización del perfil' }, 500);
  }

  return json({
    ok: true,
    assignment: assigned,
    profile_sync: {
      user_id: profile.user_id,
      role: setPrimaryRole ? role : profile.role,
      region_id: region.id,
      country: profile.country || region.country || null,
    },
  });
};

export const DELETE: APIRoute = async ({ request, clientAddress }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const guard = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.admin.regions.assignments',
  });
  if (!guard.ok) return json({ ok: false, error: guard.error || 'No autorizado' }, guard.status);

  const payload = await request.json().catch(() => null);
  const assignmentId = norm(payload?.assignment_id || payload?.assignmentId);
  const role = norm(payload?.role);
  const regionId = norm(payload?.region_id || payload?.regionId);

  let query = supabaseAdmin
    .from('region_leadership_assignments')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('status', 'active');

  if (assignmentId) {
    query = query.eq('id', assignmentId);
  } else {
    const { profile, error: profileError } = await findUserProfile(payload);
    if (profileError) return json({ ok: false, error: profileError }, 400);
    if (!regionId || !ALLOWED_ROLES.has(role)) {
      return json({ ok: false, error: 'Para baja por usuario requiere region_id y role válidos' }, 400);
    }
    query = query
      .eq('user_id', profile.user_id)
      .eq('region_id', regionId)
      .eq('role', role);
  }

  const { data: deactivated, error } = await query.select('id, user_id, region_id, role, status');
  if (error) {
    if (error.code === '42P01') {
      return json({ ok: false, error: 'Tabla region_leadership_assignments no existe. Ejecuta portal_rbac_regions_bootstrap.sql' }, 400);
    }
    console.error('[portal.admin.regions.assignments.delete] error', error);
    return json({ ok: false, error: 'No se pudo desactivar la asignación' }, 500);
  }
  if (!deactivated?.length) return json({ ok: false, error: 'Asignación activa no encontrada' }, 404);

  const affectedUserIds = Array.from(new Set(deactivated.map((row: any) => row.user_id).filter(Boolean)));
  for (const userId of affectedUserIds) {
    const { data: active } = await supabaseAdmin
      .from('region_leadership_assignments')
      .select('region_id, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .in('role', ['regional_pastor', 'regional_collaborator']);

    if (active?.length) {
      const firstRegionId = norm((active[0] as any)?.region_id);
      if (firstRegionId) {
        await supabaseAdmin
          .from('user_profiles')
          .update({ region_id: firstRegionId, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
    } else {
      await supabaseAdmin
        .from('user_profiles')
        .update({ region_id: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('role', ['regional_pastor', 'regional_collaborator']);
    }
  }

  return json({ ok: true, deactivated_count: deactivated.length, assignments: deactivated });
};
