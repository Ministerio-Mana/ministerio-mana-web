-- Campus Mana: suscripciones reales de siembra mensual
-- Este esquema separa los cobros recurrentes reales de los recordatorios manuales.
-- Requiere pgcrypto para gen_random_uuid().

create extension if not exists "pgcrypto";

create table if not exists public.campus_donation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING',
  provider text not null check (provider in ('wompi', 'stripe')),
  amount numeric not null,
  currency text not null check (currency in ('COP', 'USD')),
  frequency text not null default 'monthly' check (frequency in ('monthly')),
  donor_name text,
  donor_email text not null,
  donor_phone text,
  donor_document_type text,
  donor_document_number text,
  donor_city text,
  donor_country text,
  provider_customer_id text,
  provider_subscription_id text,
  provider_payment_source_id text,
  provider_payment_method_id text,
  provider_reference text,
  last_donation_id uuid references public.donations(id) on delete set null,
  next_charge_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  paused_at timestamptz,
  pause_until timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  last_charge_status text,
  last_charge_error text,
  metadata jsonb not null default '{}'::jsonb,
  raw_provider_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campus_donation_subscription_allocations (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.campus_donation_subscriptions(id) on delete cascade,
  missionary_slug text not null,
  missionary_name text not null,
  missionary_id uuid references auth.users(id) on delete set null,
  amount numeric not null,
  currency text not null check (currency in ('COP', 'USD')),
  created_at timestamptz not null default now()
);

create index if not exists idx_campus_subscriptions_user
  on public.campus_donation_subscriptions(user_id, status);

create index if not exists idx_campus_subscriptions_provider_subscription
  on public.campus_donation_subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists idx_campus_subscriptions_provider_reference
  on public.campus_donation_subscriptions(provider, provider_reference)
  where provider_reference is not null;

create index if not exists idx_campus_subscriptions_provider_source
  on public.campus_donation_subscriptions(provider, provider_payment_source_id)
  where provider_payment_source_id is not null;

create index if not exists idx_campus_subscriptions_next_charge
  on public.campus_donation_subscriptions(status, next_charge_at)
  where next_charge_at is not null;

create index if not exists idx_campus_subscription_allocations_subscription
  on public.campus_donation_subscription_allocations(subscription_id);

alter table public.campus_donation_subscriptions enable row level security;
alter table public.campus_donation_subscription_allocations enable row level security;

drop policy if exists "Usuarios ven sus suscripciones Campus" on public.campus_donation_subscriptions;
create policy "Usuarios ven sus suscripciones Campus"
  on public.campus_donation_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Usuarios ven asignaciones de sus suscripciones Campus" on public.campus_donation_subscription_allocations;
create policy "Usuarios ven asignaciones de sus suscripciones Campus"
  on public.campus_donation_subscription_allocations
  for select
  using (
    exists (
      select 1
      from public.campus_donation_subscriptions s
      where s.id = subscription_id
        and s.user_id = auth.uid()
    )
  );

comment on table public.campus_donation_subscriptions
  is 'Suscripciones reales de siembra mensual Campus Mana para Stripe y Wompi.';

comment on column public.campus_donation_subscriptions.pause_until
  is 'Fecha hasta la que se pausa una temporada. Si queda vacia, la pausa es indefinida hasta reactivar.';

comment on column public.campus_donation_subscriptions.provider_payment_source_id
  is 'ID de fuente de pago Wompi para cobros posteriores. Nunca almacenar datos sensibles de tarjeta.';
