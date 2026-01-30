import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole, listUserMemberships } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

type SelectionPayload = {
  churchId?: string | null;
};

async function getContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    const isAdmin = Boolean(profile && isAdminRole(profile.role));
    const isAllowed = Boolean(profile && (isAdmin || hasChurchRole));
    return {
      ok: isAllowed,
      isAdmin,
      profile,
      memberships,
      email: user.email?.toLowerCase() || null,
      userId: user.id,
      isPassword: false,
    };
  }

  const passwordSession = readPasswordSession(request);
  if (!passwordSession?.email) {
    return { ok: false };
  }

  return {
    ok: true,
    isAdmin: true,
    profile: null,
    memberships: [],
    email: passwordSession.email.toLowerCase(),
    userId: null,
    isPassword: true,
  };
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let churches: any[] = [];
  if (ctx.isAdmin) {
    const { data, error } = await supabaseAdmin
      .from('churches')
      .select('id, code, name, city, country')
      .order('name', { ascending: true });
    if (error) {
      console.error('[portal.iglesia.selection] churches error', error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar iglesias' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    churches = data ?? [];
  } else {
    churches = (ctx.memberships || []).map((m: any) => m?.church).filter(Boolean);
  }

  let selectedChurchId: string | null = null;
  if (ctx.isAdmin) {
    if (ctx.isPassword && ctx.email) {
      const { data } = await supabaseAdmin
        .from('portal_admin_selections')
        .select('church_id')
        .eq('email', ctx.email)
        .maybeSingle();
      selectedChurchId = data?.church_id ?? null;
    } else {
      selectedChurchId = (ctx.profile as any)?.portal_church_id ?? null;
    }
  } else {
    selectedChurchId = ctx.memberships?.find((m: any) => m?.church?.id)?.church?.id
      || (ctx.profile as any)?.church_id
      || null;
  }

  return new Response(JSON.stringify({
    ok: true,
    churches,
    selectedChurchId,
    isAdmin: ctx.isAdmin,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ctx = await getContext(request);
  if (!ctx.ok || !ctx.isAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: SelectionPayload = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const churchId = payload.churchId?.toString() || null;

  if (ctx.isPassword) {
    const { error } = await supabaseAdmin
      .from('portal_admin_selections')
      .upsert({
        email: ctx.email,
        church_id: churchId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email' });
    if (error) {
      console.error('[portal.iglesia.selection] save error', error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  } else {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({
        portal_church_id: churchId,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', ctx.userId);
    if (error) {
      console.error('[portal.iglesia.selection] save error', error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, churchId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
