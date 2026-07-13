import type { APIRoute } from 'astro';
import {
  canUseEventPaymentModeForScope,
  getEventPaymentProvidersForMode,
  getEventProviderPrice,
  isValidEventProviderCurrency,
  normalizeEventOnlinePaymentMode,
} from '@lib/eventPaymentContract.js';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { enforceRateLimit } from '@lib/rateLimit';
import { containsBlockedSequence, sanitizePlainText } from '@lib/validation';

export const prerender = false;

const PROVIDERS = new Set(['NONE', 'WOMPI', 'STRIPE']);
const MANUAL_KINDS = new Set(['CASH', 'BANK_TRANSFER', 'QR_TRANSFER', 'EXTERNAL']);
const EVENT_PAYMENT_ASSETS_BUCKET = String(
  import.meta.env.EVENT_PAYMENT_ASSETS_BUCKET || process.env.EVENT_PAYMENT_ASSETS_BUCKET || 'event-payment-assets',
).trim();

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
    .select('*')
    .eq('id', eventId)
    .maybeSingle();
}

function hasDualPaymentSchema(event: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(event, 'price_cop')
    && Object.prototype.hasOwnProperty.call(event, 'price_usd');
}

function isMissingDualPaymentRpc(error: any): boolean {
  return ['42883', 'PGRST202'].includes(String(error?.code || ''))
    || /set_event_online_payment_options_secure/i.test(String(error?.message || ''));
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const db = supabaseAdmin;
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

  const { data: options, error: optionsError } = await db
    .from('event_payment_options')
    .select('id, kind, provider, currency, label, instructions, external_url, qr_asset_path, requires_evidence, is_active')
    .eq('event_id', event.id)
    .order('created_at', { ascending: true });
  if (optionsError) return json({ ok: false, error: 'No se pudieron consultar los métodos de pago.' }, 500);
  const resolvedOptions = await Promise.all((options || []).map(async (option: any) => {
    let qrSignedUrl: string | null = null;
    if (option.qr_asset_path) {
      const signed = await db.storage
        .from(EVENT_PAYMENT_ASSETS_BUCKET)
        .createSignedUrl(String(option.qr_asset_path), 3600);
      qrSignedUrl = signed.data?.signedUrl || null;
    }
    return { ...option, qr_signed_url: qrSignedUrl };
  }));
  return json({
    ok: true,
    options: resolvedOptions,
    dual_payment_ready: hasDualPaymentSchema(event as Record<string, unknown>),
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Server Config Error' }, 500);
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }
  const allowed = await enforceRateLimit(`event-manual-options:${ctx.userId}`, 60, 30, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > 4_000) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const eventId = String(body.event_id || '').trim();
  const enabled = body.enabled === true;
  const kind = String(body.kind || '').trim().toUpperCase();
  if (!eventId) return json({ ok: false, error: 'Falta el evento.' }, 400);

  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }
  if (enabled && String(event.registration_mode || '').toUpperCase() !== 'INTERNAL') {
    return json({ ok: false, error: 'El pago manual requiere inscripción en Maná.' }, 409);
  }
  if (enabled && String(event.pricing_model || '').toUpperCase() === 'FREE') {
    return json({ ok: false, error: 'Un evento gratuito no necesita pago manual.' }, 409);
  }
  if (enabled) {
    const { data: activeOnline, error: activeOnlineError } = await supabaseAdmin
      .from('event_payment_options')
      .select('id,provider')
      .eq('event_id', event.id)
      .eq('kind', 'ONLINE')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (activeOnlineError) return json({ ok: false, error: 'No se pudo consultar el cobro automático.' }, 500);
    if (activeOnline?.id) {
      return json({ ok: false, error: `${activeOnline.provider === 'WOMPI' ? 'Wompi' : 'Stripe'} ya procesa el cobro automático; desactívalo antes de habilitar pago manual.` }, 409);
    }
  }

  const now = new Date().toISOString();
  if (!enabled) {
    const { error: disableError } = await supabaseAdmin
      .from('event_payment_options')
      .update({ is_active: false, updated_at: now })
      .eq('event_id', event.id)
      .in('provider', ['MANUAL', 'EXTERNAL']);
    if (disableError) return json({ ok: false, error: 'No se pudo actualizar el pago manual.' }, 500);
    await supabaseAdmin.from('event_finance_audit_logs').insert({
      event_id: event.id,
      actor_user_id: ctx.userId,
      action: 'MANUAL_PAYMENT_OPTION_DISABLED',
    });
    return json({ ok: true, enabled: false });
  }

  if (!MANUAL_KINDS.has(kind)) return json({ ok: false, error: 'Tipo de pago manual inválido.' }, 400);
  const label = sanitizePlainText(String(body.label || ''), 80);
  const instructions = sanitizePlainText(String(body.instructions || ''), 700);
  if (!label || label.length < 3 || containsBlockedSequence(String(body.label || ''))) {
    return json({ ok: false, error: 'Escribe un nombre válido para el método de pago.' }, 400);
  }
  if (!instructions || instructions.length < 5 || containsBlockedSequence(String(body.instructions || ''))) {
    return json({ ok: false, error: 'Escribe instrucciones claras para verificar el pago.' }, 400);
  }

  let externalUrl: string | null = null;
  if (kind === 'EXTERNAL') {
    const rawUrl = String(body.external_url || '').trim();
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || rawUrl.length > 500) throw new Error('unsafe');
      externalUrl = parsed.toString();
    } catch {
      return json({ ok: false, error: 'El enlace de pago debe ser una URL HTTPS válida.' }, 400);
    }
  }

  const qrAssetPath = kind === 'QR_TRANSFER' ? String(body.qr_asset_path || '').trim() : null;
  if (kind === 'QR_TRANSFER' && !new RegExp(`^${event.id}/[0-9a-f-]{36}\\.png$`, 'i').test(qrAssetPath || '')) {
    return json({ ok: false, error: 'Sube una imagen QR válida antes de guardar.' }, 400);
  }

  const provider = kind === 'EXTERNAL' ? 'EXTERNAL' : 'MANUAL';
  const currency = String(event.currency || 'COP').toUpperCase();
  const payload = {
    event_id: event.id,
    kind,
    provider,
    currency,
    label,
    instructions,
    external_url: externalUrl,
    qr_asset_path: qrAssetPath,
    requires_evidence: kind !== 'CASH',
    is_active: true,
    updated_at: now,
  };
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('event_payment_options')
    .select('id')
    .eq('event_id', event.id)
    .eq('kind', kind)
    .eq('provider', provider)
    .eq('currency', currency)
    .maybeSingle();
  if (existingError) return json({ ok: false, error: 'No se pudo consultar el pago manual.' }, 500);

  const saveResult = existing?.id
    ? await supabaseAdmin.from('event_payment_options').update(payload).eq('id', existing.id).select('id').single()
    : await supabaseAdmin.from('event_payment_options').insert({ ...payload, created_by: ctx.userId }).select('id').single();
  if (saveResult.error) return json({ ok: false, error: 'No se pudo guardar el pago manual.' }, 500);

  const { error: disableOtherError } = await supabaseAdmin
    .from('event_payment_options')
    .update({ is_active: false, updated_at: now })
    .eq('event_id', event.id)
    .in('provider', ['MANUAL', 'EXTERNAL'])
    .neq('id', saveResult.data.id);
  if (disableOtherError) return json({ ok: false, error: 'El método quedó guardado, pero no se pudieron desactivar los anteriores.' }, 500);

  await supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: event.id,
    actor_user_id: ctx.userId,
    action: 'MANUAL_PAYMENT_OPTION_UPDATED',
    after_data: { kind, provider, currency, label, has_qr: Boolean(qrAssetPath), external_host: externalUrl ? new URL(externalUrl).host : null },
  });
  return json({ ok: true, enabled: true, option_id: saveResult.data?.id });
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
  const requestedMode = String(body.mode || body.provider || '').trim().toUpperCase();
  if (!eventId || (!PROVIDERS.has(requestedMode) && requestedMode !== 'DUAL')) {
    return json({ ok: false, error: 'Evento o modalidad de cobro inválida.' }, 400);
  }
  const mode = normalizeEventOnlinePaymentMode(requestedMode);

  const { data: event, error } = await loadEvent(eventId);
  if (error) return json({ ok: false, error: 'No se pudo consultar el evento.' }, 500);
  if (!event) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permisos financieros para este evento.' }, 403);
  }

  const providers = getEventPaymentProvidersForMode(mode);
  const dualPaymentReady = hasDualPaymentSchema(event as Record<string, unknown>);
  if (!canUseEventPaymentModeForScope(mode, event.scope)) {
    return json({ ok: false, error: 'El cobro Wompi + Stripe está disponible únicamente para eventos globales.' }, 409);
  }
  if (mode === 'DUAL' && !dualPaymentReady) {
    return json({
      ok: false,
      code: 'EVENT_DUAL_PAYMENT_SETUP_REQUIRED',
      error: 'Ejecuta docs/sql/events_dual_currency_payments.sql antes de activar el cobro dual.',
    }, 409);
  }
  if (mode !== 'NONE' && String(event.registration_mode || 'NONE').toUpperCase() !== 'INTERNAL') {
    return json({ ok: false, error: 'El cobro en línea requiere inscripción en Maná.' }, 409);
  }
  if (mode !== 'NONE' && String(event.pricing_model || 'FREE').toUpperCase() === 'FREE') {
    return json({ ok: false, error: 'Un evento gratuito no puede activar cobro en línea.' }, 409);
  }
  if (String(event.pricing_model || '').toUpperCase() === 'PAID') {
    const missingPrice = providers.find((provider: string) => getEventProviderPrice(event, provider) <= 0);
    if (missingPrice) {
      return json({
        ok: false,
        error: missingPrice === 'WOMPI'
          ? 'Escribe el precio para Colombia en pesos.'
          : 'Escribe el precio internacional en dólares.',
      }, 400);
    }
  }

  const now = new Date().toISOString();
  if (dualPaymentReady) {
    const configured = await supabaseAdmin.rpc('set_event_online_payment_options_secure', {
      p_event_id: event.id,
      p_mode: mode,
      p_actor_user_id: ctx.userId,
    });
    if (!configured.error) {
      await supabaseAdmin.from('event_finance_audit_logs').insert({
        event_id: event.id,
        actor_user_id: ctx.userId,
        action: 'PAYMENT_OPTIONS_UPDATED',
        after_data: { mode, providers },
      });
      return json({ ok: true, mode, providers });
    }
    if (!isMissingDualPaymentRpc(configured.error)) {
      console.error('[event-payment-options] atomic update failed', configured.error);
      return json({ ok: false, error: 'No se pudo actualizar el método de pago.' }, 500);
    }
    if (mode === 'DUAL') {
      return json({
        ok: false,
        code: 'EVENT_DUAL_PAYMENT_SETUP_REQUIRED',
        error: 'Ejecuta docs/sql/events_dual_currency_payments.sql antes de activar el cobro dual.',
      }, 409);
    }
  }

  const provider = providers[0] || 'NONE';
  const currency = provider === 'NONE'
    ? String(event.currency || 'COP').toUpperCase()
    : provider === 'WOMPI' ? 'COP' : 'USD';
  if (!isValidEventProviderCurrency(provider, currency)) {
    return json({ ok: false, error: 'La moneda del proveedor no es válida.' }, 400);
  }
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
    const label = provider === 'WOMPI'
      ? 'Colombia · Pago en pesos con Wompi'
      : 'Fuera de Colombia · Pago en dólares con Stripe';
    const save = existing?.id
      ? await supabaseAdmin.from('event_payment_options').update({ label, is_active: true, updated_at: now }).eq('id', existing.id)
      : await supabaseAdmin.from('event_payment_options').insert({
          event_id: event.id,
          kind: 'ONLINE',
          provider,
          currency,
          label,
          requires_evidence: false,
          is_active: true,
          created_by: ctx.userId,
        });
    if (save.error) return json({ ok: false, error: 'No se pudo activar el método de pago.' }, 500);
  }

  await supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: event.id,
    actor_user_id: ctx.userId,
    action: 'PAYMENT_OPTION_UPDATED',
    after_data: { mode, provider, currency },
  });
  return json({ ok: true, mode, providers });
};
