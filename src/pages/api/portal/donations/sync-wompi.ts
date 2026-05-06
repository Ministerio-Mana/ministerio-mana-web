import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { getDonationByReference, updateDonationByReference, type DonationStatus } from '@lib/donationsStore';
import { getWompiTransaction } from '@lib/wompi';

export const prerender = false;

function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

function normalizeWompiStatus(status: unknown): DonationStatus {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'APPROVED') return 'APPROVED';
  if (['DECLINED', 'VOIDED', 'ERROR', 'FAILED'].includes(normalized)) return 'FAILED';
  return 'PENDING';
}

function resolvePaymentMethod(transaction: any): string | null {
  const value = transaction?.payment_method?.type ?? transaction?.payment_method_type ?? null;
  return value ? String(value) : null;
}

async function findStoredWompiEvent(reference: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .select('tx_id, payload, created_at')
    .eq('reference', reference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || error.code === '42703') return null;
    console.error('[portal.donations.sync-wompi] inbox lookup error', error);
    return null;
  }
  return data || null;
}

function extractTransactionId(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });
  }

  const user = await getUserFromRequest(request);
  const passwordSession = user ? null : readPasswordSession(request);
  if (!user && !passwordSession) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  let role = 'superadmin';
  if (user) {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    role = profile?.role || 'user';
  }

  if (!isAdminRole(role)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reference = String(body?.reference || '').trim();
  const submittedTransactionId = extractTransactionId(body?.transactionId);
  if (!reference) {
    return new Response(JSON.stringify({ ok: false, error: 'Referencia requerida' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const donation = await getDonationByReference('wompi', reference);
  if (!donation) {
    return new Response(JSON.stringify({ ok: false, error: 'No se encontró la donación local' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const storedEvent = await findStoredWompiEvent(reference);
  let transaction = storedEvent?.payload?.data?.transaction || null;
  let transactionId = submittedTransactionId
    || extractTransactionId(donation.provider_tx_id)
    || extractTransactionId(transaction?.id)
    || extractTransactionId(storedEvent?.tx_id);

  if (!transaction && transactionId) {
    transaction = await getWompiTransaction(transactionId);
  }

  if (!transaction) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'TRANSACTION_ID_REQUIRED',
      error: 'No tengo el ID de transacción de Wompi para consultar ese pago. Cópialo desde Wompi e inténtalo de nuevo.',
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  transactionId = extractTransactionId(transaction.id) || transactionId;
  const status = normalizeWompiStatus(transaction.status);
  await updateDonationByReference({
    provider: 'wompi',
    reference,
    status,
    providerTxId: transactionId,
    paymentMethod: resolvePaymentMethod(transaction),
    rawEvent: { source: 'manual_wompi_sync', storedEvent: Boolean(storedEvent), transaction },
  });

  return new Response(JSON.stringify({
    ok: true,
    status,
    providerTxId: transactionId,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
