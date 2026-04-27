-- Donaciones: recordatorios manuales (email/whatsapp)
create extension if not exists "pgcrypto";

create table if not exists public.donation_reminder_subscriptions (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid references public.donations(id) on delete set null,
  provider text not null,
  reference text not null,
  donation_type text,
  amount numeric,
  currency text,
  donor_name text,
  donor_email text,
  donor_phone text,
  channels text[] not null default array[]::text[],
  reminder_timezone text not null default 'America/Bogota',
  start_date date not null,
  end_date date not null,
  next_reminder_date date not null,
  status text not null default 'ACTIVE',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists donation_reminder_subscriptions_unique
  on public.donation_reminder_subscriptions(provider, reference);

create index if not exists donation_reminder_subscriptions_next_idx
  on public.donation_reminder_subscriptions(next_reminder_date);

create table if not exists public.donation_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.donation_reminder_subscriptions(id) on delete cascade,
  reminder_date date not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  payload jsonb,
  error text
);

create unique index if not exists donation_reminder_logs_unique
  on public.donation_reminder_logs(subscription_id, reminder_date, channel);

create index if not exists donation_reminder_logs_subscription_idx
  on public.donation_reminder_logs(subscription_id);
