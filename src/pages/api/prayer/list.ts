import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

export const GET: APIRoute = async () => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ rows: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const query = supabaseAdmin
    .from('prayer_requests')
    .select('id,first_name,request_text,city,country,prayers_count,created_at')
    .eq('approved', true)
    .order('created_at', { ascending: false })
    .limit(200);

  const { data, error } = await query;
  if (!error) {
    return new Response(JSON.stringify({ rows: data ?? [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const fallback = await supabaseAdmin
    .from('prayer_requests')
    .select('id,first_name,city,country,prayers_count,created_at')
    .eq('approved', true)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (fallback.data ?? []).map((row) => ({ ...row, request_text: '' }));
  return new Response(JSON.stringify({ rows, error: fallback.error?.message ?? error.message }), {
    status: fallback.error ? 500 : 200,
    headers: { 'content-type': 'application/json' },
  });
};
