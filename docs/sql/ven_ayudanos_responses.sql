create extension if not exists "pgcrypto";

create table if not exists ven_ayudanos_responses (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  whatsapp text not null,
  email text,
  city text,
  church text,
  ministry text not null,
  help_types text[] not null default '{}',
  message text,
  availability text not null default 'no-estoy-seguro',
  origin text,
  place text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  qr text,
  path text,
  user_agent text,
  status text not null default 'new',
  assigned_to text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ven_ayudanos_responses enable row level security;

create index if not exists idx_ven_ayudanos_responses_created_at on ven_ayudanos_responses(created_at desc);
create index if not exists idx_ven_ayudanos_responses_ministry on ven_ayudanos_responses(ministry);
create index if not exists idx_ven_ayudanos_responses_origin on ven_ayudanos_responses(origin);
create index if not exists idx_ven_ayudanos_responses_place on ven_ayudanos_responses(place);
create index if not exists idx_ven_ayudanos_responses_qr on ven_ayudanos_responses(qr);

create or replace function set_ven_ayudanos_responses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ven_ayudanos_responses_updated_at on ven_ayudanos_responses;
create trigger trg_ven_ayudanos_responses_updated_at
before update on ven_ayudanos_responses
for each row
execute function set_ven_ayudanos_responses_updated_at();
