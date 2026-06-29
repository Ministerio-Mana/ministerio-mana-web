import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext } from '@lib/portalAccess';
import { canInviteChurchPeople, isCountryScopedRole } from '@lib/portalRbac';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import { resolveBaseUrl } from '@lib/url';
import { normalizeChurchName, normalizeCityName, normalizeCountryRegion } from '@lib/normalization';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';

export const prerender = false;

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const ROLE_PRIORITY = [
  'user',
  'leader',
  'local_collaborator',
  'pastor',
  'regional_collaborator',
  'regional_pastor',
  'national_collaborator',
  'campus_missionary',
  'national_pastor',
  'admin',
  'superadmin',
];

function shouldPromoteRole(currentRole: string | null | undefined, nextRole: string | null) {
  if (!nextRole) return false;
  const current = currentRole || 'user';
  const currentIndex = ROLE_PRIORITY.indexOf(current);
  const nextIndex = ROLE_PRIORITY.indexOf(nextRole);
  if (nextIndex === -1) return false;
  if (currentIndex === -1) return true;
  return nextIndex > currentIndex;
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
  }

  // Allow portal password session for admin/superadmin flows.
  const access = await getPortalChurchAccessContext(request, { allowPasswordSession: true });
  if (!access.ok || !access.role || (!access.userId && !access.isPasswordSession)) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401 });
  }

  if (!canInviteChurchPeople(access.role)) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para invitar' }), { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Email requerido' }), { status: 400 });
  }

  const email = String(payload.email).trim().toLowerCase();
  const desiredRoleRaw = String(payload.role || 'church_member');
  const desiredRole = desiredRoleRaw === 'church_admin' ? 'church_admin' : 'church_member';
  const requestedChurchId = isUuid(payload.churchId) ? payload.churchId : null;

  const isAdmin = access.isAdmin;
  const isCountryScoped = isCountryScopedRole(access.role);
  const profile = access.profile;
  const memberships = access.memberships || [];

  if (desiredRole === 'church_admin' && !['pastor', 'regional_pastor', 'national_pastor', 'admin', 'superadmin'].includes(access.role)) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado para asignar este rol' }), { status: 403 });
  }

  let churchId: string | null = null;
  let churchName: string | null = null;

  // Church Resolution Logic
  if (isAdmin) {
    // Admin can specify any church or create one
    if (requestedChurchId) {
      const { data: existing } = await supabaseAdmin
        .from('churches')
        .select('id, name')
        .eq('id', requestedChurchId)
        .maybeSingle();
      if (!existing?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Iglesia no encontrada' }), { status: 404 });
      }
      churchId = existing.id;
      churchName = existing.name;
    } else {
      const churchRaw = normalizeChurchName(payload.church || '');
      const churchCountry = normalizeCountryRegion(payload.country || '') || null;
      if (churchRaw) {
        let query = supabaseAdmin
          .from('churches')
          .select('id, name')
          .ilike('name', churchRaw);
        if (churchCountry) {
          query = query.eq('country', churchCountry);
        }
        const { data: existing } = await query.maybeSingle();
        if (existing?.id) {
          churchId = existing.id;
          churchName = existing.name;
        } else {
          const { data: created } = await supabaseAdmin.from('churches').insert({
            name: churchRaw,
            city: normalizeCityName(payload.city || ''),
            country: churchCountry,
            created_by: isUuid(access.userId) ? access.userId : null,
          }).select('id, name').single();
          churchId = created?.id || null;
          churchName = created?.name || churchRaw;
        }
      }
    }
  } else if (isCountryScoped) {
    // Country/Region scoped roles must select a church in their authorized scope.
    if (requestedChurchId) {
      const { data: church } = await supabaseAdmin.from('churches').select('id, name, country').eq('id', requestedChurchId).single();
      const isAllowedChurch = await isChurchAllowedForAccess(requestedChurchId, access);
      if (church?.id && isAllowedChurch) {
        churchId = church.id;
        churchName = church.name;
      } else {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia' }), { status: 403 });
      }
    } else {
      return new Response(JSON.stringify({ ok: false, error: 'Debes seleccionar una iglesia' }), { status: 400 });
    }
  } else {
    // Local Pastor / Church Admin -> Restricted to own church
    // Prefer membership church first
    const membership = memberships.find((m: any) => m?.church?.id);
    // Or profile church
    churchId = membership?.church?.id || access.allowedChurchId || profile?.church_id || profile?.portal_church_id;
    churchName = membership?.church?.name || profile?.church_name;
  }

  if (!churchId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se identificó la iglesia destino' }), { status: 400 });
  }

  // ... (User creation / Upsert membership logic remains same) ...
  let existingUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  try {
    existingUser = await findAuthUserByEmail(email);
  } catch (error) {
    console.error('[portal.iglesia.invite] user lookup failed', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el usuario destino' }), { status: 500 });
  }
  let targetUserId = existingUser?.id || null;

  const baseUrl = resolveBaseUrl(request);
  const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;
  const linkKind = targetUserId ? 'recovery' : 'invite';
  const result = await sendAuthLink({ kind: linkKind, email, redirectTo });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Error enviando invitación' }), { status: 500 });
  }
  if (!targetUserId) {
    targetUserId = result.userId || null;
  }

  if (!targetUserId) return new Response(JSON.stringify({ ok: false, error: 'Error usuario destino' }), { status: 500 });

  await supabaseAdmin
    .from('church_memberships')
    .upsert({
      church_id: churchId,
      user_id: targetUserId,
      role: desiredRole,
      status: 'active', // Auto-active for now
    }, { onConflict: 'church_id,user_id' });

  const portalRole = desiredRole === 'church_admin'
    ? 'pastor'
    : (desiredRole === 'church_member' ? 'local_collaborator' : null);

  if (portalRole) {
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, church_id, city, country')
      .eq('user_id', targetUserId)
      .maybeSingle();

    const currentRole = existingProfile?.role || 'user';
    const shouldUpdateRole = shouldPromoteRole(currentRole, portalRole);
    const blockChurchUpdate = ['admin', 'superadmin'].includes(currentRole) || isCountryScopedRole(currentRole);

    const { data: churchInfo } = await supabaseAdmin
      .from('churches')
      .select('id, name, city, country')
      .eq('id', churchId)
      .maybeSingle();

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };
    if (shouldUpdateRole) {
      updatePayload.role = portalRole;
    }
    if (!blockChurchUpdate) {
      updatePayload.church_id = churchInfo?.id || churchId;
      updatePayload.church_name = churchInfo?.name || churchName;
      if (!existingProfile?.city) {
        updatePayload.city = churchInfo?.city || null;
      }
      if (!existingProfile?.country) {
        updatePayload.country = churchInfo?.country || null;
      }
    }
    if (Object.keys(updatePayload).length > 1) {
      await supabaseAdmin
        .from('user_profiles')
        .upsert({
          user_id: targetUserId,
          email,
          ...updatePayload,
        }, { onConflict: 'user_id' });
    }
  }

  return new Response(JSON.stringify({ ok: true, churchId, churchName }), { status: 200 });
};
