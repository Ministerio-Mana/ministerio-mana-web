-- Operacion financiera generica para eventos Maná.
-- NO ejecutar hasta que docs/sql/events_platform_upgrade.sql haya terminado bien.
-- Idempotente y no destructivo: no modifica tablas cumbre_* ni pagos historicos.
-- Las escrituras se haran desde APIs del servidor con service_role.

begin;

create extension if not exists pgcrypto;

alter table public.events
  add column if not exists attendance_mode text not null default 'IN_PERSON',
  add column if not exists pricing_model text not null default 'FREE',
  add column if not exists registration_requires_approval boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_attendance_mode_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events add constraint events_attendance_mode_check
      check (attendance_mode in ('IN_PERSON', 'ONLINE', 'HYBRID'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_pricing_model_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events add constraint events_pricing_model_check
      check (pricing_model in ('FREE', 'PAID', 'DONATION'));
  end if;
end $$;

create table if not exists public.event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  name text not null,
  description text,
  price numeric(14,2) not null default 0 check (price >= 0),
  currency text not null default 'COP' check (currency in ('COP', 'USD', 'EUR')),
  capacity integer check (capacity is null or capacity >= 0),
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sales_start_at is null or sales_end_at is null or sales_end_at >= sales_start_at)
);

create table if not exists public.event_payment_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  kind text not null check (kind in ('ONLINE', 'CASH', 'BANK_TRANSFER', 'QR_TRANSFER', 'EXTERNAL')),
  provider text not null check (provider in ('WOMPI', 'STRIPE', 'MANUAL', 'EXTERNAL')),
  currency text not null check (currency in ('COP', 'USD', 'EUR')),
  label text not null,
  instructions text,
  external_url text,
  qr_asset_path text,
  requires_evidence boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider <> 'WOMPI' or currency = 'COP'),
  check (kind <> 'EXTERNAL' or external_url is not null),
  check (kind <> 'QR_TRANSFER' or qr_asset_path is not null)
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  ticket_type_id uuid references public.event_ticket_types(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  church_id uuid references public.churches(id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 1000),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  currency text not null check (currency in ('COP', 'USD', 'EUR')),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'PENDING_PAYMENT', 'UNDER_REVIEW', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'EXPIRED')
  ),
  payment_option_id uuid references public.event_payment_options(id) on delete restrict,
  idempotency_key text,
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  registration_id uuid not null references public.event_registrations(id) on delete restrict,
  payment_option_id uuid references public.event_payment_options(id) on delete restrict,
  provider text not null check (provider in ('WOMPI', 'STRIPE', 'MANUAL', 'EXTERNAL')),
  provider_tx_id text,
  reference text not null,
  method text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('COP', 'USD', 'EUR')),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'DECLINED', 'FAILED', 'VOIDED', 'REFUNDED')
  ),
  provider_payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  received_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider <> 'WOMPI' or currency = 'COP'),
  check (jsonb_typeof(provider_payload) = 'object')
);

create table if not exists public.event_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  registration_id uuid not null references public.event_registrations(id) on delete restrict,
  payment_id uuid references public.event_payments(id) on delete restrict,
  storage_path text not null,
  original_filename text,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (storage_path)
);

create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  registration_id uuid not null references public.event_registrations(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references auth.users(id) on delete set null,
  notes text
);

create table if not exists public.event_finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  registration_id uuid references public.event_registrations(id) on delete restrict,
  payment_id uuid references public.event_payments(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  check (before_data is null or jsonb_typeof(before_data) = 'object'),
  check (after_data is null or jsonb_typeof(after_data) = 'object')
);

create unique index if not exists idx_event_registrations_idempotency
  on public.event_registrations(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists idx_event_registrations_event_id
  on public.event_registrations(event_id, id);

create unique index if not exists idx_event_payments_provider_tx
  on public.event_payments(provider, provider_tx_id)
  where provider_tx_id is not null;

create unique index if not exists idx_event_payments_provider_reference
  on public.event_payments(provider, reference)
  where provider in ('WOMPI', 'STRIPE', 'EXTERNAL');

create unique index if not exists idx_event_payments_idempotency
  on public.event_payments(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists idx_event_payments_event_registration_id
  on public.event_payments(event_id, registration_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_payments_registration_same_event_fk'
      and conrelid = 'public.event_payments'::regclass
  ) then
    alter table public.event_payments
      add constraint event_payments_registration_same_event_fk
      foreign key (event_id, registration_id)
      references public.event_registrations(event_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_evidence_registration_same_event_fk'
      and conrelid = 'public.event_payment_evidence'::regclass
  ) then
    alter table public.event_payment_evidence
      add constraint event_evidence_registration_same_event_fk
      foreign key (event_id, registration_id)
      references public.event_registrations(event_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_evidence_payment_same_registration_fk'
      and conrelid = 'public.event_payment_evidence'::regclass
  ) then
    alter table public.event_payment_evidence
      add constraint event_evidence_payment_same_registration_fk
      foreign key (event_id, registration_id, payment_id)
      references public.event_payments(event_id, registration_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_checkins_registration_same_event_fk'
      and conrelid = 'public.event_checkins'::regclass
  ) then
    alter table public.event_checkins
      add constraint event_checkins_registration_same_event_fk
      foreign key (event_id, registration_id)
      references public.event_registrations(event_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists idx_event_ticket_types_event
  on public.event_ticket_types(event_id, is_active, sort_order);
create index if not exists idx_event_payment_options_event
  on public.event_payment_options(event_id, is_active, currency);
create index if not exists idx_event_registrations_event_status
  on public.event_registrations(event_id, status, created_at desc);
create index if not exists idx_event_registrations_contact_email
  on public.event_registrations(lower(contact_email));
create index if not exists idx_event_payments_event_status
  on public.event_payments(event_id, status, created_at desc);
create index if not exists idx_event_payments_registration
  on public.event_payments(registration_id, created_at desc);
create index if not exists idx_event_evidence_review
  on public.event_payment_evidence(event_id, status, created_at desc);
create index if not exists idx_event_checkins_event
  on public.event_checkins(event_id, checked_in_at desc);
create index if not exists idx_event_finance_audit_event
  on public.event_finance_audit_logs(event_id, created_at desc);

alter table public.event_ticket_types enable row level security;
alter table public.event_payment_options enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_payments enable row level security;
alter table public.event_payment_evidence enable row level security;
alter table public.event_checkins enable row level security;
alter table public.event_finance_audit_logs enable row level security;

revoke all on table public.event_ticket_types from public, anon, authenticated;
revoke all on table public.event_payment_options from public, anon, authenticated;
revoke all on table public.event_registrations from public, anon, authenticated;
revoke all on table public.event_payments from public, anon, authenticated;
revoke all on table public.event_payment_evidence from public, anon, authenticated;
revoke all on table public.event_checkins from public, anon, authenticated;
revoke all on table public.event_finance_audit_logs from public, anon, authenticated;

grant all on table public.event_ticket_types to service_role;
grant all on table public.event_payment_options to service_role;
grant all on table public.event_registrations to service_role;
grant all on table public.event_payments to service_role;
grant all on table public.event_payment_evidence to service_role;
grant all on table public.event_checkins to service_role;
grant all on table public.event_finance_audit_logs to service_role;

commit;

-- Verificacion. authenticated y anon no deben tener privilegios en estas tablas.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'event_%'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select
  (select count(*) from public.events) as events_count,
  (select count(*) from public.event_ticket_types) as ticket_types_count,
  (select count(*) from public.event_registrations) as registrations_count,
  (select count(*) from public.event_payments) as payments_count,
  (select count(*) from public.event_payment_evidence) as evidence_count;
