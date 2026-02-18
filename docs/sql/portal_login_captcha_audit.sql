-- Auditoria de login/captcha portal
-- Fecha: 2026-02-18
-- Solo lectura.
-- Ejecutar en Supabase SQL Editor (produccion).

-- =========================================================
-- Q1) Resumen de eventos de login (ultimos 7 dias)
-- =========================================================
select
  se.type,
  se.identifier,
  se.detail,
  count(*) as hits,
  max(se.created_at) as last_seen
from public.security_events se
where se.created_at >= now() - interval '7 days'
  and (
    se.identifier = 'portal.password-login'
    or se.identifier = 'portal.password-login.invalid-credentials'
    or se.identifier like 'portal.password:%'
  )
group by se.type, se.identifier, se.detail
order by hits desc, last_seen desc;

-- =========================================================
-- Q2) Linea de tiempo por hora para captcha/login
-- =========================================================
select
  date_trunc('hour', se.created_at) as hour_utc,
  se.type,
  se.identifier,
  count(*) as hits
from public.security_events se
where se.created_at >= now() - interval '72 hours'
  and (
    se.identifier = 'portal.password-login'
    or se.identifier = 'portal.password-login.invalid-credentials'
    or se.identifier like 'portal.password:%'
  )
group by date_trunc('hour', se.created_at), se.type, se.identifier
order by hour_utc desc, hits desc;

-- =========================================================
-- Q3) Top IPs con captcha_failed/rate_limited
-- =========================================================
select
  coalesce(se.ip, 'unknown') as ip,
  se.type,
  se.identifier,
  count(*) as hits,
  max(se.created_at) as last_seen
from public.security_events se
where se.created_at >= now() - interval '7 days'
  and (
    se.type in ('captcha_failed', 'rate_limited')
    or se.identifier like 'portal.password:%'
  )
group by coalesce(se.ip, 'unknown'), se.type, se.identifier
order by hits desc, last_seen desc
limit 200;

-- =========================================================
-- Q4) Usuarios objetivo: estado auth + ultimo login
-- =========================================================
with targets(email) as (
  values
    ('monicapalacio@ministeriomana.org'),
    ('luis2_8@hotmail.com')
)
select
  lower(t.email) as target_email,
  p.user_id,
  p.role,
  p.country,
  p.church_id,
  p.portal_church_id,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.banned_until
from targets t
left join public.user_profiles p
  on lower(p.email) = lower(t.email)
left join auth.users u
  on u.id = p.user_id
order by lower(t.email);

-- =========================================================
-- Q5) Eventos recientes que mencionan portal/auth (48h)
-- =========================================================
select
  se.created_at,
  se.type,
  se.identifier,
  se.detail,
  se.ip,
  se.meta
from public.security_events se
where se.created_at >= now() - interval '48 hours'
  and (se.identifier ilike 'portal.%' or se.identifier ilike 'auth.%')
order by se.created_at desc
limit 500;
