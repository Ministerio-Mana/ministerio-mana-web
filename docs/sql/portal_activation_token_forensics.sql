-- Auditoria forense de enlaces de activacion (portal/activar)
-- Fecha: 2026-02-18
-- Uso: Supabase SQL Editor (produccion), solo lectura.
-- Objetivo:
-- 1) Validar estado real de usuarios invitados (auth.users).
-- 2) Correlacionar envios de link y fallas de validacion.
-- 3) Distinguir causas: expiracion, token consumido, tipo/token invalido.

-- =========================================================
-- Q1) Cohorte bootstrap + estado auth
-- =========================================================
with cohort as (
  select
    lower(q.email_normalized) as email,
    q.status as queue_status,
    q.updated_at as queue_updated_at,
    q.paid_amount,
    q.bookings_count
  from public.portal_profile_bootstrap_queue q
  where q.status in ('invited', 'linked')
)
select
  c.email,
  c.queue_status,
  c.queue_updated_at,
  c.paid_amount,
  c.bookings_count,
  u.id as auth_user_id,
  u.created_at as auth_created_at,
  u.invited_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.confirmation_sent_at,
  u.recovery_sent_at,
  case
    when u.id is null then 'SIN_AUTH_USER'
    when u.email_confirmed_at is not null then 'CONFIRMADO'
    when u.recovery_sent_at is not null and u.recovery_sent_at >= now() - interval '24 hours' then 'RECOVERY_RECIENTE_NO_CONFIRMADO'
    when u.confirmation_sent_at is not null and u.confirmation_sent_at >= now() - interval '24 hours' then 'INVITE_RECIENTE_NO_CONFIRMADO'
    when coalesce(u.recovery_sent_at, u.confirmation_sent_at, u.invited_at) < now() - interval '24 hours' then 'LINK_POSIBLEMENTE_EXPIRADO'
    else 'PENDIENTE'
  end as activation_state
from cohort c
left join auth.users u on lower(u.email) = c.email
order by c.queue_status, c.paid_amount desc, c.queue_updated_at desc;

-- =========================================================
-- Q2) Distribucion por estado de activacion
-- =========================================================
with cohort as (
  select lower(email_normalized) as email
  from public.portal_profile_bootstrap_queue
  where status in ('invited', 'linked')
),
state as (
  select
    case
      when u.id is null then 'SIN_AUTH_USER'
      when u.email_confirmed_at is not null then 'CONFIRMADO'
      when coalesce(u.recovery_sent_at, u.confirmation_sent_at, u.invited_at) < now() - interval '24 hours' then 'LINK_POSIBLEMENTE_EXPIRADO'
      else 'PENDIENTE_RECIENTE'
    end as activation_state
  from cohort c
  left join auth.users u on lower(u.email) = c.email
)
select activation_state, count(*) as total
from state
group by activation_state
order by total desc;

-- =========================================================
-- Q3) Eventos de envio de links (ultima semana)
-- Requiere cambios de instrumentacion en codigo server.
-- =========================================================
select
  se.created_at,
  se.identifier,
  se.detail,
  se.meta
from public.security_events se
where se.created_at >= now() - interval '7 days'
  and se.identifier in (
    'auth.send-link.generated',
    'auth.send-link.sent',
    'auth.send-link.sendgrid.error',
    'auth.send-link.supabase',
    'auth.send-link.supabase.error'
  )
order by se.created_at desc
limit 500;

-- =========================================================
-- Q4) Fallas de activacion capturadas en cliente (ultima semana)
-- Requiere cambios de instrumentacion en portal-activar.js
-- =========================================================
select
  se.created_at,
  se.type,
  se.identifier,
  se.detail,
  se.ip,
  se.meta
from public.security_events se
where se.created_at >= now() - interval '7 days'
  and se.identifier = 'portal.activar.token'
order by se.created_at desc
limit 500;

-- =========================================================
-- Q5) Señales de expiracion/uso de token por evento
-- =========================================================
select
  date_trunc('hour', se.created_at) as hour_utc,
  count(*) filter (where lower(coalesce(se.detail, '')) like '%expired%') as expired_hits,
  count(*) filter (where lower(coalesce(se.detail, '')) like '%used%') as used_hits,
  count(*) filter (where lower(coalesce(se.detail, '')) like '%invalid%') as invalid_hits,
  count(*) as total_hits
from public.security_events se
where se.created_at >= now() - interval '7 days'
  and se.identifier = 'portal.activar.token'
group by date_trunc('hour', se.created_at)
order by hour_utc desc;

-- =========================================================
-- Q6) Cohorte pastoral (pastores y colaboradores) + estado auth
-- =========================================================
with pastors as (
  select
    lower(p.email) as email,
    p.role,
    p.full_name
  from public.user_profiles p
  where p.role in (
    'pastor',
    'regional_pastor',
    'national_pastor',
    'local_collaborator',
    'regional_collaborator',
    'national_collaborator'
  )
)
select
  p.email,
  p.role,
  p.full_name,
  u.id as auth_user_id,
  u.invited_at,
  u.confirmation_sent_at,
  u.recovery_sent_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  case
    when u.id is null then 'SIN_AUTH_USER'
    when u.email_confirmed_at is not null then 'CONFIRMADO'
    when coalesce(u.recovery_sent_at, u.confirmation_sent_at, u.invited_at) < now() - interval '24 hours'
      then 'LINK_POSIBLEMENTE_EXPIRADO'
    else 'PENDIENTE_RECIENTE'
  end as activation_state
from pastors p
left join auth.users u
  on lower(u.email) = p.email
order by activation_state, p.role, p.email;
