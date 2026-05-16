import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status/i.test(message)
  );
}

export const GET: APIRoute = async () => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ rows: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const query = supabaseAdmin
    .from('prayer_requests')
    .select('id,first_name,request_text,city,country,prayers_count,visibility,moderation_status,approved,created_at')
    .eq('approved', true)
    .eq('visibility', 'public')
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: false })
    .limit(200);

  const { data, error } = await query;
  if (!error) {
    return new Response(JSON.stringify({ rows: data ?? [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (isMissingModerationColumn(error)) {
    const legacy = await supabaseAdmin
      .from('prayer_requests')
      .select('id,first_name,request_text,city,country,prayers_count,approved,created_at')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(200);

    const rows = (legacy.data ?? []).map((row) => ({
      ...row,
      visibility: 'public',
      moderation_status: 'approved',
    }));
    return new Response(JSON.stringify({ rows, error: legacy.error?.message }), {
      status: legacy.error ? 500 : 200,
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
