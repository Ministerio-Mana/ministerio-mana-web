import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { resolveBaseUrl } from '@lib/url';
import { normalizeChurchName, normalizeCityName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText } from '@lib/validation';
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

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401 });
  }

  const profile = await ensureUserProfile(user);
  if (!profile) return new Response(JSON.stringify({ ok: false, error: 'Perfil no encontrado' }), { status: 403 });

  // Roles Authorization
  const myRole = profile.role || 'user';
  const memberships = await listUserMemberships(user.id);
  const hasChurchAdmin = memberships.some((m: any) => m?.role === 'church_admin');

  // Can Invite?
  // admins, national_pastor, pastor (implicit church leader), church_admin (explicit membership)
  const canInvite = ['superadmin', 'admin', 'national_pastor', 'pastor'].includes(myRole) || hasChurchAdmin;

  if (!canInvite) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para invitar' }), { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Email requerido' }), { status: 400 });
  }

  const email = String(payload.email).trim().toLowerCase();
  const desiredRole = String(payload.role || 'church_member');
  const requestedChurchId = isUuid(payload.churchId) ? payload.churchId : null;

  // Only Admins can execute creating NEW churches on the fly or inviting global roles
  // Pastors invting collaborators -> usually 'church_member' or 'local_collaborator'

  const isAdmin = ['superadmin', 'admin'].includes(myRole);

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
            created_by: isUuid(user.id) ? user.id : null,
          }).select('id, name').single();
          churchId = created?.id || null;
          churchName = created?.name || churchRaw;
        }
      }
    }
  } else if (myRole === 'national_pastor') {
    // National Pastor -> Can select church in country
    const myCountry = profile.country;
    if (!myCountry) return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), { status: 403 });

    // Verify church is in country
    if (requestedChurchId) {
      const { data: church } = await supabaseAdmin.from('churches').select('id, name, country').eq('id', requestedChurchId).single();
      if (church && church.country === myCountry) {
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
    churchId = membership?.church?.id || profile.church_id || profile.portal_church_id;
    churchName = membership?.church?.name || profile.church_name;
  }

  if (!churchId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se identificó la iglesia destino' }), { status: 400 });
  }

  // ... (User creation / Upsert membership logic remains same) ...
  const existingUser = await findAuthUserByEmail(email);
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
    const blockChurchUpdate = ['admin', 'superadmin', 'national_pastor'].includes(currentRole);

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
