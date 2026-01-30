-- Supabase tables for the new dynamics

-- 1) Prayer Wall
create table if not exists prayer_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  city text,
  country text,
  prayers_count int not null default 0,
  approved boolean not null default true,
  created_at timestamptz default now()
);
alter table prayer_requests enable row level security;
drop policy if exists "read_public" on prayer_requests;
create policy "read_public" on prayer_requests for select using (approved = true);

-- 2) Campus Reto (increments per event; aggregate by week_start)
create table if not exists campus_reto (
  id uuid primary key default gen_random_uuid(),
  campus text not null,
  amount int not null default 1,
  week_start date not null,
  created_at timestamptz default now()
);
alter table campus_reto enable row level security;
drop policy if exists "read_public" on campus_reto;
create policy "read_public" on campus_reto for select using (true);

-- 3) Newsletter
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  lang text default 'es',
  created_at timestamptz default now()
);
alter table newsletter_subscribers enable row level security;
drop policy if exists "read_public" on newsletter_subscribers;
create policy "read_public" on newsletter_subscribers for select using (false);

-- 4) Security throttle records (rate limiting)
create table if not exists security_throttle (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  created_at timestamptz default now()
);

-- 5) Security events audit trail
create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  identifier text,
  ip text,
  user_agent text,
  detail text,
  meta jsonb,
  created_at timestamptz default now()
);

-- 6) Donation events (Stripe / Wompi webhooks)
create table if not exists donation_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null,
  reference text,
  payload jsonb not null,
  created_at timestamptz default now()
);

-- 7) Cumbre Mundial 2026
create table if not exists cumbre_bookings (
  id uuid primary key default gen_random_uuid(),
  contact_name text,
  contact_email text,
  contact_phone text,
  country_group text not null,
  currency text not null,
  total_amount numeric not null default 0,
  total_paid numeric not null default 0,
  status text not null default 'PENDING',
  deposit_threshold numeric not null default 0,
  token_hash text not null,
  created_at timestamptz default now()
);

create table if not exists cumbre_participants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references cumbre_bookings(id) on delete cascade,
  full_name text not null,
  package_type text not null,
  relationship text,
  birthdate date,
  gender text,
  nationality text,
  document_type text,
  document_number text,
  room_preference text,
  blood_type text,
  allergies text,
  diet_type text,
  diet_notes text,
  document_front_path text,
  document_back_path text,
  created_at timestamptz default now()
);

create table if not exists cumbre_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references cumbre_bookings(id) on delete cascade,
  provider text not null,
  provider_tx_id text,
  reference text,
  amount numeric not null,
  currency text not null,
  status text not null default 'PENDING',
  raw_event jsonb,
  created_at timestamptz default now()
);

create unique index if not exists cumbre_payments_provider_tx_idx
  on cumbre_payments (provider, provider_tx_id);

create table if not exists cumbre_installment_links (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references cumbre_installments(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists cumbre_installment_links_token_unique
  on cumbre_installment_links(token_hash);

create index if not exists cumbre_installment_links_installment_idx
  on cumbre_installment_links(installment_id);

alter table cumbre_installment_links enable row level security;
