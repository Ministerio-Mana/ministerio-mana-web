-- Auditoria forense de abonos online Cumbre 2026
-- Fecha: 2026-03-06
-- Uso: Supabase SQL Editor (produccion), SOLO lectura.
-- Objetivo:
-- 1) Detectar sobrepagos y descuadres booking vs pagos aprobados.
-- 2) Identificar pagos "en verificacion" que bloquean nuevos intentos.
-- 3) Revisar coherencia de cuotas (PENDING/FAILED/PROCESSING/PAID).

-- =========================================================
-- Q1) Resumen por booking (pagado aprobado, pendiente, saldo)
-- =========================================================
with payment_agg as (
  select
    p.booking_id,
    coalesce(sum(case when p.status = 'APPROVED' then coalesce(p.amount, 0) else 0 end), 0)::numeric as approved_total,
    coalesce(sum(case when p.status in ('PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'APPROVAL_PENDING') then coalesce(p.amount, 0) else 0 end), 0)::numeric as pending_total,
    count(*) filter (where p.status = 'APPROVED') as approved_count,
    count(*) filter (where p.status in ('PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'APPROVAL_PENDING')) as pending_count
  from public.cumbre_payments p
  group by p.booking_id
)
select
  b.id as booking_id,
  lower(b.contact_email) as email,
  b.currency,
  b.total_amount,
  b.total_paid as booking_total_paid,
  coalesce(pa.approved_total, 0) as approved_total,
  coalesce(pa.pending_total, 0) as pending_total,
  coalesce(pa.approved_count, 0) as approved_count,
  coalesce(pa.pending_count, 0) as pending_count,
  (coalesce(pa.approved_total, 0) - coalesce(b.total_paid, 0))::numeric as diff_approved_vs_booking,
  (coalesce(b.total_amount, 0) - coalesce(pa.approved_total, 0))::numeric as remaining_without_pending,
  (coalesce(b.total_amount, 0) - coalesce(pa.approved_total, 0) - coalesce(pa.pending_total, 0))::numeric as remaining_after_pending
from public.cumbre_bookings b
left join payment_agg pa on pa.booking_id = b.id
where coalesce(pa.approved_total, 0) > 0
   or coalesce(pa.pending_total, 0) > 0
order by
  (coalesce(pa.approved_total, 0) > coalesce(b.total_amount, 0)) desc,
  coalesce(pa.pending_count, 0) desc,
  b.created_at desc;

-- =========================================================
-- Q2) Sobrepagos reales (aprobado > total de booking)
-- =========================================================
with payment_agg as (
  select
    p.booking_id,
    coalesce(sum(case when p.status = 'APPROVED' then coalesce(p.amount, 0) else 0 end), 0)::numeric as approved_total,
    count(*) filter (where p.status = 'APPROVED') as approved_count
  from public.cumbre_payments p
  group by p.booking_id
)
select
  b.id as booking_id,
  lower(b.contact_email) as email,
  b.currency,
  b.total_amount,
  pa.approved_total,
  (pa.approved_total - coalesce(b.total_amount, 0))::numeric as overpaid_amount,
  pa.approved_count,
  b.status as booking_status,
  b.created_at
from public.cumbre_bookings b
join payment_agg pa on pa.booking_id = b.id
where pa.approved_total > coalesce(b.total_amount, 0) + 0.01
order by overpaid_amount desc, b.created_at desc;

-- =========================================================
-- Q3) Pagos en verificacion (pendientes) de mayor riesgo
-- =========================================================
select
  p.id as payment_id,
  p.booking_id,
  lower(b.contact_email) as email,
  p.provider,
  p.status,
  p.reference,
  p.provider_tx_id,
  p.amount,
  p.currency,
  p.plan_id,
  p.installment_id,
  p.created_at,
  now() - p.created_at as pending_age
from public.cumbre_payments p
left join public.cumbre_bookings b on b.id = p.booking_id
where p.status in ('PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'APPROVAL_PENDING')
order by p.created_at asc;

-- =========================================================
-- Q4) Cuotas vencidas aun no pagadas (PENDING/FAILED)
-- =========================================================
select
  i.id as installment_id,
  i.plan_id,
  i.booking_id,
  lower(b.contact_email) as email,
  pp.provider,
  pp.provider_payment_method_id,
  pp.provider_subscription_id,
  i.installment_index,
  i.due_date,
  i.amount,
  i.currency,
  i.status as installment_status,
  i.last_error,
  i.provider_reference,
  i.provider_tx_id,
  i.paid_at,
  pp.status as plan_status
from public.cumbre_installments i
join public.cumbre_payment_plans pp on pp.id = i.plan_id
left join public.cumbre_bookings b on b.id = i.booking_id
where i.status in ('PENDING', 'FAILED')
  and i.due_date <= (now() at time zone 'America/Bogota')::date
order by i.due_date asc, i.created_at asc;

-- =========================================================
-- Q5) Cuotas en PROCESSING (pendientes de confirmacion proveedor)
-- =========================================================
select
  i.id as installment_id,
  i.plan_id,
  i.booking_id,
  lower(b.contact_email) as email,
  i.installment_index,
  i.due_date,
  i.amount,
  i.status,
  i.provider_reference,
  i.provider_tx_id,
  i.updated_at,
  now() - i.updated_at as processing_age
from public.cumbre_installments i
left join public.cumbre_bookings b on b.id = i.booking_id
where i.status = 'PROCESSING'
order by i.updated_at asc;

-- =========================================================
-- Q6) Descuadre booking.total_paid vs suma aprobados
-- =========================================================
with approved as (
  select
    booking_id,
    coalesce(sum(coalesce(amount, 0)), 0)::numeric as approved_total
  from public.cumbre_payments
  where status = 'APPROVED'
  group by booking_id
)
select
  b.id as booking_id,
  lower(b.contact_email) as email,
  b.total_paid as booking_total_paid,
  coalesce(a.approved_total, 0) as approved_total,
  (coalesce(a.approved_total, 0) - coalesce(b.total_paid, 0))::numeric as diff
from public.cumbre_bookings b
left join approved a on a.booking_id = b.id
where abs(coalesce(a.approved_total, 0) - coalesce(b.total_paid, 0)) > 0.01
order by abs(coalesce(a.approved_total, 0) - coalesce(b.total_paid, 0)) desc;

-- =========================================================
-- Q7) Diagnostico dirigido por correo (editar values)
-- =========================================================
with targets(email) as (
  values
    ('monipalacio77@gmail.com'),
    ('monicapalacio@ministeriomana.org')
),
target_bookings as (
  select b.*
  from public.cumbre_bookings b
  join targets t on lower(b.contact_email) = lower(t.email)
),
approved as (
  select
    p.booking_id,
    coalesce(sum(case when p.status = 'APPROVED' then coalesce(p.amount, 0) else 0 end), 0)::numeric as approved_total,
    coalesce(sum(case when p.status in ('PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'APPROVAL_PENDING') then coalesce(p.amount, 0) else 0 end), 0)::numeric as pending_total
  from public.cumbre_payments p
  join target_bookings b on b.id = p.booking_id
  group by p.booking_id
)
select
  lower(b.contact_email) as email,
  b.id as booking_id,
  b.status as booking_status,
  b.total_amount,
  b.total_paid as booking_total_paid,
  coalesce(a.approved_total, 0) as approved_total,
  coalesce(a.pending_total, 0) as pending_total,
  (coalesce(b.total_amount, 0) - coalesce(a.approved_total, 0))::numeric as remaining_without_pending,
  (coalesce(b.total_amount, 0) - coalesce(a.approved_total, 0) - coalesce(a.pending_total, 0))::numeric as remaining_after_pending
from target_bookings b
left join approved a on a.booking_id = b.id
order by lower(b.contact_email), b.created_at desc;
