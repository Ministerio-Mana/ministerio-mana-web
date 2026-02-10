-- Tabla base para reservas Cumbre (instalaciones limpias)
create extension if not exists "pgcrypto";

create table if not exists public.cumbre_bookings (
  id uuid primary key default gen_random_uuid(),
  contact_name text,
  contact_email text,
  contact_phone text,
  contact_document_type text,
  contact_document_number text,
  contact_country text,
  contact_city text,
  contact_church text,
  country_group text default 'CO',
  currency text default 'COP',
  total_amount numeric default 0,
  total_paid numeric default 0,
  status text default 'PENDING',
  deposit_threshold numeric default 0,
  payment_method text,
  payment_status text,
  token_hash text,
  source text,
  church_id uuid references public.churches(id),
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists cumbre_bookings_token_hash_idx
  on public.cumbre_bookings(token_hash);

create index if not exists cumbre_bookings_church_idx
  on public.cumbre_bookings(church_id);

create index if not exists cumbre_bookings_created_at_idx
  on public.cumbre_bookings(created_at);

create index if not exists cumbre_bookings_status_idx
  on public.cumbre_bookings(status);

create index if not exists cumbre_bookings_source_idx
  on public.cumbre_bookings(source);
