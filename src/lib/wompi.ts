import crypto from 'node:crypto';
import { logSecurityEvent } from './securityEvents';

const DEFAULT_CHECKOUT_URL = 'https://checkout.wompi.co/p/';
const DEFAULT_API_BASE = 'https://production.wompi.co/v1';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function getPublicKey(): string {
  const value = env('WOMPI_PUBLIC_KEY');
  if (!value) throw new Error('WOMPI_PUBLIC_KEY no está configurado');
  return value;
}

function getPrivateKey(): string {
  const value = env('WOMPI_PRIVATE_KEY');
  if (!value) throw new Error('WOMPI_PRIVATE_KEY no está configurado');
  return value;
}

function getIntegrityKey(): string {
  const value = env('WOMPI_INTEGRITY_KEY');
  if (!value) throw new Error('WOMPI_INTEGRITY_KEY no está configurado');
  return value;
}

function getWebhookSecret(): string {
  const value = env('WOMPI_WEBHOOK_SECRET');
  if (!value) throw new Error('WOMPI_WEBHOOK_SECRET no está configurado');
  return value;
}

export interface WompiCheckoutParams {
  amountInCents: number;
  currency: 'COP';
  description: string;
  redirectUrl: string;
  reference?: string;
  email?: string;
  customerData?: Record<string, string>;
}

const DEFAULT_REFERENCE_PREFIX = 'MINISTERIO';

let acceptanceTokenCache: { token: string; fetchedAt: number } | null = null;

async function getAcceptanceToken(): Promise<string> {
  if (acceptanceTokenCache && Date.now() - acceptanceTokenCache.fetchedAt < 1000 * 60 * 30) {
    return acceptanceTokenCache.token;
  }
  const publicKey = getPublicKey();
  const apiBase = env('WOMPI_API_BASE') ?? DEFAULT_API_BASE;
  const res = await fetch(`${apiBase}/merchants/${publicKey}`);
  if (!res.ok) {
    throw new Error('No se pudo obtener acceptance_token de Wompi');
  }
  const data = await res.json();
  const token = data?.data?.presigned_acceptance?.acceptance_token;
  if (!token) {
    throw new Error('Acceptance token inválido');
  }
  acceptanceTokenCache = { token, fetchedAt: Date.now() };
  return token;
}

export function buildWompiCheckoutUrl(params: WompiCheckoutParams): { url: string; reference: string } {
  const publicKey = getPublicKey();
  const integrity = getIntegrityKey();
  const rawPrefix = env('WOMPI_REFERENCE_PREFIX') || DEFAULT_REFERENCE_PREFIX;
  const prefix = rawPrefix.replace(/[^A-Z0-9_-]/gi, '').toUpperCase() || DEFAULT_REFERENCE_PREFIX;
  const reference = params.reference ?? `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const amount = Math.round(params.amountInCents);
  if (amount <= 0) throw new Error('Monto inválido');

  const signatureBase = `${reference}${amount}${params.currency}${integrity}`;
  const signature = crypto.createHash('sha256').update(signatureBase).digest('hex');
  const checkoutUrl = env('WOMPI_CHECKOUT_URL') ?? DEFAULT_CHECKOUT_URL;
  const url = new URL(checkoutUrl);

  url.searchParams.set('public-key', publicKey);
  url.searchParams.set('amount-in-cents', amount.toString());
  url.searchParams.set('currency', params.currency);
  url.searchParams.set('reference', reference);
  url.searchParams.set('signature:integrity', signature);
  url.searchParams.set('redirect-url', params.redirectUrl);
  url.searchParams.set('collect-person-type', 'true');
  url.searchParams.set('payment-methods', 'CARD,PSE,NEQUI,BALOTO');

  if (params.description) {
    url.searchParams.set('items[0][name]', params.description);
    url.searchParams.set('items[0][quantity]', '1');
    url.searchParams.set('items[0][price-in-cents]', amount.toString());
  }

  if (params.email) {
    url.searchParams.set('customer-data[email]', params.email);
  }

  if (params.customerData) {
    for (const [key, value] of Object.entries(params.customerData)) {
      if (!value) continue;
      url.searchParams.set(`customer-data[${key}]`, value);
    }
  }

  return { url: url.toString(), reference };
}

export async function createWompiCharge(params: {
  amountInCents: number;
  currency: 'COP';
  reference: string;
  customerEmail: string;
  paymentSourceId: string;
}): Promise<{ id: string; status: string } | null> {
  const privateKey = getPrivateKey();
  const acceptanceToken = await getAcceptanceToken();
  const apiBase = env('WOMPI_API_BASE') ?? DEFAULT_API_BASE;

  const res = await fetch(`${apiBase}/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${privateKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount_in_cents: Math.round(params.amountInCents),
      currency: params.currency,
      customer_email: params.customerEmail,
      reference: params.reference,
      payment_source_id: params.paymentSourceId,
      acceptance_token: acceptanceToken,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Wompi charge failed: ${detail}`);
  }
  const data = await res.json();
  return data?.data
    ? { id: String(data.data.id), status: String(data.data.status || 'PENDING') }
    : null;
}

export async function createWompiPaymentSource(params: {
  token: string;
  customerEmail: string;
}): Promise<string | null> {
  const privateKey = getPrivateKey();
  const acceptanceToken = await getAcceptanceToken();
  const apiBase = env('WOMPI_API_BASE') ?? DEFAULT_API_BASE;

  const res = await fetch(`${apiBase}/payment_sources`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${privateKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'CARD',
      token: params.token,
      customer_email: params.customerEmail,
      acceptance_token: acceptanceToken,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Wompi payment source failed: ${detail}`);
  }
  const data = await res.json();
  return data?.data?.id ? String(data.data.id) : null;
}

type ParsedSignature = {
  timestamp: string;
  signature: string;
  properties: Record<string, string>;
};

function parseSignatureHeader(header: string | null): ParsedSignature | null {
  if (!header) return null;
  const parts = header.split(',').map((part) => part.trim());
  const properties: Record<string, string> = {};
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim();
    const value = rest.join('=').trim();
    properties[key] = value;
  }
  const timestamp = properties.timestamp || properties.ts || properties.t;
  const signature = properties.signature || properties.s || properties.sha256;
  if (!timestamp || !signature) return null;
  return { timestamp, signature, properties };
}

export function verifyWompiWebhook(payload: string, signatureHeader: string | null): boolean {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) throw new Error('X-Wompi-Signature inválido');
  const secret = getWebhookSecret();

  // Según la documentación de Wompi, el string se arma concatenando timestamp + payload
  // y se firma con HMAC SHA256 usando el webhook secret.
  const signedData = `${parsed.timestamp}${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedData).digest('hex');
  const received = parsed.signature.toLowerCase();
  if (expected.length !== received.length) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      detail: 'Longitud firma Wompi inesperada',
      meta: { expectedLength: expected.length, receivedLength: received.length },
    });
    return false;
  }
  const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  if (!ok) {
    void logSecurityEvent({
      type: 'webhook_invalid',
      detail: 'Firma Wompi inválida',
      meta: { expected, received: parsed.signature },
    });
  }
  return ok;
}
