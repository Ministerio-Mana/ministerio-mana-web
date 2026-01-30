-- Donations + contabilidad
-- Requiere pgcrypto para gen_random_uuid()
create extension if not exists "pgcrypto";

create table if not exists donations (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'PENDING',
  amount numeric not null,
  currency text not null,
  reference text,
  provider_tx_id text,
  payment_method text,
  donation_type text,
  project_name text,
  event_name text,
  campus text,
  church text,
  church_city text,
  donor_name text,
  donor_email text,
  donor_phone text,
  donor_document_type text,
  donor_document_number text,
  donor_country text,
  donor_city text,
  source text,
  cumbre_booking_id uuid,
  raw_event jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_donations_provider on donations(provider);
create index if not exists idx_donations_status on donations(status);
create index if not exists idx_donations_reference on donations(reference);
create index if not exists idx_donations_booking on donations(cumbre_booking_id);
