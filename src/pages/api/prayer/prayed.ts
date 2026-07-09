import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

function json(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isMissingModerationColumn(error: any): boolean {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /visibility|moderation_status/i.test(message)
  );
}

function isMissingIncrementFunction(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST202' || message.includes('increment_public_prayer_count');
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const { id } = await request.json().catch(() => ({ id: '' }));
  const prayerId = String(id || '');
  if (!supabaseAdmin || !/^[0-9a-f-]{36}$/i.test(prayerId)) {
    return json({ ok: false });
  }

  const allowed = await enforceRateLimit(
    `prayer.prayed:${clientAddress ?? 'unknown'}:${prayerId}`,
    60,
    5,
  );
  if (!allowed) {
    return json({ ok: false, error: 'Espera un momento antes de volver a marcar esta petición.' }, 429);
  }

  const increment = await supabaseAdmin.rpc('increment_public_prayer_count', {
    prayer_id: prayerId,
  });
  if (!increment.error) {
    if (increment.data === null || increment.data === undefined) return json({ ok: false }, 404);
    const nextCount = Number(increment.data);
    if (!Number.isFinite(nextCount)) return json({ ok: false }, 404);
    return json({ ok: true, prayers_count: nextCount });
  }
  if (!isMissingIncrementFunction(increment.error)) {
    return json({ ok: false, error: 'No se pudo registrar la oración.' }, 500);
  }

  // Compatibilidad temporal hasta ejecutar docs/sql/portal_security_hardening.sql.
  const result = await supabaseAdmin
    .from('prayer_requests')
    .select('prayers_count,visibility,moderation_status')
    .eq('id', prayerId)
    .eq('approved', true)
    .eq('visibility', 'public')
    .eq('moderation_status', 'approved')
    .single();

  let data = result.data;
  let error = result.error;

  if (error && isMissingModerationColumn(error)) {
    const fallback = await supabaseAdmin
      .from('prayer_requests')
      .select('prayers_count')
      .eq('id', prayerId)
      .eq('approved', true)
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return json({ ok: false, error: 'No se pudo registrar la oración.' }, 500);
  }

  const nextCount = Number(data?.prayers_count || 0) + 1;
  const { error: updateError } = await supabaseAdmin
    .from('prayer_requests')
    .update({ prayers_count: nextCount })
    .eq('id', prayerId);

  if (updateError) {
    return json({ ok: false, error: 'No se pudo registrar la oración.' }, 500);
  }

  return json({ ok: true, prayers_count: nextCount });
};
