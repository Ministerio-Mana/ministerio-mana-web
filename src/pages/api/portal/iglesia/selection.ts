import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess, listAccessibleChurchIds } from '@lib/portalScope';

export const prerender = false;

type SelectionPayload = {
  churchId?: string | null;
};

type PortalScope = 'global' | 'country' | 'region' | 'church';

async function getContext(request: Request) {
  const access = await getPortalChurchAccessContext(request);
  const scope: PortalScope = access.isAdmin
    ? 'global'
    : (access.isRegional ? 'region' : (access.isNational ? 'country' : 'church'));
  return {
    ...access,
    scope,
    allowAll: access.isAdmin || access.isNational || access.isRegional,
    allowCustom: access.isAdmin,
    canSelect: access.isAdmin || access.isNational || access.isRegional,
    isPassword: access.isPasswordSession,
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
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  let churches: any[] = [];
  if (ctx.scope === 'global') {
    let { data, error } = await supabaseAdmin
      .from('churches')
      .select('id, code, name, city, country, continent')
      .order('continent', { ascending: true, nullsFirst: false })
      .order('country', { ascending: true, nullsFirst: false })
      .order('city', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error?.code === '42703' && /continent/i.test(error?.message || '')) {
      const legacy = await supabaseAdmin
        .from('churches')
        .select('id, code, name, city, country')
        .order('country', { ascending: true, nullsFirst: false })
        .order('city', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
      data = legacy.data;
      error = legacy.error;
    }
    if (error) {
      console.error('[portal.iglesia.selection] churches error', error);
      return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar iglesias' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    churches = data ?? [];
  } else if (ctx.scope === 'country' || ctx.scope === 'region') {
    const scopedChurchIds = await listAccessibleChurchIds(ctx);
    if (!scopedChurchIds.length) {
      const errorMessage = ctx.scope === 'region' ? 'Sin región asignada' : 'Sin país asignado';
      return new Response(JSON.stringify({ ok: false, error: errorMessage }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    let { data, error } = await supabaseAdmin
      .from('churches')
      .select('id, code, name, city, country, continent')
      .in('id', scopedChurchIds)
      .order('city', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error?.code === '42703' && /continent/i.test(error?.message || '')) {
      const legacy = await supabaseAdmin
        .from('churches')
        .select('id, code, name, city, country')
        .in('id', scopedChurchIds)
        .order('city', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
      data = legacy.data;
      error = legacy.error;
    }
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
      const profileChurchId = ctx.allowedChurchId || (ctx.profile as any)?.church_id;
      if (profileChurchId) {
        let { data, error } = await supabaseAdmin
          .from('churches')
          .select('id, code, name, city, country, continent')
          .eq('id', profileChurchId)
          .maybeSingle();
        if (error?.code === '42703' && /continent/i.test(error?.message || '')) {
          const legacy = await supabaseAdmin
            .from('churches')
            .select('id, code, name, city, country')
            .eq('id', profileChurchId)
            .maybeSingle();
          data = legacy.data;
        }
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
    if ((ctx.scope === 'country' || ctx.scope === 'region') && selectedChurchId && selectedChurchId !== '__all__') {
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
  if (!ctx.ok) {
    const denied = mapPortalAccessError(ctx.reason);
    return new Response(JSON.stringify({ ok: false, error: denied.error }), {
      status: denied.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!ctx.canSelect) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 403,
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

  if (ctx.scope === 'country' || ctx.scope === 'region') {
    const hasScope = ctx.scope === 'region' ? ctx.allowedRegionIds.length > 0 : Boolean(ctx.allowedCountry);
    if (!hasScope) {
      const errorMessage = ctx.scope === 'region' ? 'Sin región asignada' : 'Sin país asignado';
      return new Response(JSON.stringify({ ok: false, error: errorMessage }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (churchId && churchId !== '__all__') {
      const isAllowedChurch = await isChurchAllowedForAccess(churchId, ctx);
      if (!isAllowedChurch) {
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
