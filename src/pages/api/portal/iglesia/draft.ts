import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';

export const prerender = false;

async function getUserId(request: Request): Promise<string | null> {
  const user = await getUserFromRequest(request);
  return user?.id || null;
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const userId = await getUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin
    .from('portal_iglesia_drafts')
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[portal.iglesia.draft] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo cargar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, draft: data?.payload || null }), {
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
  const userId = await getUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error } = await supabaseAdmin
    .from('portal_iglesia_drafts')
    .upsert({
      user_id: userId,
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('[portal.iglesia.draft] save error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const userId = await getUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { error } = await supabaseAdmin
    .from('portal_iglesia_drafts')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[portal.iglesia.draft] delete error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo borrar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
