import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const fullName = sanitizePlainText(payload.fullName || '', 120);
  if (!fullName || containsBlockedSequence(fullName)) {
    return new Response(JSON.stringify({ ok: false, error: 'Nombre invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      full_name: fullName,
    },
  });

  if (error || !data?.user) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar el perfil' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, fullName: data.user.user_metadata?.full_name || fullName }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
