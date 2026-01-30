import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { resolveBaseUrl } from '@lib/url';
import { normalizeChurchName, normalizeCityName } from '@lib/normalization';
import { sanitizePlainText } from '@lib/validation';
import { sendAuthLink } from '@lib/authMailer';
import { findAuthUserByEmail } from '@lib/supabaseAdminUsers';

export const prerender = false;

async function getAdminContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    if (!profile || !isAdminRole(profile.role)) {
      return { ok: false, role: null, userId: null };
    }
    return { ok: true, role: profile.role, userId: user.id };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false, role: null, userId: null };
  }
  return { ok: true, role: 'superadmin', userId: null };
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getAdminContext(request);
  if (!ctx.ok) {
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
  const fullName = sanitizePlainText(payload.fullName || '', 120) || null;
  const desiredRole = String(payload.role || 'user');
  const churchRole = String(payload.churchRole || '');
  const churchRaw = normalizeChurchName(payload.church || '');

  if (ctx.role !== 'superadmin' && desiredRole !== 'user') {
    return new Response(JSON.stringify({ ok: false, error: 'No puedes asignar ese rol' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const baseUrl = resolveBaseUrl(request);
  const redirectTo = `${baseUrl}/portal/activar?next=${encodeURIComponent('/portal')}`;

  const existingUser = await findAuthUserByEmail(email);
  let userId = existingUser?.id || null;
  if (!userId) {
    const result = await sendAuthLink({ kind: 'invite', email, redirectTo });
    if (!result.ok) {
      console.error('[portal.admin.invite] invite error', result.error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo enviar invitación' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    userId = result.userId || null;
  }

  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear usuario' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      email,
      full_name: fullName,
      role: desiredRole,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (churchRole && churchRaw) {
    let churchId: string | null = null;
    const { data: existingChurch } = await supabaseAdmin
      .from('churches')
      .select('id, name')
      .ilike('name', churchRaw)
      .maybeSingle();
    if (existingChurch?.id) {
      churchId = existingChurch.id;
    } else {
      const { data: created } = await supabaseAdmin
        .from('churches')
        .insert({
          name: churchRaw,
          city: normalizeCityName(payload.city || ''),
          country: sanitizePlainText(payload.country || '', 40) || null,
          created_by: ctx.userId,
        })
        .select('id')
        .single();
      churchId = created?.id || null;
    }

    if (churchId) {
      await supabaseAdmin
        .from('church_memberships')
        .upsert({
          church_id: churchId,
          user_id: userId,
          role: churchRole,
          status: 'active',
        }, { onConflict: 'church_id,user_id' });
    }
  }

  return new Response(JSON.stringify({ ok: true, userId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
