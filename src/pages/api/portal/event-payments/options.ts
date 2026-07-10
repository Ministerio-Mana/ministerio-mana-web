import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { enforceRateLimit } from '@lib/rateLimit';

export const prerender = false;

const PROVIDERS = new Set(['NONE', 'WOMPI', 'STRIPE']);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function loadEvent(eventId: string) {
  if (!supabaseAdmin) return { data: null, error: new Error('Server Config Error') };
  return supabaseAdmin
    .from('events')
    .select('id, title, scope, church_id, region_id, country, currency, price, pricing_model, registration_mode')
    .eq('id', eventId)
    .maybeSingle();
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);

  const eventId = String(url.searchParams.get('event_id') || '').trim();
  if (!eventId) return json({ ok: false, error: 'Falta el evento.' }, 400);
  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }

  const { data: options, error: optionsError } = await supabaseAdmin
    .from('event_payment_options')
    .select('id, kind, provider, currency, label, requires_evidence, is_active')
    .eq('event_id', event.id)
    .order('created_at', { ascending: true });
  if (optionsError) return json({ ok: false, error: 'No se pudieron consultar los métodos de pago.' }, 500);
  return json({ ok: true, options: options || [] });
};

export const PUT: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }
  const allowed = await enforceRateLimit(`event-payment-options:${ctx.userId}`, 60, 30, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > 2_000) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const eventId = String(body.event_id || '').trim();
  const provider = String(body.provider || '').trim().toUpperCase();
  if (!eventId || !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'Evento o proveedor inválido.' }, 400);
  }

  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }

  const currency = String(event.currency || 'COP').toUpperCase();
  if (provider !== 'NONE' && String(event.registration_mode || 'NONE').toUpperCase() !== 'INTERNAL') {
    return json({ ok: false, error: 'El cobro en línea requiere inscripción en Maná.' }, 409);
  }
  if (provider !== 'NONE' && String(event.pricing_model || 'FREE').toUpperCase() === 'FREE') {
    return json({ ok: false, error: 'Un evento gratuito no puede activar cobro en línea.' }, 409);
  }
  if (provider === 'WOMPI' && currency !== 'COP') {
    return json({ ok: false, error: 'Wompi solo puede activarse para eventos en COP.' }, 400);
  }
  if (provider === 'STRIPE' && !['USD', 'EUR', 'COP'].includes(currency)) {
    return json({ ok: false, error: 'Stripe no admite la moneda configurada.' }, 400);
  }

  const now = new Date().toISOString();
  const { error: disableError } = await supabaseAdmin
    .from('event_payment_options')
    .update({ is_active: false, updated_at: now })
    .eq('event_id', event.id)
    .eq('kind', 'ONLINE');
  if (disableError) return json({ ok: false, error: 'No se pudo actualizar el método de pago.' }, 500);

  if (provider !== 'NONE') {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('event_payment_options')
      .select('id')
      .eq('event_id', event.id)
      .eq('kind', 'ONLINE')
      .eq('provider', provider)
      .eq('currency', currency)
      .limit(1)
      .maybeSingle();
    if (existingError) return json({ ok: false, error: 'No se pudo consultar el método de pago.' }, 500);

    if (existing?.id) {
      const { error: updateError } = await supabaseAdmin
        .from('event_payment_options')
        .update({ is_active: true, updated_at: now })
        .eq('id', existing.id);
      if (updateError) return json({ ok: false, error: 'No se pudo activar el método de pago.' }, 500);
    } else {
      const { error: insertError } = await supabaseAdmin.from('event_payment_options').insert({
        event_id: event.id,
        kind: 'ONLINE',
        provider,
        currency,
        label: provider === 'WOMPI' ? 'Pago en línea · Wompi' : 'Pago en línea · Stripe',
        requires_evidence: false,
        is_active: true,
        created_by: ctx.userId,
      });
      if (insertError) return json({ ok: false, error: 'No se pudo activar el método de pago.' }, 500);
    }
  }

  await supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: event.id,
    actor_user_id: ctx.userId,
    action: 'PAYMENT_OPTION_UPDATED',
    after_data: { provider, currency },
  });
  return json({ ok: true, provider, currency });
};
