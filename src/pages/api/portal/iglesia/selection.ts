import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, isAdminRole, listUserMemberships } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

export const prerender = false;

type SelectionPayload = {
  churchId?: string | null;
};

type PortalScope = 'global' | 'country' | 'church';

async function getContext(request: Request) {
  const user = await getUserFromRequest(request);
  if (user?.email) {
    const profile = await ensureUserProfile(user);
    const memberships = await listUserMemberships(user.id);
    const hasChurchRole = memberships.some((m: any) =>
      ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
    );
    const role = profile?.role || 'user';
    const isAdmin = Boolean(profile && isAdminRole(role));
    const isNational = role === 'national_pastor';
    const isLocalRole = role === 'pastor' || role === 'local_collaborator';
    const isAllowed = Boolean(profile && (isAdmin || isNational || hasChurchRole || isLocalRole));
    const scope: PortalScope = isAdmin ? 'global' : (isNational ? 'country' : 'church');
    return {
      ok: isAllowed,
      isAdmin,
      isNational,
      scope,
      allowAll: isAdmin || isNational,
      allowCustom: isAdmin,
      canSelect: isAdmin || isNational,
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
    isNational: false,
    scope: 'global' as PortalScope,
    allowAll: true,
    allowCustom: true,
    canSelect: true,
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
  if (ctx.scope === 'global') {
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
  } else if (ctx.scope === 'country') {
    const country = (ctx.profile as any)?.country;
    if (!country) {
      return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { data, error } = await supabaseAdmin
      .from('churches')
      .select('id, code, name, city, country')
      .eq('country', country)
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
    if (!churches.length) {
      const profileChurchId = (ctx.profile as any)?.church_id;
      if (profileChurchId) {
        const { data } = await supabaseAdmin
          .from('churches')
          .select('id, code, name, city, country')
          .eq('id', profileChurchId)
          .maybeSingle();
        if (data) churches = [data];
      }
    }
  }

  let selectedChurchId: string | null = null;
  if (ctx.scope !== 'church') {
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
    if (ctx.scope === 'country' && selectedChurchId && selectedChurchId !== '__all__') {
      const isAllowed = churches.some((church) => church?.id === selectedChurchId);
      if (!isAllowed) selectedChurchId = null;
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
    scope: ctx.scope,
    allowAll: ctx.allowAll,
    allowCustom: ctx.allowCustom,
    canSelect: ctx.canSelect,
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
  if (!ctx.ok || !ctx.canSelect) {
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

  const rawChurchId = payload.churchId?.toString() || null;
  const churchId = rawChurchId === '__all__' ? '__all__' : rawChurchId;

  if (ctx.scope === 'country') {
    const country = (ctx.profile as any)?.country;
    if (!country) {
      return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (churchId && churchId !== '__all__') {
      const { data: church } = await supabaseAdmin
        .from('churches')
        .select('id, country')
        .eq('id', churchId)
        .maybeSingle();
      if (!church?.id || church.country !== country) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
  }

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
