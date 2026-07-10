import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { logSecurityEvent } from '@lib/securityEvents';
import { getWompiTransaction } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';
import { listRetryableWompiEvents, markWompiEventProcessed } from '@lib/wompiEventInbox';

export const prerender = false;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function matchesSecret(value: string | null, secret: string): boolean {
  if (!value) return false;
  const candidate = Buffer.from(value);
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function isAuthorized(request: Request): boolean {
  const secret = env('CRON_SECRET');
  const production = (env('VERCEL_ENV') || env('NODE_ENV')) === 'production';
  if (!secret) return !production;
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
  return matchesSecret(bearer, secret) || matchesSecret(request.headers.get('x-cron-secret'), secret);
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      identifier: 'wompi.reconcile-pending',
      detail: 'Cron secret inválido',
    });
    return json({ ok: false, error: 'No autorizado' }, 401);
  }
  if (!supabaseAdmin) {
    return json({ ok: false, error: 'Supabase no configurado' }, 500);
  }

  const stats = {
    inboxProcessed: 0,
    donationsChecked: 0,
    donationsUpdated: 0,
    pending: 0,
    rejected: 0,
    errors: 0,
  };

  const retryableEvents = await listRetryableWompiEvents(20);
  for (const storedEvent of retryableEvents) {
    try {
      const transaction = storedEvent.payload?.data?.transaction;
      const result = await processWompiDonationTransaction({ event: storedEvent.payload, transaction });
      const status = result.outcome === 'PROCESSED'
        ? 'PROCESSED'
        : result.outcome === 'REJECTED'
          ? 'REJECTED'
          : 'IGNORED';
      await markWompiEventProcessed({
        bodySha256: storedEvent.body_sha256,
        status,
        error: result.reason || null,
      });
      if (result.processed) stats.inboxProcessed += 1;
      if (result.outcome === 'REJECTED') stats.rejected += 1;
    } catch (error: any) {
      stats.errors += 1;
      await markWompiEventProcessed({
        bodySha256: storedEvent.body_sha256,
        status: 'FAILED',
        error: error?.message || 'Reintento Wompi fallido',
      });
    }
  }

  const { data: pendingDonations, error: pendingError } = await supabaseAdmin
    .from('donations')
    .select('reference, provider_tx_id')
    .eq('provider', 'wompi')
    .eq('status', 'PENDING')
    .not('provider_tx_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(20);
  if (pendingError) {
    console.error('[wompi.reconcile-pending] lookup error', pendingError);
    return json({ ok: false, error: 'No se pudieron cargar pagos pendientes' }, 500);
  }

  for (const donation of pendingDonations || []) {
    const transactionId = String(donation.provider_tx_id || '').trim();
    const reference = String(donation.reference || '').trim();
    if (!transactionId || !reference) continue;
    stats.donationsChecked += 1;
    try {
      const transaction = await getWompiTransaction(transactionId);
      const event = {
        event: 'transaction.reconciled',
        timestamp: Date.now(),
        source: 'wompi_pending_cron',
        data: { transaction },
      };
      const result = await processWompiDonationTransaction({ event, transaction });
      if (result.outcome === 'REJECTED') {
        stats.rejected += 1;
      } else if (result.processed && result.status === 'PENDING') {
        stats.pending += 1;
      } else if (result.processed) {
        stats.donationsUpdated += 1;
      }
    } catch (error: any) {
      stats.errors += 1;
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'wompi.reconcile-pending',
        detail: error?.message || 'No se pudo consultar pago pendiente',
        meta: { reference, transactionId },
      });
    }
  }

  return json({ ok: true, ...stats }, 200);
};

export const GET = POST;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
