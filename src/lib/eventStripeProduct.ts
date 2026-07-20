import { ensureStripeFundProduct } from './stripe';
import { resolveEventStripeAccounting } from './stripeAccounting';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

function publicImageUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const base = String(env('PUBLIC_SITE_URL') || 'https://ministeriomana.org').trim();
  try {
    const parsed = raw.startsWith('/') ? new URL(raw, base) : new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function ensureEventStripeProduct(event: {
  id: unknown;
  title: unknown;
  banner_url?: unknown;
}): Promise<string | null> {
  const accounting = resolveEventStripeAccounting({ eventId: event.id, eventTitle: event.title });
  const image = publicImageUrl(event.banner_url);
  const product = await ensureStripeFundProduct({
    accounting,
    imageUrls: image ? [image] : [],
  });
  return product?.id || null;
}
