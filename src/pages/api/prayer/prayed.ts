import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { id } = await request.json().catch(() => ({ id: '' }));
  const prayerId = String(id || '');
  if (!supabaseAdmin || !/^[0-9a-f-]{36}$/i.test(prayerId)) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data, error } = await supabaseAdmin
    .from('prayer_requests')
    .select('prayers_count')
    .eq('id', prayerId)
    .eq('approved', true)
    .single();

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const nextCount = Number(data?.prayers_count || 0) + 1;
  const { error: updateError } = await supabaseAdmin
    .from('prayer_requests')
    .update({ prayers_count: nextCount })
    .eq('id', prayerId);

  if (updateError) {
    return new Response(JSON.stringify({ ok: false, error: updateError.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, prayers_count: nextCount }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
