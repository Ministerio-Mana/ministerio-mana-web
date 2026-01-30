import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';

export const prerender = false;

type AffiliationType = 'local' | 'online' | 'none';

function isValidAffiliation(value: any): value is AffiliationType {
  return value === 'local' || value === 'online' || value === 'none';
}

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

  const fullName = sanitizePlainText(payload.full_name || payload.fullName || '', 120);
  if (fullName && containsBlockedSequence(fullName)) {
    return new Response(JSON.stringify({ ok: false, error: 'Nombre invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const phone = sanitizePlainText(payload.phone || '', 32);
  const city = sanitizePlainText(payload.city || '', 80);
  const country = sanitizePlainText(payload.country || '', 80);
  const affiliationType = isValidAffiliation(payload.affiliation_type || payload.affiliationType)
    ? (payload.affiliation_type || payload.affiliationType)
    : null;
  const churchName = sanitizePlainText(payload.church_name || payload.churchName || '', 120);
  const churchId = payload.church_id || payload.churchId || null;

  if (affiliationType === 'local' && !churchName && !churchId) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona una sede o escribe el nombre de tu iglesia' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const updatePayload = {
    full_name: fullName || null,
    phone: phone || null,
    city: city || null,
    country: country || null,
    affiliation_type: affiliationType,
    church_name: churchName || null,
    church_id: churchId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: user.id,
      email: user.email?.toLowerCase(),
      ...updatePayload,
    }, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) {
    console.error('[portal.profile] update error', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar el perfil' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (fullName) {
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        full_name: fullName,
      },
    });
  }

  return new Response(JSON.stringify({ ok: true, profile: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
