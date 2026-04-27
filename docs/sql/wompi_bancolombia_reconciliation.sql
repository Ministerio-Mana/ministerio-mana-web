-- Conciliacion Wompi -> Bancolombia (neto bancario vs bruto plataforma)
-- Objetivo:
-- 1) Consolidar por dia el bruto de Wompi (Cumbre + Donaciones/Campus/Primicias).
-- 2) Permitir cargar el neto real recibido en Bancolombia.
-- 3) Obtener diferencia diaria para cierre contable.
--
-- Nota:
-- - Wompi suele consignar un neto (descontando comisiones/retenciones) agrupado por dia.
-- - Este script NO toca pagos ni historico. Solo agrega estructura de conciliacion + vistas.

create extension if not exists "pgcrypto";

-- =========================================================
-- 1) Tabla para capturar lo que SI llega al banco (neto diario)
-- =========================================================
create table if not exists public.wompi_bank_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_date date not null,
  bank_name text not null default 'Bancolombia',
  currency text not null default 'COP',
  transfer_reference text,
  net_received numeric not null,
  gross_reported_by_bank numeric,
  fee_reported_by_bank numeric,
  tax_reported_by_bank numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wompi_bank_settlement_date
  on public.wompi_bank_settlement_lines(settlement_date);

create index if not exists idx_wompi_bank_settlement_bank
  on public.wompi_bank_settlement_lines(bank_name, currency);

-- Ejemplo de carga manual (ajusta fecha/monto/referencia):
-- insert into public.wompi_bank_settlement_lines (
--   settlement_date, bank_name, currency, transfer_reference, net_received, notes
-- ) values
--   ('2026-02-18', 'Bancolombia', 'COP', 'TRX-BCO-123', 1250000, 'Paquete diario Wompi');

-- =========================================================
-- 2) Vista canonica de transacciones Wompi para contabilidad
--    - Clasificacion deterministica (NO aleatoria)
--    - Excluye donaciones CUMBRE para evitar doble conteo con cumbre_payments
-- =========================================================
create or replace view public.v_wompi_platform_transactions as
with wompi_cumbre as (
  select
    date(timezone('America/Bogota', cp.created_at)) as settlement_date,
    cp.created_at,
    'cumbre_payments'::text as source_table,
    cp.id::text as transaction_id,
    'CUMBRE'::text as payment_domain,
    'EVENT'::text as concept_code,
    'from_cumbre_payments'::text as classification_rule,
    cp.reference,
    cp.provider_tx_id,
    coalesce(
      cp.raw_event -> 'data' -> 'transaction' ->> 'payment_method_type',
      cp.raw_event -> 'data' -> 'transaction' -> 'payment_method' ->> 'type',
      cp.raw_event ->> 'payment_method_type',
      cp.raw_event ->> 'payment_method',
      cp.raw_event ->> 'method'
    ) as payment_method,
    coalesce(cp.amount, 0)::numeric as gross_amount,
    upper(coalesce(cp.currency, 'COP')) as currency,
    cp.booking_id::text as booking_id,
    null::text as donation_id,
    null::text as donation_type,
    null::text as source,
    null::text as project_name,
    null::text as event_name
  from public.cumbre_payments cp
  where lower(coalesce(cp.provider, '')) = 'wompi'
    and upper(coalesce(cp.status, '')) in ('APPROVED', 'PAID')
    and upper(coalesce(cp.currency, 'COP')) = 'COP'
),
donations_classified as (
  select
    d.id,
    d.created_at,
    d.reference,
    d.provider_tx_id,
    d.payment_method,
    d.amount,
    d.currency,
    d.cumbre_booking_id,
    d.donation_type,
    d.source,
    d.project_name,
    d.event_name,
    d.raw_event,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
        or lower(coalesce(d.project_name, '')) like '%cumbre%'
        or lower(coalesce(d.event_name, '')) like '%cumbre%'
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'CUMBRE'
      when lower(coalesce(d.donation_type, '')) = 'campus'
        or lower(coalesce(d.source, '')) like '%campus%'
      then 'CAMPUS'
      when lower(coalesce(d.donation_type, '')) = 'primicias'
        or lower(coalesce(d.source, '')) like '%primicias%'
      then 'PRIMICIAS'
      when lower(coalesce(d.donation_type, '')) in ('diezmos', 'ofrendas', 'misiones', 'peregrinaciones', 'evento', 'general')
      then 'DONATION'
      else 'OTHER'
    end as payment_domain_resolved,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'EVENT'
      when lower(coalesce(d.donation_type, '')) = 'diezmos' then 'TITHE'
      when lower(coalesce(d.donation_type, '')) = 'ofrendas' then 'OFFERING'
      when lower(coalesce(d.donation_type, '')) = 'misiones' then 'MISSIONS'
      when lower(coalesce(d.donation_type, '')) = 'campus' then 'CAMPUS'
      when lower(coalesce(d.donation_type, '')) = 'evento' then 'EVENT'
      when lower(coalesce(d.donation_type, '')) = 'peregrinaciones' then 'PILGRIMAGE'
      when lower(coalesce(d.donation_type, '')) = 'general' then 'GENERAL'
      when lower(coalesce(d.donation_type, '')) = 'primicias' then 'OFFERING'
      else 'OTHER'
    end as concept_code_resolved,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'rule_cumbre'
      when lower(coalesce(d.donation_type, '')) = 'campus'
        or lower(coalesce(d.source, '')) like '%campus%'
      then 'rule_campus'
      when lower(coalesce(d.donation_type, '')) = 'primicias'
        or lower(coalesce(d.source, '')) like '%primicias%'
      then 'rule_primicias'
      when lower(coalesce(d.donation_type, '')) in ('diezmos', 'ofrendas', 'misiones', 'peregrinaciones', 'evento', 'general')
      then 'rule_donation_type'
      else 'rule_other'
    end as classification_rule
  from public.donations d
  where lower(coalesce(d.provider, '')) = 'wompi'
    and upper(coalesce(d.status, '')) = 'APPROVED'
    and upper(coalesce(d.currency, 'COP')) = 'COP'
),
wompi_donations_non_cumbre as (
  select
    date(timezone('America/Bogota', dc.created_at)) as settlement_date,
    dc.created_at,
    'donations'::text as source_table,
    dc.id::text as transaction_id,
    dc.payment_domain_resolved as payment_domain,
    dc.concept_code_resolved as concept_code,
    dc.classification_rule,
    dc.reference,
    dc.provider_tx_id,
    coalesce(
      dc.raw_event -> 'data' -> 'transaction' ->> 'payment_method_type',
      dc.raw_event -> 'data' -> 'transaction' -> 'payment_method' ->> 'type',
      dc.raw_event ->> 'payment_method_type',
      dc.raw_event ->> 'payment_method',
      dc.raw_event ->> 'method',
      dc.payment_method
    ) as payment_method,
    coalesce(dc.amount, 0)::numeric as gross_amount,
    upper(coalesce(dc.currency, 'COP')) as currency,
    null::text as booking_id,
    dc.id::text as donation_id,
    dc.donation_type,
    dc.source,
    dc.project_name,
    dc.event_name
  from donations_classified dc
  where dc.payment_domain_resolved <> 'CUMBRE'
)
select * from wompi_cumbre
union all
select * from wompi_donations_non_cumbre;

-- =========================================================
-- 3) Vista de bruto diario de plataforma (el "cuadrito base")
-- =========================================================
create or replace view public.v_wompi_platform_daily_gross as
select
  settlement_date,
  currency,
  count(*) as tx_count,
  sum(gross_amount) as gross_total,
  sum(gross_amount) filter (where payment_domain = 'CUMBRE') as gross_cumbre,
  sum(gross_amount) filter (where payment_domain = 'DONATION') as gross_donation,
  sum(gross_amount) filter (where payment_domain = 'CAMPUS') as gross_campus,
  sum(gross_amount) filter (where payment_domain = 'PRIMICIAS') as gross_primicias,
  sum(gross_amount) filter (where payment_domain = 'OTHER') as gross_other
from public.v_wompi_platform_transactions
group by settlement_date, currency;

-- =========================================================
-- REPORTE 1: Bruto plataforma por dia + dominio + concepto
-- =========================================================
select
  settlement_date,
  payment_domain,
  concept_code,
  count(*) as transactions_count,
  sum(gross_amount) as gross_amount
from public.v_wompi_platform_transactions
group by settlement_date, payment_domain, concept_code
order by settlement_date desc, payment_domain, concept_code;

-- =========================================================
-- REPORTE 2: Cuadro diario contable (bruto vs neto banco)
-- Este es el reporte para contabilidad cuando Bancolombia agrupa pagos.
-- =========================================================
create or replace view public.v_wompi_bank_reconciliation_daily as
with bank_daily as (
  select
    settlement_date,
    upper(coalesce(currency, 'COP')) as currency,
    sum(net_received) as bank_net_received,
    sum(coalesce(gross_reported_by_bank, 0)) as bank_gross_reported,
    sum(coalesce(fee_reported_by_bank, 0)) as bank_fee_reported,
    sum(coalesce(tax_reported_by_bank, 0)) as bank_tax_reported,
    string_agg(coalesce(transfer_reference, ''), ', ' order by created_at) as transfer_refs
  from public.wompi_bank_settlement_lines
  group by settlement_date, upper(coalesce(currency, 'COP'))
)
select
  coalesce(g.settlement_date, b.settlement_date) as settlement_date,
  coalesce(g.currency, b.currency, 'COP') as currency,
  coalesce(g.tx_count, 0) as tx_count,
  coalesce(g.gross_cumbre, 0) as gross_cumbre,
  coalesce(g.gross_donation, 0) as gross_donation,
  coalesce(g.gross_campus, 0) as gross_campus,
  coalesce(g.gross_primicias, 0) as gross_primicias,
  coalesce(g.gross_other, 0) as gross_other,
  coalesce(g.gross_total, 0) as gross_total,
  coalesce(b.bank_net_received, 0) as bank_net_received,
  coalesce(b.bank_gross_reported, 0) as bank_gross_reported,
  coalesce(b.bank_fee_reported, 0) as bank_fee_reported,
  coalesce(b.bank_tax_reported, 0) as bank_tax_reported,
  (coalesce(g.gross_total, 0) - coalesce(b.bank_net_received, 0)) as estimated_total_discount,
  case
    when coalesce(g.gross_total, 0) > 0
    then round(((coalesce(g.gross_total, 0) - coalesce(b.bank_net_received, 0)) * 100.0) / g.gross_total, 4)
    else null
  end as estimated_discount_rate_pct,
  (
    (coalesce(g.gross_total, 0) - coalesce(b.bank_net_received, 0))
    - (coalesce(b.bank_fee_reported, 0) + coalesce(b.bank_tax_reported, 0))
  ) as diff_estimated_vs_reported_fee,
  b.transfer_refs
from public.v_wompi_platform_daily_gross g
full outer join bank_daily b
  on b.settlement_date = g.settlement_date
 and b.currency = g.currency
where coalesce(g.currency, b.currency, 'COP') = 'COP'
;

select *
from public.v_wompi_bank_reconciliation_daily
order by settlement_date desc;

-- =========================================================
-- REPORTE 3: Corte por metodo de pago (para explicar comisiones)
-- =========================================================
select
  settlement_date,
  case
    when lower(coalesce(payment_method, '')) like '%card%' then 'CARD'
    when lower(coalesce(payment_method, '')) like '%pse%' then 'PSE'
    when lower(coalesce(payment_method, '')) like '%nequi%' then 'NEQUI'
    when lower(coalesce(payment_method, '')) like '%bancolombia%' then 'BANCOLOMBIA'
    when coalesce(payment_method, '') = '' then 'UNKNOWN'
    else upper(payment_method)
  end as payment_method_group,
  count(*) as tx_count,
  sum(gross_amount) as gross_amount
from public.v_wompi_platform_transactions
group by settlement_date, payment_method_group
order by settlement_date desc, payment_method_group;

-- =========================================================
-- REPORTE 4: Transacciones detalladas (auditoria)
-- =========================================================
select
  settlement_date,
  created_at,
  source_table,
  transaction_id,
  payment_domain,
  concept_code,
  classification_rule,
  reference,
  provider_tx_id,
  payment_method,
  gross_amount,
  donation_type,
  source,
  project_name,
  event_name
from public.v_wompi_platform_transactions
order by settlement_date desc, created_at desc;

-- =========================================================
-- REPORTE 5: Donaciones tipo CUMBRE en donations (excluidas del total)
-- Sirve para vigilar posible doble conteo.
-- =========================================================
with cumbre_like as (
  select
    d.id,
    d.created_at,
    d.reference,
    d.provider_tx_id,
    d.amount,
    d.currency,
    d.source,
    d.project_name,
    d.event_name,
    d.cumbre_booking_id
  from public.donations d
  where lower(coalesce(d.provider, '')) = 'wompi'
    and upper(coalesce(d.status, '')) = 'APPROVED'
    and upper(coalesce(d.currency, 'COP')) = 'COP'
    and (
      d.cumbre_booking_id is not null
      or lower(coalesce(d.source, '')) like '%cumbre%'
      or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
      or lower(coalesce(d.project_name, '')) like '%cumbre%'
      or lower(coalesce(d.event_name, '')) like '%cumbre%'
      or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
    )
)
select
  date(timezone('America/Bogota', created_at)) as settlement_date,
  id as donation_id,
  reference,
  provider_tx_id,
  amount,
  currency,
  source,
  project_name,
  event_name,
  cumbre_booking_id
from cumbre_like
order by created_at desc;
