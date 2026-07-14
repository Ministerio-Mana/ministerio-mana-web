import { getPortalChurchAccessContext, mapPortalAccessError, type PortalChurchAccessContext, type PortalChurchRole } from './portalAccess.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';

export const CHURCH_PAGE_EDITOR_ROLES: PortalChurchRole[] = [
  'superadmin',
  'admin',
  'national_pastor',
  'national_collaborator',
  'regional_pastor',
  'regional_collaborator',
  'pastor',
  'local_collaborator',
];

export type ChurchDirectoryRow = {
  id: string;
  code?: string | null;
  name: string;
  city?: string | null;
  country?: string | null;
  continent?: string | null;
  address?: string | null;
  maps_url?: string | null;
  lat?: number | null;
  lng?: number | null;
  region_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export async function requireChurchPageEditor(request: Request): Promise<
  { ok: true; access: PortalChurchAccessContext }
  | { ok: false; status: number; error: string }
> {
  const access = await getPortalChurchAccessContext(request, {
    allowedRoles: CHURCH_PAGE_EDITOR_ROLES,
    allowPasswordSession: false,
  });
  if (!access.ok) {
    const mapped = mapPortalAccessError(access.reason, 'Tu rol no puede editar páginas de iglesias.');
    return { ok: false, status: mapped.status, error: mapped.error };
  }
  if (!access.userId || access.isPasswordSession) {
    return { ok: false, status: 403, error: 'Esta operación requiere una cuenta individual.' };
  }
  return { ok: true, access };
}

function applyChurchScope(rows: ChurchDirectoryRow[], access: PortalChurchAccessContext): ChurchDirectoryRow[] {
  if (access.isAdmin) return rows;
  if (access.allowedChurchId) return rows.filter((church) => church.id === access.allowedChurchId);
  if (access.isRegional) {
    return rows.filter((church) => (
      (church.region_id && access.allowedRegionIds.includes(church.region_id))
      || (!church.region_id && access.allowedCountry && church.country === access.allowedCountry)
    ));
  }
  if (access.isNational && access.allowedCountry) {
    return rows.filter((church) => church.country === access.allowedCountry);
  }
  return [];
}

export async function listChurchesForPageEditor(access: PortalChurchAccessContext): Promise<ChurchDirectoryRow[]> {
  if (!supabaseAdmin) return [];
  const fields = 'id,code,name,city,country,continent,address,maps_url,lat,lng,region_id,contact_name,contact_email,contact_phone';
  let result = await supabaseAdmin.from('churches').select(fields).order('country').order('city').order('name');
  if (result.error?.code === '42703') {
    result = await supabaseAdmin
      .from('churches')
      .select('id,code,name,city,country,continent,address,maps_url,lat,lng,contact_name,contact_email,contact_phone')
      .order('country')
      .order('city')
      .order('name');
  }
  if (result.error) {
    console.error('[church-pages] church list failed', { code: result.error.code, message: result.error.message });
    return [];
  }
  return applyChurchScope((result.data || []) as ChurchDirectoryRow[], access);
}

export async function getChurchForPageEditor(
  churchId: string,
  access: PortalChurchAccessContext,
): Promise<ChurchDirectoryRow | null> {
  const churches = await listChurchesForPageEditor(access);
  return churches.find((church) => church.id === churchId) || null;
}
