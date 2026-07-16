import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getFinanceAccessContext } from '@lib/financeAccess';
import { financeScopeCanAccessRecord } from '@lib/financeScope';
import {
  getDonationByReference,
  updateDonationByReference,
} from '@lib/donationsStore';
import { getWompiTransaction } from '@lib/wompi';
import { processWompiDonationTransaction } from '@lib/wompiDonationEvents';

export const prerender = false;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function allowsManualApproval(): boolean {
  return env('ALLOW_MANUAL_WOMPI_APPROVAL') === 'true';
}

async function findStoredWompiEvent(reference: string): Promise<any | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('mm_wompi_event_inbox')
    .select('tx_id, payload, received_at')
    .eq('reference', reference)
    .order('received_at', { ascending: false })
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
    return json({ ok: false, error: 'La conexión financiera del servidor no está configurada.' }, 500);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) {
    return json({ ok: false, error: 'Origen de solicitud inválido.' }, 403);
  }

  const financeContext = await getFinanceAccessContext(request);
  if (!financeContext.ok) {
    return json({ ok: false, error: financeContext.error }, financeContext.status);
  }
  if (financeContext.isPasswordSession || !financeContext.userId) {
    return json({
      ok: false,
      error: 'Esta operación requiere iniciar sesión con una cuenta administrativa individual.',
    }, 403);
  }

  const body = await request.json().catch(() => null);
  const reference = String(body?.reference || '').trim();
  const submittedTransactionId = extractTransactionId(body?.transactionId);
  const manualApprove = body?.manualApprove === true;
  if (!reference) {
    return json({ ok: false, error: 'Referencia requerida' }, 400);
  }
  if (submittedTransactionId && submittedTransactionId === reference) {
    return json({
      ok: false,
      code: 'REFERENCE_IS_NOT_TRANSACTION_ID',
      error: 'Pegaste la referencia del Portal. Abre el detalle del pago en Wompi y copia el valor “Transacción #”, por ejemplo 1178211-1783194180-26798.',
    }, 400);
  }

  const donation = await getDonationByReference('wompi', reference);
  if (!donation) {
    return json({ ok: false, error: 'No se encontró la donación local' }, 404);
  }
  if (!financeScopeCanAccessRecord(financeContext.access, donation)) {
    return json({
      ok: false,
      error: 'No tienes alcance financiero para conciliar esta donación.',
    }, 403);
  }

  const storedEvent = await findStoredWompiEvent(reference);
  const storedTransaction = storedEvent?.payload?.data?.transaction || null;
  let transaction: any = null;
  let transactionId = submittedTransactionId
    || extractTransactionId(donation.provider_tx_id)
    || extractTransactionId(storedTransaction?.id)
    || extractTransactionId(storedEvent?.tx_id);

  let lookupError: string | null = null;
  if (transactionId) {
    try {
      transaction = await getWompiTransaction(transactionId);
    } catch (error: any) {
      lookupError = error?.message || 'No se pudo consultar Wompi';
    }
  }
  transaction ||= storedTransaction;

  if (!transaction) {
    if (manualApprove && transactionId) {
      if (!allowsManualApproval()) {
        return json({
          ok: false,
          code: 'MANUAL_APPROVAL_DISABLED',
          error: 'La aprobación manual está deshabilitada. Revisa la configuración de Wompi o reenvía el evento desde Wompi.',
          detail: lookupError,
        }, 403);
      }

      const updatedRows = await updateDonationByReference({
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
      if (updatedRows !== 1) {
        return json({ ok: false, error: 'La referencia local no es única' }, 409);
      }

      return json({
        ok: true,
        status: 'APPROVED',
        providerTxId: transactionId,
        manual: true,
      });
    }

    return json({
      ok: false,
      code: transactionId ? 'WOMPI_LOOKUP_FAILED' : 'TRANSACTION_ID_REQUIRED',
      error: transactionId
        ? 'No pude consultar Wompi con esa “Transacción #”. Revisa que copiaste el número completo desde el detalle de Wompi.'
        : 'Wompi no entregó el ID de esta referencia. Abre el detalle del pago y copia el valor “Transacción #”; no copies la referencia.',
      detail: lookupError,
      manualAvailable: allowsManualApproval(),
    }, 400);
  }

  const event = transaction === storedTransaction && storedEvent?.payload
    ? storedEvent.payload
    : {
        event: 'transaction.reconciled',
        timestamp: Date.now(),
        source: 'manual_wompi_sync',
        data: { transaction },
      };
  const result = await processWompiDonationTransaction({ event, transaction });
  if (result.outcome === 'REJECTED') {
    return json({
      ok: false,
      code: 'WOMPI_TRANSACTION_MISMATCH',
      error: 'La transacción de Wompi no coincide con la referencia, el monto o la moneda local',
      detail: result.reason || null,
    }, 409);
  }
  if (!result.processed) {
    return json({ ok: false, error: 'No se pudo conciliar la donación local' }, 409);
  }

  transactionId = extractTransactionId(transaction.id) || transactionId;

  return json({
    ok: true,
    status: result.status,
    providerTxId: transactionId,
  });
};
