import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin';

export type WompiInboxProcessingStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'REJECTED' | 'FAILED';

export type StoredWompiEvent = {
  bodySha256: string;
  stored: boolean;
  enhancedSchema: boolean;
};

export type RetryableWompiEvent = {
  body_sha256: string;
  tx_id: string | null;
  reference: string | null;
  payload: any;
};

function isMissingRelationOrColumn(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === '42703'
    || message.includes('does not exist')
    || message.includes('schema cache');
}

function extractEventFields(event: any) {
  const transaction = event?.data?.transaction;
  return {
    tx_id: transaction?.id ? String(transaction.id) : null,
    reference: transaction?.reference ? String(transaction.reference) : null,
    status: transaction?.status ? String(transaction.status) : null,
    currency: transaction?.currency ? String(transaction.currency) : null,
    amount_in_cents: Number.isFinite(Number(transaction?.amount_in_cents))
      ? Math.round(Number(transaction.amount_in_cents))
      : null,
  };
}

export function wompiPayloadSha256(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export async function storeWompiEvent(params: {
  payload: string;
  event: any;
  source: 'DIRECT' | 'FORWARDED';
}): Promise<StoredWompiEvent> {
  const bodySha256 = wompiPayloadSha256(params.payload);
  if (!supabaseAdmin) {
    return { bodySha256, stored: false, enhancedSchema: false };
  }

  const baseRecord = {
    body_sha256: bodySha256,
    ...extractEventFields(params.event),
    raw_body: params.payload,
    payload: params.event,
    parse_error: null,
  };
  const enhancedRecord = {
    ...baseRecord,
    source: params.source,
    processing_status: 'RECEIVED',
    processing_attempts: 0,
    processed_at: null,
    last_processing_error: null,
    updated_at: new Date().toISOString(),
  };

  const enhanced = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .upsert(enhancedRecord, { onConflict: 'body_sha256', ignoreDuplicates: true });
  if (!enhanced.error) {
    return { bodySha256, stored: true, enhancedSchema: true };
  }
  if (!isMissingRelationOrColumn(enhanced.error)) {
    console.error('[wompi.inbox] insert error', enhanced.error);
    return { bodySha256, stored: false, enhancedSchema: true };
  }

  const fallback = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .upsert(baseRecord, { onConflict: 'body_sha256', ignoreDuplicates: true });
  if (fallback.error) {
    if (!isMissingRelationOrColumn(fallback.error)) {
      console.error('[wompi.inbox] fallback insert error', fallback.error);
    }
    return { bodySha256, stored: false, enhancedSchema: false };
  }
  return { bodySha256, stored: true, enhancedSchema: false };
}

export async function markWompiEventProcessed(params: {
  bodySha256: string;
  status: WompiInboxProcessingStatus;
  error?: string | null;
}): Promise<void> {
  if (!supabaseAdmin || !params.bodySha256) return;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .update({
      processing_status: params.status,
      processing_attempts: 1,
      processed_at: ['PROCESSED', 'IGNORED', 'REJECTED'].includes(params.status) ? now : null,
      last_processing_error: params.error ? params.error.slice(0, 500) : null,
      updated_at: now,
    })
    .eq('body_sha256', params.bodySha256);
  if (error && !isMissingRelationOrColumn(error)) {
    console.error('[wompi.inbox] status update error', error);
  }
}

export async function listRetryableWompiEvents(limit = 50): Promise<RetryableWompiEvent[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .select('body_sha256, tx_id, reference, payload')
    .in('processing_status', ['RECEIVED', 'FAILED'])
    .order('received_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (!isMissingRelationOrColumn(error)) {
      console.error('[wompi.inbox] retry lookup error', error);
    }
    return [];
  }
  return (data || []) as RetryableWompiEvent[];
}
