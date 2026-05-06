import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import { updateDonationByReference, type DonationStatus } from '@lib/donationsStore';
import { findWompiTransactionByReference } from '@lib/wompi';

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
  if (!reference) {
    return new Response(JSON.stringify({ ok: false, error: 'Referencia requerida' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const transaction = await findWompiTransactionByReference(reference);
  if (!transaction) {
    return new Response(JSON.stringify({ ok: false, error: 'No se encontró la transacción en Wompi' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const status = normalizeWompiStatus(transaction.status);
  await updateDonationByReference({
    provider: 'wompi',
    reference,
    status,
    providerTxId: transaction.id ? String(transaction.id) : null,
    paymentMethod: resolvePaymentMethod(transaction),
    rawEvent: { source: 'manual_wompi_sync', transaction },
  });

  return new Response(JSON.stringify({
    ok: true,
    status,
    providerTxId: transaction.id ? String(transaction.id) : null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
