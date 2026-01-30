-- Wompi forwarded events inbox (ministeriomana.org)
create extension if not exists "pgcrypto";

create table if not exists public.mm_wompi_event_inbox (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),

  -- dedupe
  body_sha256 text not null unique,

  -- extracted fields (optional)
  tx_id text,
  reference text,
  status text,
  currency text,
  amount_in_cents bigint,

  -- store raw + parsed
  raw_body text not null,
  payload jsonb,
  parse_error text
);

create index if not exists mm_wompi_event_inbox_reference_idx
  on public.mm_wompi_event_inbox (reference);

create index if not exists mm_wompi_event_inbox_tx_id_idx
  on public.mm_wompi_event_inbox (tx_id);
