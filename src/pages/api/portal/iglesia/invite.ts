import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships, isAdminRole } from '@lib/portalAuth';
import { resolveBaseUrl } from '@lib/url';
import { normalizeChurchName, normalizeCityName } from '@lib/normalization';
import { sanitizePlainText } from '@lib/validation';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';

export const prerender = false;

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  if (!user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const profile = await ensureUserProfile(user);
  if (!profile) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const memberships = await listUserMemberships(user.id);
  const hasChurchAdmin = memberships.some((m: any) => m?.role === 'church_admin' && m?.status !== 'pending');
  const isAdmin = isAdminRole(profile.role);

  if (!isAdmin && !hasChurchAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'Email requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const email = String(payload.email).trim().toLowerCase();
  const desiredRole = String(payload.role || 'church_member');
  if (!isAdmin && desiredRole !== 'church_member') {
    return new Response(JSON.stringify({ ok: false, error: 'Solo puedes invitar delegados' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  let churchId: string | null = null;
  let churchName: string | null = null;
  if (isAdmin) {
    const churchRaw = normalizeChurchName(payload.church || '');
    if (churchRaw) {
      const { data: existing } = await supabaseAdmin
        .from('churches')
        .select('id, name')
        .ilike('name', churchRaw)
        .maybeSingle();
      if (existing?.id) {
        churchId = existing.id;
        churchName = existing.name;
      } else {
        const { data: created } = await supabaseAdmin
          .from('churches')
          .insert({
            name: churchRaw,
            city: normalizeCityName(payload.city || ''),
            country: sanitizePlainText(payload.country || '', 40) || null,
            created_by: isUuid(user.id) ? user.id : null,
          })
          .select('id, name')
          .single();
        churchId = created?.id || null;
        churchName = created?.name || churchRaw;
      }
    }
  } else {
    const membership = memberships.find((m: any) => m?.church?.id);
    churchId = membership?.church?.id || null;
    churchName = membership?.church?.name || null;
  }

  if (!churchId) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const existingUser = await findAuthUserByEmail(email);
  let targetUserId = existingUser?.id || null;

  if (!targetUserId) {
    const baseUrl = resolveBaseUrl(request);
    const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;
    const result = await sendAuthLink({ kind: 'invite', email, redirectTo });
    if (!result.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar invitación' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    targetUserId = result.userId || null;
  }

  if (!targetUserId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear usuario' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  await supabaseAdmin
    .from('church_memberships')
    .upsert({
      church_id: churchId,
      user_id: targetUserId,
      role: desiredRole,
      status: 'active',
    }, { onConflict: 'church_id,user_id' });

  return new Response(JSON.stringify({ ok: true, churchId, churchName }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
