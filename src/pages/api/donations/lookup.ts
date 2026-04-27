import type { APIRoute } from 'astro';
import { getDonationByReference } from '@lib/donationsStore';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const provider = (url.searchParams.get('provider') || '').toLowerCase();
  const reference = (url.searchParams.get('reference') || '').trim();

  if (!provider || !reference) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const donation = await getDonationByReference(provider, reference);
  if (!donation) {
    return new Response(JSON.stringify({ ok: false, error: 'No encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    donation: {
      provider: donation.provider,
      status: donation.status,
      amount: donation.amount,
      currency: donation.currency,
      donation_type: donation.donation_type,
      is_recurring: donation.is_recurring,
      payment_method: donation.payment_method,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
