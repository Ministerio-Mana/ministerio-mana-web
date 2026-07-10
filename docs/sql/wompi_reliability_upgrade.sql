-- Wompi: trazabilidad, reintentos e índices de conciliación.
-- Seguro para ejecutar varias veces en Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.mm_wompi_event_inbox (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  body_sha256 text not null unique,
  tx_id text,
  reference text,
  status text,
  currency text,
  amount_in_cents bigint,
  raw_body text not null,
  payload jsonb,
  parse_error text
);

alter table public.mm_wompi_event_inbox
  add column if not exists source text,
  add column if not exists processing_status text,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processed_at timestamptz,
  add column if not exists last_processing_error text,
  add column if not exists updated_at timestamptz not null default now();

-- Los eventos anteriores ya tuvieron su oportunidad de procesamiento. Los pagos
-- PENDING con transaction ID se concilian aparte mediante el cron nuevo.
update public.mm_wompi_event_inbox
set
  source = coalesce(source, 'LEGACY'),
  processing_status = coalesce(processing_status, 'PROCESSED'),
  processed_at = coalesce(processed_at, received_at),
  updated_at = now()
where source is null or processing_status is null;

-- Reactiva únicamente eventos finales cuyo pago local todavía sigue PENDING.
-- Esto recupera pagos históricos sin aprobar nada por inferencia: el cron vuelve
-- a ejecutar la validación estricta de referencia, monto y moneda.
update public.mm_wompi_event_inbox i
set
  processing_status = 'RECEIVED',
  processed_at = null,
  last_processing_error = null,
  updated_at = now()
where upper(coalesce(i.status, '')) in ('APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'FAILED')
  and exists (
    select 1
    from public.donations d
    where d.provider = 'wompi'
      and d.reference = i.reference
      and d.status = 'PENDING'
  );

alter table public.mm_wompi_event_inbox
  alter column source set default 'DIRECT',
  alter column source set not null,
  alter column processing_status set default 'RECEIVED',
  alter column processing_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mm_wompi_event_inbox_processing_status_check'
      and conrelid = 'public.mm_wompi_event_inbox'::regclass
  ) then
    alter table public.mm_wompi_event_inbox
      add constraint mm_wompi_event_inbox_processing_status_check
      check (processing_status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'REJECTED', 'FAILED'));
  end if;
end $$;

create index if not exists mm_wompi_event_inbox_reference_idx
  on public.mm_wompi_event_inbox (reference);

create index if not exists mm_wompi_event_inbox_tx_id_idx
  on public.mm_wompi_event_inbox (tx_id);

create index if not exists mm_wompi_event_inbox_retry_idx
  on public.mm_wompi_event_inbox (processing_status, received_at)
  where processing_status in ('RECEIVED', 'FAILED');

create index if not exists idx_donations_wompi_pending_tx
  on public.donations (updated_at)
  where provider = 'wompi'
    and status = 'PENDING'
    and provider_tx_id is not null;

alter table public.mm_wompi_event_inbox enable row level security;
revoke all on table public.mm_wompi_event_inbox from anon, authenticated, public;
grant all on table public.mm_wompi_event_inbox to service_role;

-- Diagnóstico sin datos personales: pagos Wompi asignados a María Camila.
select
  d.created_at,
  left(coalesce(d.reference, ''), 12) || '...' as reference_masked,
  d.amount,
  d.currency,
  d.status as local_status,
  case when d.provider_tx_id is null then false else true end as has_transaction_id,
  latest_event.status as latest_wompi_event_status,
  latest_event.processing_status as event_processing_status,
  latest_event.received_at as event_received_at
from public.campus_donation_allocations a
join public.donations d on d.id = a.donation_id
left join lateral (
  select i.status, i.processing_status, i.received_at
  from public.mm_wompi_event_inbox i
  where i.reference = d.reference
  order by i.received_at desc
  limit 1
) latest_event on true
where a.missionary_slug = 'maria-camila-rios'
  and d.provider = 'wompi'
order by d.created_at desc;

-- Resumen general Campus/Wompi para confirmar pendientes reales.
select
  d.status,
  count(*) as payments_count,
  count(*) filter (where d.provider_tx_id is not null) as with_transaction_id,
  min(d.created_at) as oldest_payment,
  max(d.created_at) as newest_payment
from public.donations d
where d.provider = 'wompi'
  and (
    lower(coalesce(d.donation_type, '')) = 'campus'
    or lower(coalesce(d.source, '')) like '%campus%'
  )
group by d.status
order by d.status;
