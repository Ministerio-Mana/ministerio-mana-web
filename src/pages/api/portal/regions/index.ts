import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  getPortalChurchAccessContext,
  mapPortalAccessError,
  type PortalChurchRole,
} from '@lib/portalAccess';

export const prerender = false;

const ALLOWED_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
  'national_pastor',
  'national_collaborator',
  'regional_pastor',
  'regional_collaborator',
  'pastor',
  'local_collaborator',
  'leader',
];

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado' }, 500);

  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: ALLOWED_ROLES,
  });
  if (!access.ok) {
    const denied = mapPortalAccessError(access.reason, 'No autorizado');
    return json({ ok: false, error: denied.error }, denied.status);
  }

  const includeInactive = new URL(request.url).searchParams.get('include_inactive') === '1';
  let query = supabaseAdmin
    .from('regions')
    .select('id, country, code, name, is_active')
    .order('country', { ascending: true })
    .order('code', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  if (access.isAdmin) {
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return json({ ok: true, regions: [] });
      }
      console.error('[portal.regions] admin query error', error);
      return json({ ok: false, error: 'No se pudieron cargar regiones' }, 500);
    }
    return json({ ok: true, regions: data || [] });
  }

  if (access.isRegional) {
    if (!access.allowedRegionIds.length) {
      return json({ ok: true, regions: [] });
    }
    const { data, error } = await query.in('id', access.allowedRegionIds);
    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return json({ ok: true, regions: [] });
      }
      console.error('[portal.regions] regional query error', error);
      return json({ ok: false, error: 'No se pudieron cargar regiones' }, 500);
    }
    return json({ ok: true, regions: data || [] });
  }

  if (access.isNational) {
    if (!access.allowedCountry) {
      return json({ ok: true, regions: [] });
    }
    const { data, error } = await query.eq('country', access.allowedCountry);
    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        return json({ ok: true, regions: [] });
      }
      console.error('[portal.regions] national query error', error);
      return json({ ok: false, error: 'No se pudieron cargar regiones' }, 500);
    }
    return json({ ok: true, regions: data || [] });
  }

  return json({ ok: true, regions: [] });
};
