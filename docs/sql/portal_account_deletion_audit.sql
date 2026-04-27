-- Portal Account Deletion Audit
-- Fecha: 2026-02-19
-- Uso: ejecutar en Supabase SQL Editor (produccion) con rol admin.
-- Seguridad: SOLO lectura (sin updates/deletes/inserts).
-- Objetivo:
-- 1) Distinguir cuentas bloqueadas vs cuentas eliminadas por autoservicio.
-- 2) Validar retencion operativa/contable despues de soft-delete.
-- 3) Detectar drift (suscripciones o memberships activas en cuentas eliminadas).

-- =========================================================
-- Q1) Distribucion de estado de acceso en auth.users
-- =========================================================
with auth_state as (
  select
    u.id,
    lower(u.email) as email,
    u.created_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    u.banned_until,
    case
      when coalesce(u.raw_user_meta_data ->> 'account_deleted_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (u.raw_user_meta_data ->> 'account_deleted_at')::timestamptz
      else null
    end as account_deleted_at,
    nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') as account_deleted_by
  from auth.users u
)
select
  case
    when account_deleted_at is not null
      and account_deleted_by = 'self_service'
      and coalesce(banned_until, now() - interval '1 second') > now() then 'SOFT_DELETED_ACTIVO'
    when coalesce(banned_until, now() - interval '1 second') > now() then 'BLOQUEADO_NO_DELETE'
    when email_confirmed_at is null then 'PENDIENTE_CONFIRMACION'
    when last_sign_in_at is null then 'CONFIRMADO_SIN_INGRESO'
    else 'ACTIVO'
  end as auth_access_state,
  count(*) as total_users
from auth_state
group by auth_access_state
order by total_users desc, auth_access_state;

-- =========================================================
-- Q2) Cuentas eliminadas por autoservicio (detalle + perfil)
-- =========================================================
with deleted_users as (
  select
    u.id,
    lower(u.email) as email,
    case
      when coalesce(u.raw_user_meta_data ->> 'account_deleted_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (u.raw_user_meta_data ->> 'account_deleted_at')::timestamptz
      else null
    end as account_deleted_at,
    nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') as account_deleted_by,
    nullif(u.raw_user_meta_data ->> 'account_delete_reason', '') as account_delete_reason,
    u.banned_until
  from auth.users u
  where nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') = 'self_service'
)
select
  du.email,
  du.account_deleted_at,
  du.account_delete_reason,
  du.banned_until,
  p.role as profile_role,
  p.country as profile_country,
  p.church_id,
  p.region_id,
  p.updated_at as profile_updated_at
from deleted_users du
left join public.user_profiles p on p.user_id = du.id
order by du.account_deleted_at desc nulls last, du.email;

-- =========================================================
-- Q3) Drift: eliminados con suscripciones/memberships aun activas
-- Esperado: 0 filas.
-- =========================================================
with deleted_users as (
  select
    u.id,
    lower(u.email) as email
  from auth.users u
  where nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') = 'self_service'
)
select
  du.email,
  count(distinct drs.id) filter (where drs.status in ('ACTIVE', 'PAUSED')) as active_reminder_subscriptions,
  count(distinct cm.id) filter (where cm.status <> 'inactive') as non_inactive_memberships
from deleted_users du
left join public.donation_reminder_subscriptions drs
  on lower(drs.donor_email) = du.email
left join public.church_memberships cm
  on cm.user_id = du.id
group by du.email
having
  count(distinct drs.id) filter (where drs.status in ('ACTIVE', 'PAUSED')) > 0
  or count(distinct cm.id) filter (where cm.status <> 'inactive') > 0
order by du.email;

-- =========================================================
-- Q4) Impacto economico historico en cuentas eliminadas
-- =========================================================
with deleted_users as (
  select
    u.id,
    lower(u.email) as email,
    case
      when coalesce(u.raw_user_meta_data ->> 'account_deleted_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (u.raw_user_meta_data ->> 'account_deleted_at')::timestamptz
      else null
    end as account_deleted_at
  from auth.users u
  where nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') = 'self_service'
),
booking_agg as (
  select
    lower(b.contact_email) as email,
    count(*) as bookings_count,
    coalesce(sum(coalesce(b.total_amount, 0)), 0)::numeric as bookings_total_amount,
    coalesce(sum(coalesce(b.total_paid, 0)), 0)::numeric as bookings_total_paid
  from public.cumbre_bookings b
  where b.contact_email is not null
  group by lower(b.contact_email)
),
donation_agg as (
  select
    lower(d.donor_email) as email,
    count(*) as donations_count,
    coalesce(sum(coalesce(d.amount, 0)), 0)::numeric as donations_total_amount
  from public.donations d
  where d.donor_email is not null
  group by lower(d.donor_email)
)
select
  du.email,
  du.account_deleted_at,
  coalesce(ba.bookings_count, 0) as bookings_count,
  coalesce(ba.bookings_total_amount, 0) as bookings_total_amount,
  coalesce(ba.bookings_total_paid, 0) as bookings_total_paid,
  coalesce(da.donations_count, 0) as donations_count,
  coalesce(da.donations_total_amount, 0) as donations_total_amount
from deleted_users du
left join booking_agg ba on ba.email = du.email
left join donation_agg da on da.email = du.email
order by bookings_total_paid desc, donations_total_amount desc, du.email;

-- =========================================================
-- Q5) Retencion: antiguedad de soft-delete
-- =========================================================
with deleted_users as (
  select
    case
      when coalesce(u.raw_user_meta_data ->> 'account_deleted_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        then (u.raw_user_meta_data ->> 'account_deleted_at')::timestamptz
      else null
    end as account_deleted_at
  from auth.users u
  where nullif(u.raw_user_meta_data ->> 'account_deleted_by', '') = 'self_service'
)
select
  case
    when account_deleted_at is null then 'SIN_FECHA_DELETE'
    when account_deleted_at >= now() - interval '30 days' then '0_30_DIAS'
    when account_deleted_at >= now() - interval '90 days' then '31_90_DIAS'
    when account_deleted_at >= now() - interval '180 days' then '91_180_DIAS'
    else '181+_DIAS'
  end as retention_bucket,
  count(*) as accounts
from deleted_users
group by retention_bucket
order by accounts desc, retention_bucket;

-- =========================================================
-- Q6) Trazabilidad en security_events (30 dias)
-- =========================================================
select
  se.created_at,
  se.identifier,
  se.detail,
  se.meta
from public.security_events se
where se.created_at >= now() - interval '30 days'
  and se.identifier in (
    'portal.account.deleted',
    'portal.ingresar.password',
    'portal.ingresar.captcha.blocked'
  )
order by se.created_at desc
limit 500;
