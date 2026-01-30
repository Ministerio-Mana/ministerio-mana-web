-- Cumbre 2026: links de pago por cuota
create extension if not exists "pgcrypto";

create table if not exists public.cumbre_installment_links (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references cumbre_installments(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cumbre_installment_links
  add column if not exists expires_at timestamptz;

alter table public.cumbre_installment_links
  add column if not exists used_at timestamptz;

create unique index if not exists cumbre_installment_links_token_unique
  on public.cumbre_installment_links(token_hash);

create index if not exists cumbre_installment_links_installment_idx
  on public.cumbre_installment_links(installment_id);

alter table public.cumbre_installment_links enable row level security;
