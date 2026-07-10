import crypto from 'node:crypto';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export type EventPaymentProvider = 'WOMPI' | 'STRIPE' | 'MANUAL' | 'EXTERNAL';
export type EventPaymentStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'DECLINED' | 'FAILED' | 'VOIDED' | 'REFUNDED';

const EVENT_PAYMENT_REFERENCE_PREFIX = 'MM-EVT-';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createEventPaymentId(): string {
  return crypto.randomUUID();
}

export function buildEventPaymentReference(paymentId: string): string {
  const normalized = String(paymentId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error('Identificador de pago inválido');
  return `${EVENT_PAYMENT_REFERENCE_PREFIX}${normalized.replaceAll('-', '').toUpperCase()}`;
}

export function isEventPaymentReference(reference?: string | null): boolean {
  return /^MM-EVT-[A-F0-9]{32}$/.test(String(reference || '').trim().toUpperCase());
}

function normalizeProvider(provider: string): EventPaymentProvider {
  const normalized = String(provider || '').trim().toUpperCase();
  if (!['WOMPI', 'STRIPE', 'MANUAL', 'EXTERNAL'].includes(normalized)) {
    throw new Error('Proveedor de pago inválido');
  }
  return normalized as EventPaymentProvider;
}

function normalizeStatus(status: string): EventPaymentStatus {
  const normalized = String(status || '').trim().toUpperCase();
  const aliases: Record<string, EventPaymentStatus> = {
    ERROR: 'FAILED',
    UNPAID: 'PENDING',
    PAID: 'APPROVED',
  };
  const resolved = aliases[normalized] || normalized;
  if (!['PENDING', 'UNDER_REVIEW', 'APPROVED', 'DECLINED', 'FAILED', 'VOIDED', 'REFUNDED'].includes(resolved)) {
    return 'PENDING';
  }
  return resolved as EventPaymentStatus;
}

function shouldIgnoreProviderTransition(
  current: EventPaymentStatus,
  incoming: EventPaymentStatus,
): boolean {
  if (current === 'REFUNDED') return true;
  if (current === 'APPROVED') return incoming !== 'REFUNDED';
  if (['DECLINED', 'FAILED', 'VOIDED'].includes(current)) {
    return incoming === 'PENDING' || incoming === 'UNDER_REVIEW';
  }
  return false;
}

function safeProviderPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > 32_000) return { truncated: true };
    return JSON.parse(serialized);
  } catch {
    return {};
  }
}

async function writeAudit(params: {
  eventId: string;
  registrationId: string;
  paymentId: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
}) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from('event_finance_audit_logs').insert({
    event_id: params.eventId,
    registration_id: params.registrationId,
    payment_id: params.paymentId,
    action: params.action,
    before_data: params.before || null,
    after_data: params.after || null,
    request_id: params.requestId || null,
  });
  if (error) console.error('[event.finance] audit insert failed', error);
}

export async function processEventProviderPayment(params: {
  provider: string;
  reference: string;
  providerTxId: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
  expectedPaymentId?: string | null;
  payload?: Record<string, unknown> | null;
  requestId?: string | null;
}): Promise<{ processed: boolean; outcome: 'PROCESSED' | 'IGNORED' | 'REJECTED'; reason?: string }> {
  if (!supabaseAdmin || !isEventPaymentReference(params.reference)) {
    return { processed: false, outcome: 'IGNORED' };
  }

  const provider = normalizeProvider(params.provider);
  const reference = String(params.reference).trim().toUpperCase();
  const providerTxId = String(params.providerTxId || '').trim();
  const amount = Number(params.amount);
  const currency = String(params.currency || '').trim().toUpperCase();
  const incomingStatus = normalizeStatus(params.status);
  if (!providerTxId || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return { processed: false, outcome: 'REJECTED', reason: 'Datos de proveedor incompletos' };
  }

  const { data: payment, error } = await supabaseAdmin
    .from('event_payments')
    .select('id, event_id, registration_id, provider, provider_tx_id, reference, amount, currency, status')
    .eq('provider', provider)
    .eq('reference', reference)
    .maybeSingle();

  if (error) throw new Error(`No se pudo consultar el pago del evento: ${error.message}`);
  if (!payment) return { processed: false, outcome: 'IGNORED' };

  if (params.expectedPaymentId && payment.id !== params.expectedPaymentId) {
    await writeAudit({
      eventId: payment.event_id,
      registrationId: payment.registration_id,
      paymentId: payment.id,
      action: 'PROVIDER_PAYMENT_ID_MISMATCH',
      before: { expected_payment_id: payment.id },
      after: { received_payment_id: params.expectedPaymentId, provider_tx_id: providerTxId },
      requestId: params.requestId,
    });
    return { processed: false, outcome: 'REJECTED', reason: 'El identificador no coincide con la referencia' };
  }

  const expectedAmount = Number(payment.amount);
  const amountMatches = Math.abs(expectedAmount - amount) < 0.005;
  const currencyMatches = String(payment.currency || '').toUpperCase() === currency;
  const providerPayload = safeProviderPayload(params.payload);
  const now = new Date().toISOString();

  const currentStatus = normalizeStatus(payment.status);
  if (shouldIgnoreProviderTransition(currentStatus, incomingStatus)) {
    return { processed: true, outcome: 'PROCESSED', reason: `Transición ${currentStatus} → ${incomingStatus} ignorada` };
  }

  if (['APPROVED', 'REFUNDED'].includes(incomingStatus) && (!amountMatches || !currencyMatches)) {
    await supabaseAdmin
      .from('event_payments')
      .update({
        provider_tx_id: providerTxId,
        method: params.method || null,
        provider_payload: providerPayload,
        received_at: now,
        updated_at: now,
      })
      .eq('id', payment.id);
    await writeAudit({
      eventId: payment.event_id,
      registrationId: payment.registration_id,
      paymentId: payment.id,
      action: 'PROVIDER_AMOUNT_MISMATCH',
      before: { amount: expectedAmount, currency: payment.currency, status: payment.status },
      after: { amount, currency, provider_tx_id: providerTxId, provider_status: incomingStatus },
      requestId: params.requestId,
    });
    return { processed: false, outcome: 'REJECTED', reason: 'Monto o moneda no coinciden' };
  }

  const updatePayload: Record<string, unknown> = {
    provider_tx_id: providerTxId,
    method: params.method || null,
    provider_payload: providerPayload,
    status: incomingStatus,
    received_at: incomingStatus === 'PENDING' ? null : now,
    updated_at: now,
  };
  if (incomingStatus === 'APPROVED') updatePayload.verified_at = now;

  const { data: changedPayment, error: updateError } = await supabaseAdmin
    .from('event_payments')
    .update(updatePayload)
    .eq('id', payment.id)
    .eq('status', currentStatus)
    .select('id')
    .maybeSingle();
  if (updateError) throw new Error(`No se pudo actualizar el pago del evento: ${updateError.message}`);
  if (!changedPayment?.id) {
    return { processed: true, outcome: 'PROCESSED', reason: 'El pago ya fue procesado por otro evento' };
  }

  if (incomingStatus === 'APPROVED' || incomingStatus === 'REFUNDED') {
    const [{ data: approvedPayments }, { data: registration }, { data: eventSettings }] = await Promise.all([
      supabaseAdmin
        .from('event_payments')
        .select('amount')
        .eq('registration_id', payment.registration_id)
        .eq('status', 'APPROVED'),
      supabaseAdmin
        .from('event_registrations')
        .select('id, total_amount, status, expires_at')
        .eq('id', payment.registration_id)
        .maybeSingle(),
      supabaseAdmin
        .from('events')
        .select('registration_requires_approval')
        .eq('id', payment.event_id)
        .maybeSingle(),
    ]);
    const approvedTotal = (approvedPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (registration) {
      const totalAmount = Number(registration.total_amount || 0);
      const expiry = new Date(registration.expires_at || '').getTime();
      const isExpired = registration.status === 'EXPIRED' || (Number.isFinite(expiry) && expiry <= Date.now());
      if (approvedTotal + 0.005 >= totalAmount) {
        if (isExpired) {
          await writeAudit({
            eventId: payment.event_id,
            registrationId: payment.registration_id,
            paymentId: payment.id,
            action: 'PROVIDER_PAYMENT_AFTER_EXPIRY',
            before: { registration_status: registration.status, expires_at: registration.expires_at },
            after: { payment_status: incomingStatus, provider_tx_id: providerTxId },
            requestId: params.requestId,
          });
        } else {
          const requiresApproval = Boolean(eventSettings?.registration_requires_approval);
          await supabaseAdmin
            .from('event_registrations')
            .update({
              status: requiresApproval ? 'UNDER_REVIEW' : 'CONFIRMED',
              confirmed_at: requiresApproval ? null : now,
              updated_at: now,
            })
            .eq('id', registration.id)
            .not('status', 'in', '(CANCELLED,REFUNDED,EXPIRED)');
        }
      } else if (incomingStatus === 'REFUNDED') {
        await supabaseAdmin
          .from('event_registrations')
          .update({
            status: approvedTotal > 0 ? 'PENDING_PAYMENT' : 'REFUNDED',
            confirmed_at: null,
            updated_at: now,
          })
          .eq('id', registration.id)
          .neq('status', 'CANCELLED');
      }
    }
  }

  await writeAudit({
    eventId: payment.event_id,
    registrationId: payment.registration_id,
    paymentId: payment.id,
    action: `PROVIDER_PAYMENT_${incomingStatus}`,
    before: { status: payment.status, provider_tx_id: payment.provider_tx_id },
    after: { status: incomingStatus, provider_tx_id: providerTxId, amount, currency },
    requestId: params.requestId,
  });
  return { processed: true, outcome: 'PROCESSED' };
}
