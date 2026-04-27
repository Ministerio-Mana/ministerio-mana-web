import type { APIRoute } from 'astro';
import { getDonationByReference } from '@lib/donationsStore';
import { upsertDonationReminderSubscription } from '@lib/donationReminders';

export const prerender = false;

function getBogotaDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addMonths(dateString: string, months: number): string {
  const date = new Date(`${dateString}T00:00:00-05:00`);
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < day) {
    date.setDate(0);
  }
  return getBogotaDateString(date);
}

function parseChannels(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).toLowerCase()).filter(Boolean);
  }
  return String(raw).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export const POST: APIRoute = async ({ request }) => {
  let payload: any = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const provider = String(payload.provider || '').toLowerCase();
  const reference = String(payload.reference || '').trim();
  const months = Number(payload.months || 3);
  const channels = parseChannels(payload.channels);

  if (!provider || !reference) {
    return new Response(JSON.stringify({ ok: false, error: 'Datos incompletos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!channels.length) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona al menos un canal' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!Number.isFinite(months) || months < 1 || months > 12) {
    return new Response(JSON.stringify({ ok: false, error: 'Periodo inválido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const donation = await getDonationByReference(provider, reference);
  if (!donation) {
    return new Response(JSON.stringify({ ok: false, error: 'Donación no encontrada' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (donation.provider !== 'wompi') {
    return new Response(JSON.stringify({ ok: false, error: 'Recordatorios solo disponibles en Wompi' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!donation.is_recurring) {
    return new Response(JSON.stringify({ ok: false, error: 'La donación no es recurrente' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if ((donation.donation_type || '') !== 'diezmos') {
    return new Response(JSON.stringify({ ok: false, error: 'Recordatorio disponible solo para diezmos' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const today = getBogotaDateString();
  const startDate = addMonths(today, 1);
  const endDate = addMonths(startDate, Math.max(months - 1, 0));

  try {
    const subscription = await upsertDonationReminderSubscription({
      donationId: donation.id ?? null,
      provider: donation.provider,
      reference: donation.reference || reference,
      donationType: donation.donation_type ?? null,
      amount: typeof donation.amount === 'number' ? donation.amount : Number(donation.amount || 0),
      currency: donation.currency || 'COP',
      donorName: donation.donor_name ?? null,
      donorEmail: donation.donor_email ?? null,
      donorPhone: donation.donor_phone ?? null,
      channels,
      startDate,
      endDate,
      nextReminderDate: startDate,
    });

    return new Response(JSON.stringify({
      ok: true,
      subscriptionId: subscription?.id,
      startDate,
      endDate,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'No se pudo guardar' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
