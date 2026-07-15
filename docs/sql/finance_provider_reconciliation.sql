-- Conciliación financiera exacta para Wompi y Stripe.
--
-- Principios:
-- 1. Todos los importes se guardan en unidades menores enteras (centavos).
-- 2. No calcula ni supone tarifas comerciales.
-- 3. Wompi completa comisión/neto desde el reporte oficial de ventas o desembolsos.
-- 4. Stripe completa comisión/neto desde Balance Transactions y agrupa por Payout.
-- 5. Una transacción puede distribuirse entre Campus, Eventos, Donaciones u otros conceptos.
-- 6. Las tablas son privadas; el Portal debe exponerlas únicamente mediante APIs/RPC con alcance.

create extension if not exists "pgcrypto";

create table if not exists public.finance_provider_import_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('WOMPI', 'STRIPE')),
  report_type text not null check (report_type in (
    'TRANSACTIONS',
    'SALES',
    'DISBURSEMENTS',
    'BALANCE_TRANSACTIONS',
    'PAYOUT_RECONCILIATION',
    'BANK_STATEMENT'
  )),
  period_start timestamptz,
  period_end timestamptz,
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  source_file_name text,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'IMPORTED' check (status in ('IMPORTED', 'VERIFIED', 'REJECTED')),
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  notes text,
  unique (provider, report_type, file_sha256)
);

create table if not exists public.finance_provider_settlements (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('WOMPI', 'STRIPE')),
  provider_settlement_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint not null default 2 check (currency_exponent between 0 and 3),
  period_start timestamptz,
  period_end timestamptz,
  gross_amount_minor bigint,
  fee_amount_minor bigint,
  tax_amount_minor bigint,
  withholding_amount_minor bigint,
  adjustment_amount_minor bigint,
  net_amount_minor bigint,
  bank_deposit_amount_minor bigint,
  transfer_reference text,
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED')),
  values_source text not null check (values_source in ('PROVIDER_API', 'PROVIDER_REPORT', 'BANK_REPORT', 'MANUAL_VERIFIED')),
  import_batch_id uuid references public.finance_provider_import_batches(id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_settlement_id)
);

create table if not exists public.finance_provider_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('WOMPI', 'STRIPE')),
  provider_transaction_id text not null,
  provider_balance_transaction_id text,
  reference text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint not null default 2 check (currency_exponent between 0 and 3),
  gross_amount_minor bigint not null,
  fee_amount_minor bigint,
  tax_amount_minor bigint,
  withholding_amount_minor bigint,
  adjustment_amount_minor bigint,
  net_amount_minor bigint,
  payment_method text,
  status text,
  values_source text not null check (values_source in ('PROVIDER_API', 'PROVIDER_REPORT', 'BANK_REPORT', 'MANUAL_VERIFIED')),
  exact_amounts boolean not null default false,
  settlement_id uuid references public.finance_provider_settlements(id) on delete set null,
  import_batch_id uuid references public.finance_provider_import_batches(id) on delete set null,
  occurred_at timestamptz not null,
  available_at timestamptz,
  settled_at timestamptz,
  provider_payload_sha256 text check (provider_payload_sha256 is null or provider_payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id),
  check (not exact_amounts or (fee_amount_minor is not null and net_amount_minor is not null))
);

create table if not exists public.finance_transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  provider_transaction_id uuid not null references public.finance_provider_transactions(id) on delete cascade,
  finance_domain text not null check (finance_domain in (
    'CAMPUS',
    'EVENT',
    'DONATION',
    'PRIMICIAS',
    'PILGRIMAGE',
    'BIBLE_SCHOOL',
    'DEVOTIONAL',
    'TITHE',
    'OFFERING',
    'MISSIONS',
    'OTHER'
  )),
  concept_code text,
  source_table text not null,
  source_id text not null,
  finance_scope_type text not null check (finance_scope_type in ('GLOBAL', 'NATIONAL', 'REGIONAL', 'LOCAL')),
  finance_scope_country_key text,
  finance_region_id uuid references public.regions(id) on delete set null,
  finance_church_id uuid references public.churches(id) on delete set null,
  allocated_gross_minor bigint not null,
  allocated_net_minor bigint,
  allocation_rule text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_transaction_id, finance_domain, source_table, source_id),
  check (
    (finance_scope_type = 'GLOBAL' and finance_scope_country_key is null and finance_region_id is null and finance_church_id is null)
    or (finance_scope_type = 'NATIONAL' and finance_scope_country_key is not null and finance_region_id is null and finance_church_id is null)
    or (finance_scope_type = 'REGIONAL' and finance_region_id is not null and finance_church_id is null)
    or (finance_scope_type = 'LOCAL' and finance_church_id is not null)
  )
);

create table if not exists public.finance_provider_reconciliation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null check (entity_type in ('IMPORT_BATCH', 'TRANSACTION', 'SETTLEMENT', 'ALLOCATION')),
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_provider_transactions_reference
  on public.finance_provider_transactions(provider, reference);
create index if not exists idx_finance_provider_transactions_settlement
  on public.finance_provider_transactions(settlement_id, occurred_at desc);
create index if not exists idx_finance_provider_transactions_occurred
  on public.finance_provider_transactions(provider, occurred_at desc);
create index if not exists idx_finance_transaction_allocations_scope
  on public.finance_transaction_allocations(finance_scope_type, finance_scope_country_key, finance_region_id, finance_church_id);
create index if not exists idx_finance_transaction_allocations_source
  on public.finance_transaction_allocations(finance_domain, source_table, source_id);
create index if not exists idx_finance_provider_settlements_date
  on public.finance_provider_settlements(provider, settled_at desc);

create or replace function public.set_finance_provider_reconciliation_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_finance_provider_settlements_updated_at on public.finance_provider_settlements;
create trigger trg_finance_provider_settlements_updated_at
before update on public.finance_provider_settlements
for each row execute function public.set_finance_provider_reconciliation_updated_at();

drop trigger if exists trg_finance_provider_transactions_updated_at on public.finance_provider_transactions;
create trigger trg_finance_provider_transactions_updated_at
before update on public.finance_provider_transactions
for each row execute function public.set_finance_provider_reconciliation_updated_at();

drop trigger if exists trg_finance_transaction_allocations_updated_at on public.finance_transaction_allocations;
create trigger trg_finance_transaction_allocations_updated_at
before update on public.finance_transaction_allocations
for each row execute function public.set_finance_provider_reconciliation_updated_at();

create or replace view public.v_finance_provider_transaction_reconciliation
with (security_invoker = true)
as
with allocation_totals as (
  select
    provider_transaction_id,
    sum(allocated_gross_minor) as allocated_gross_minor,
    sum(allocated_net_minor) filter (where allocated_net_minor is not null) as allocated_net_minor,
    count(*) as allocation_count
  from public.finance_transaction_allocations
  group by provider_transaction_id
)
select
  provider_tx.id,
  provider_tx.provider,
  provider_tx.provider_transaction_id,
  provider_tx.provider_balance_transaction_id,
  provider_tx.reference,
  provider_tx.currency,
  provider_tx.currency_exponent,
  provider_tx.gross_amount_minor,
  provider_tx.fee_amount_minor,
  provider_tx.tax_amount_minor,
  provider_tx.withholding_amount_minor,
  provider_tx.adjustment_amount_minor,
  provider_tx.net_amount_minor,
  provider_tx.gross_amount_minor::numeric / power(10::numeric, provider_tx.currency_exponent) as gross_amount,
  provider_tx.fee_amount_minor::numeric / power(10::numeric, provider_tx.currency_exponent) as fee_amount,
  provider_tx.tax_amount_minor::numeric / power(10::numeric, provider_tx.currency_exponent) as tax_amount,
  provider_tx.withholding_amount_minor::numeric / power(10::numeric, provider_tx.currency_exponent) as withholding_amount,
  provider_tx.net_amount_minor::numeric / power(10::numeric, provider_tx.currency_exponent) as net_amount,
  provider_tx.values_source,
  provider_tx.exact_amounts,
  provider_tx.settlement_id,
  provider_tx.occurred_at,
  coalesce(allocation.allocated_gross_minor, 0) as allocated_gross_minor,
  allocation.allocated_net_minor,
  coalesce(allocation.allocation_count, 0) as allocation_count,
  provider_tx.gross_amount_minor - coalesce(allocation.allocated_gross_minor, 0) as gross_allocation_difference_minor,
  case
    when provider_tx.net_amount_minor is null or provider_tx.fee_amount_minor is null then null
    else provider_tx.net_amount_minor - (
      provider_tx.gross_amount_minor
      - provider_tx.fee_amount_minor
      - coalesce(provider_tx.tax_amount_minor, 0)
      - coalesce(provider_tx.withholding_amount_minor, 0)
      + coalesce(provider_tx.adjustment_amount_minor, 0)
    )
  end as provider_equation_difference_minor,
  case
    when not provider_tx.exact_amounts or provider_tx.net_amount_minor is null or provider_tx.fee_amount_minor is null
      then 'NEEDS_PROVIDER_VALUES'
    when provider_tx.gross_amount_minor <> coalesce(allocation.allocated_gross_minor, 0)
      then 'NEEDS_ALLOCATION'
    when provider_tx.settlement_id is null
      then 'NEEDS_SETTLEMENT'
    else 'MATCHED'
  end as reconciliation_status
from public.finance_provider_transactions provider_tx
left join allocation_totals allocation on allocation.provider_transaction_id = provider_tx.id;

create or replace view public.v_finance_provider_settlement_reconciliation
with (security_invoker = true)
as
with transaction_totals as (
  select
    settlement_id,
    count(*) as transaction_count,
    sum(gross_amount_minor) as transaction_gross_minor,
    sum(net_amount_minor) filter (where net_amount_minor is not null) as transaction_net_minor,
    count(*) filter (where not exact_amounts or net_amount_minor is null) as incomplete_transaction_count
  from public.finance_provider_transactions
  where settlement_id is not null
  group by settlement_id
)
select
  settlement.id,
  settlement.provider,
  settlement.provider_settlement_id,
  settlement.currency,
  settlement.currency_exponent,
  settlement.status,
  settlement.values_source,
  settlement.settled_at,
  settlement.gross_amount_minor,
  settlement.fee_amount_minor,
  settlement.tax_amount_minor,
  settlement.withholding_amount_minor,
  settlement.adjustment_amount_minor,
  settlement.net_amount_minor,
  settlement.bank_deposit_amount_minor,
  settlement.transfer_reference,
  coalesce(totals.transaction_count, 0) as transaction_count,
  coalesce(totals.incomplete_transaction_count, 0) as incomplete_transaction_count,
  totals.transaction_gross_minor,
  totals.transaction_net_minor,
  case
    when settlement.gross_amount_minor is null or totals.transaction_gross_minor is null then null
    else settlement.gross_amount_minor - totals.transaction_gross_minor
  end as gross_transaction_difference_minor,
  case
    when settlement.net_amount_minor is null or totals.transaction_net_minor is null then null
    else settlement.net_amount_minor - totals.transaction_net_minor
  end as net_transaction_difference_minor,
  case
    when settlement.net_amount_minor is null or settlement.bank_deposit_amount_minor is null then null
    else settlement.bank_deposit_amount_minor - settlement.net_amount_minor
  end as bank_deposit_difference_minor,
  case
    when coalesce(totals.incomplete_transaction_count, 0) > 0 then 'NEEDS_PROVIDER_VALUES'
    when settlement.net_amount_minor is null then 'NEEDS_SETTLEMENT_VALUES'
    when settlement.bank_deposit_amount_minor is null then 'NEEDS_BANK_DEPOSIT'
    when settlement.bank_deposit_amount_minor <> settlement.net_amount_minor then 'DIFFERENCE'
    else 'MATCHED'
  end as reconciliation_status
from public.finance_provider_settlements settlement
left join transaction_totals totals on totals.settlement_id = settlement.id;

alter table public.finance_provider_import_batches enable row level security;
alter table public.finance_provider_settlements enable row level security;
alter table public.finance_provider_transactions enable row level security;
alter table public.finance_transaction_allocations enable row level security;
alter table public.finance_provider_reconciliation_audit_logs enable row level security;

revoke all on table public.finance_provider_import_batches from anon, authenticated;
revoke all on table public.finance_provider_settlements from anon, authenticated;
revoke all on table public.finance_provider_transactions from anon, authenticated;
revoke all on table public.finance_transaction_allocations from anon, authenticated;
revoke all on table public.finance_provider_reconciliation_audit_logs from anon, authenticated;
revoke all on table public.v_finance_provider_transaction_reconciliation from anon, authenticated;
revoke all on table public.v_finance_provider_settlement_reconciliation from anon, authenticated;

grant all on table public.finance_provider_import_batches to service_role;
grant all on table public.finance_provider_settlements to service_role;
grant all on table public.finance_provider_transactions to service_role;
grant all on table public.finance_transaction_allocations to service_role;
grant all on table public.finance_provider_reconciliation_audit_logs to service_role;
grant select on table public.v_finance_provider_transaction_reconciliation to service_role;
grant select on table public.v_finance_provider_settlement_reconciliation to service_role;

-- Verificación segura: estructura y vistas, sin exponer movimientos.
select
  to_regclass('public.finance_provider_import_batches') as import_batches,
  to_regclass('public.finance_provider_settlements') as settlements,
  to_regclass('public.finance_provider_transactions') as transactions,
  to_regclass('public.finance_transaction_allocations') as allocations,
  to_regclass('public.v_finance_provider_transaction_reconciliation') as transaction_reconciliation,
  to_regclass('public.v_finance_provider_settlement_reconciliation') as settlement_reconciliation;
