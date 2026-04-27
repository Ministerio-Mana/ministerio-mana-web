import { supabaseAdmin } from './supabaseAdmin';

function ensureSupabase() {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }
  return supabaseAdmin;
}

export type DonationReminderSubscription = {
  id: string;
  donation_id: string | null;
  provider: string;
  reference: string;
  donation_type: string | null;
  amount: number | null;
  currency: string | null;
  donor_name: string | null;
  donor_email: string | null;
  donor_phone: string | null;
  channels: string[];
  reminder_timezone: string | null;
  start_date: string;
  end_date: string;
  next_reminder_date: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function upsertDonationReminderSubscription(params: {
  donationId: string | null;
  provider: string;
  reference: string;
  donationType?: string | null;
  amount?: number | null;
  currency?: string | null;
  donorName?: string | null;
  donorEmail?: string | null;
  donorPhone?: string | null;
  channels: string[];
  startDate: string;
  endDate: string;
  nextReminderDate: string;
}): Promise<DonationReminderSubscription | null> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_reminder_subscriptions')
    .upsert({
      donation_id: params.donationId ?? null,
      provider: params.provider,
      reference: params.reference,
      donation_type: params.donationType ?? null,
      amount: params.amount ?? null,
      currency: params.currency ?? null,
      donor_name: params.donorName ?? null,
      donor_email: params.donorEmail ?? null,
      donor_phone: params.donorPhone ?? null,
      channels: params.channels ?? [],
      start_date: params.startDate,
      end_date: params.endDate,
      next_reminder_date: params.nextReminderDate,
      status: 'ACTIVE',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,reference' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error('No se pudo guardar el recordatorio');
  }
  return data as DonationReminderSubscription;
}

export async function listDueDonationReminders(date: string, limit = 200): Promise<DonationReminderSubscription[]> {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('donation_reminder_subscriptions')
    .select('*')
    .lte('next_reminder_date', date)
    .eq('status', 'ACTIVE')
    .order('next_reminder_date', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error('No se pudieron listar recordatorios');
  }
  return (data ?? []) as DonationReminderSubscription[];
}

export async function updateDonationReminder(params: {
  id: string;
  nextReminderDate?: string;
  status?: string;
}): Promise<void> {
  const supabase = ensureSupabase();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.nextReminderDate) updates.next_reminder_date = params.nextReminderDate;
  if (params.status) updates.status = params.status;

  const { error } = await supabase
    .from('donation_reminder_subscriptions')
    .update(updates)
    .eq('id', params.id);

  if (error) {
    throw new Error('No se pudo actualizar recordatorio');
  }
}

export async function recordDonationReminderLog(params: {
  subscriptionId: string;
  reminderDate: string;
  channel: string;
  payload?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  const supabase = ensureSupabase();
  const { error } = await supabase
    .from('donation_reminder_logs')
    .insert({
      subscription_id: params.subscriptionId,
      reminder_date: params.reminderDate,
      channel: params.channel,
      payload: params.payload ?? null,
      error: params.error ?? null,
    });

  if (error) {
    console.error('[donation.reminders] log insert error', error);
  }
}
