import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { createEventPaymentId } from '@lib/eventFinance';
import { createEventCheckout, EventCheckoutError, type EventCheckoutProvider } from '@lib/eventCheckout';

export const prerender = false;

const PROVIDERS = new Set(['WOMPI', 'STRIPE']);
const MAX_BODY_CHARS = 2_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function normalizeIdempotencyKey(request: Request, registrationId: string): string {
  const raw = String(request.headers.get('idempotency-key') || '').trim();
  const key = /^[A-Za-z0-9._:-]{16,120}$/.test(raw) ? raw : createEventPaymentId();
  return `event-checkout:${registrationId}:${key}`;
}

export const POST: APIRoute = async ({ request }) => {
  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta operación requiere una cuenta individual.' }, 403);
  }

  const allowed = await enforceRateLimit(`event-checkout:${ctx.userId}`, 60, 20, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Solicitud inválida.' }, 400);
  }

  const registrationId = String(body.registration_id || '').trim();
  const provider = String(body.provider || '').trim().toUpperCase();
  if (!registrationId || !PROVIDERS.has(provider)) {
    return json({ ok: false, error: 'Inscripción o proveedor inválido.' }, 400);
  }

  try {
    const result = await createEventCheckout({
      request,
      registrationId,
      provider: provider as EventCheckoutProvider,
      idempotencyKey: normalizeIdempotencyKey(request, registrationId),
      actorUserId: ctx.userId,
      authorizeEvent: (event) => canActorOperateEventPayments(ctx, event),
    });
    return json({
      ok: true,
      payment_id: result.paymentId,
      reference: result.reference,
      checkout_url: result.checkoutUrl,
      reused: result.reused,
    });
  } catch (error) {
    const status = error instanceof EventCheckoutError ? error.status : 500;
    const message = error instanceof EventCheckoutError ? error.message : 'No se pudo generar el cobro.';
    return json({ ok: false, error: message }, status);
  }
};
