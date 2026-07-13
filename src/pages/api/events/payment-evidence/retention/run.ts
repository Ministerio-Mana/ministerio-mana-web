import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import {
  deleteMicrosoftEventDocument,
  getMicrosoftGraphConfigurationStatus,
  isMicrosoftEventsWriteEnabled,
} from '@lib/microsoftGraph';

export const prerender = false;

const MAX_BATCH_SIZE = 50;

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function safeEqual(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return safeEqual(bearer, secret) || safeEqual(request.headers.get('x-cron-secret'), secret);
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!supabaseAdmin) return json({ ok: false, error: 'Server configuration error' }, 500);
  if (!isMicrosoftEventsWriteEnabled() || !getMicrosoftGraphConfigurationStatus().configured) {
    return json({ ok: false, error: 'Microsoft events storage is not enabled' }, 503);
  }

  const requestedBatch = Number(new URL(request.url).searchParams.get('limit') || 25);
  const batchSize = Number.isFinite(requestedBatch)
    ? Math.min(Math.max(Math.floor(requestedBatch), 1), MAX_BATCH_SIZE)
    : 25;
  const { data, error } = await supabaseAdmin.rpc('claim_event_payment_evidence_retention', {
    batch_size: batchSize,
  });

  if (error) {
    const missingMigration = error.code === '42883' || /claim_event_payment_evidence_retention/i.test(error.message || '');
    return json({
      ok: false,
      error: missingMigration
        ? 'Payment evidence retention migration is pending'
        : 'Could not claim payment evidence retention batch',
    }, missingMigration ? 503 : 500);
  }

  const claimed = Array.isArray(data) ? data : [];
  let deleted = 0;
  let failed = 0;

  for (const evidence of claimed) {
    try {
      await deleteMicrosoftEventDocument(
        String(evidence.sharepoint_drive_id || ''),
        String(evidence.sharepoint_item_id || ''),
      );

      const deletedAt = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from('event_payment_evidence')
        .update({
          deleted_at: deletedAt,
          deletion_started_at: null,
          deletion_last_error: null,
          sharepoint_web_url: null,
        })
        .eq('id', evidence.id)
        .is('deleted_at', null);
      if (updateError) throw updateError;

      const { error: auditError } = await supabaseAdmin.from('event_finance_audit_logs').insert({
        event_id: evidence.event_id,
        registration_id: evidence.registration_id,
        payment_id: evidence.payment_id,
        action: 'MANUAL_PAYMENT_EVIDENCE_RETENTION_DELETED',
        before_data: {
          evidence_id: evidence.id,
          retention_until: evidence.retention_until,
          sharepoint_item_id: evidence.sharepoint_item_id,
        },
        after_data: {
          evidence_id: evidence.id,
          deleted_at: deletedAt,
          binary_deleted: true,
        },
      });
      if (auditError) console.error('[event.evidence-retention] audit failed', auditError);
      deleted += 1;
    } catch (itemError) {
      failed += 1;
      const message = safeErrorMessage(itemError);
      const { error: releaseError } = await supabaseAdmin
        .from('event_payment_evidence')
        .update({
          deletion_started_at: null,
          deletion_last_error: message,
        })
        .eq('id', evidence.id)
        .is('deleted_at', null);
      if (releaseError) console.error('[event.evidence-retention] release failed', releaseError);
      console.error('[event.evidence-retention] deletion failed', {
        evidenceId: evidence.id,
        attempt: evidence.deletion_attempts,
        message,
      });
    }
  }

  return json({
    ok: failed === 0,
    claimed: claimed.length,
    deleted,
    failed,
  }, failed === 0 ? 200 : 500);
};
