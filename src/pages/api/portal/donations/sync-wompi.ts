import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
  getDonationByReference,
  updateDonationByReference,
  type DonationRecord,
  type DonationStatus,
} from '@lib/donationsStore';
import { getWompiTransaction } from '@lib/wompi';

export const prerender = false;

function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function allowsManualApproval(): boolean {
  return env('ALLOW_MANUAL_WOMPI_APPROVAL') === 'true';
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

function expectedAmountInCents(donation: DonationRecord): number | null {
  const amount = Number(donation.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function validateTransactionMatchesDonation(params: {
  transaction: any;
  donation: DonationRecord;
  reference: string;
}): { ok: true } | { ok: false; error: string; detail: Record<string, unknown> } {
  const transactionReference = String(params.transaction?.reference || '').trim();
  if (!transactionReference || transactionReference !== params.reference) {
    return {
      ok: false,
      error: 'La transacción de Wompi no corresponde a la referencia local',
      detail: {
        expectedReference: params.reference,
        transactionReference: transactionReference || null,
      },
    };
  }

  const expectedCurrency = String(params.donation.currency || '').trim().toUpperCase();
  const transactionCurrency = String(params.transaction?.currency || '').trim().toUpperCase();
  if (!transactionCurrency || transactionCurrency !== expectedCurrency) {
    return {
      ok: false,
      error: 'La moneda de la transacción no coincide con la donación local',
      detail: {
        expectedCurrency,
        transactionCurrency: transactionCurrency || null,
      },
    };
  }

  const expectedAmount = expectedAmountInCents(params.donation);
  const transactionAmount = Number(params.transaction?.amount_in_cents);
  if (
    expectedAmount == null ||
    !Number.isFinite(transactionAmount) ||
    Math.round(transactionAmount) !== expectedAmount
  ) {
    return {
      ok: false,
      error: 'El monto de la transacción no coincide con la donación local',
      detail: {
        expectedAmountInCents: expectedAmount,
        transactionAmountInCents: Number.isFinite(transactionAmount) ? Math.round(transactionAmount) : null,
      },
    };
  }

  return { ok: true };
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
  if (passwordSession) {
    return new Response(JSON.stringify({ ok: false, error: 'Esta operación requiere una cuenta administrativa individual' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  const role = profile?.role || 'user';

  if (!isAdminRole(role)) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reference = String(body?.reference || '').trim();
  const submittedTransactionId = extractTransactionId(body?.transactionId);
  const manualApprove = body?.manualApprove === true;
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

  let lookupError: string | null = null;
  if (!transaction && transactionId) {
    try {
      transaction = await getWompiTransaction(transactionId);
    } catch (error: any) {
      lookupError = error?.message || 'No se pudo consultar Wompi';
    }
  }

  if (!transaction) {
    if (manualApprove && transactionId) {
      if (!allowsManualApproval()) {
        return new Response(JSON.stringify({
          ok: false,
          code: 'MANUAL_APPROVAL_DISABLED',
          error: 'La aprobación manual está deshabilitada. Revisa la configuración de Wompi o reenvía el evento desde Wompi.',
          detail: lookupError,
        }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }

      await updateDonationByReference({
        provider: 'wompi',
        reference,
        status: 'APPROVED',
        providerTxId: transactionId,
        paymentMethod: donation.payment_method,
        rawEvent: {
          source: 'manual_wompi_admin_approval',
          reason: 'Admin confirmed approved status in Wompi dashboard',
          reference,
          transactionId,
          lookupError,
          previousStatus: donation.status,
          amount: donation.amount,
          currency: donation.currency,
          approvedAt: new Date().toISOString(),
        },
      });

      return new Response(JSON.stringify({
        ok: true,
        status: 'APPROVED',
        providerTxId: transactionId,
        manual: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: false,
      code: transactionId ? 'WOMPI_LOOKUP_FAILED' : 'TRANSACTION_ID_REQUIRED',
      error: transactionId
        ? 'No pude consultar Wompi con ese ID. Revisa la configuración de Wompi o reenvía el evento desde Wompi.'
        : 'No tengo el ID de transacción de Wompi para consultar ese pago. Cópialo desde Wompi e inténtalo de nuevo.',
      detail: lookupError,
      manualAvailable: allowsManualApproval(),
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const transactionMatch = validateTransactionMatchesDonation({ transaction, donation, reference });
  if (!transactionMatch.ok) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'WOMPI_TRANSACTION_MISMATCH',
      error: transactionMatch.error,
      detail: transactionMatch.detail,
    }), {
      status: 409,
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
