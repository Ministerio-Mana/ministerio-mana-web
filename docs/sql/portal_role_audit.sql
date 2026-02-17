-- Auditoria de Portal por rol / acceso / pagos
-- Fecha: 2026-02-17
-- Ejecutar en Supabase SQL Editor (proyecto de produccion) con rol admin.
--
-- Objetivo:
-- 1) Ver salud por rol (superadmin/admin/pastor nacional/pastor/local_collaborator/etc).
-- 2) Detectar usuarios con datos inconsistentes que pueden afectar carga de panel.
-- 3) Medir usuarios con reservas/planes (grupo que antes disparaba "Algo salio mal").
-- 4) Auditar un usuario puntual (por defecto: luis2_8@hotmail.com).

-- =========================================================
-- Q1) Distribucion de perfiles por rol + estado auth
-- =========================================================
with profile_auth as (
  select
    p.user_id,
    lower(p.email) as email,
    p.role,
    p.country,
    p.church_id,
    p.portal_church_id,
    u.email_confirmed_at,
    u.last_sign_in_at,
    u.banned_until
  from public.user_profiles p
  left join auth.users u
    on u.id = p.user_id
)
select
  role,
  count(*) as total_users,
  count(*) filter (where email_confirmed_at is null) as sin_confirmar_email,
  count(*) filter (
    where banned_until is not null
      and banned_until > now()
  ) as bloqueados,
  count(*) filter (where coalesce(country, '') = '') as sin_pais,
  count(*) filter (where coalesce(church_id, portal_church_id) is null) as sin_iglesia_en_perfil
from profile_auth
group by role
order by total_users desc, role;

-- =========================================================
-- Q2) Rol "efectivo" (como lo interpreta el backend en /api/portal/admin/users/list)
-- =========================================================
with membership_flags as (
  select
    cm.user_id,
    bool_or(cm.role = 'church_admin' and cm.status <> 'pending') as has_admin_membership,
    bool_or(cm.role = 'church_member' and cm.status <> 'pending') as has_member_membership
  from public.church_memberships cm
  group by cm.user_id
),
resolved as (
  select
    p.user_id,
    lower(p.email) as email,
    p.role as profile_role,
    case
      when p.role in ('superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator') then p.role
      when coalesce(mf.has_admin_membership, false) then 'pastor'
      when coalesce(mf.has_member_membership, false) then 'local_collaborator'
      else p.role
    end as effective_role
  from public.user_profiles p
  left join membership_flags mf
    on mf.user_id = p.user_id
)
select
  effective_role,
  count(*) as users_count
from resolved
group by effective_role
order by users_count desc, effective_role;

-- =========================================================
-- Q3) Usuarios con diferencia entre profile_role y effective_role
-- =========================================================
with membership_flags as (
  select
    cm.user_id,
    bool_or(cm.role = 'church_admin' and cm.status <> 'pending') as has_admin_membership,
    bool_or(cm.role = 'church_member' and cm.status <> 'pending') as has_member_membership
  from public.church_memberships cm
  group by cm.user_id
),
resolved as (
  select
    p.user_id,
    lower(p.email) as email,
    p.full_name,
    p.role as profile_role,
    case
      when p.role in ('superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator') then p.role
      when coalesce(mf.has_admin_membership, false) then 'pastor'
      when coalesce(mf.has_member_membership, false) then 'local_collaborator'
      else p.role
    end as effective_role
  from public.user_profiles p
  left join membership_flags mf
    on mf.user_id = p.user_id
)
select
  email,
  full_name,
  profile_role,
  effective_role
from resolved
where profile_role <> effective_role
order by profile_role, effective_role, email
limit 500;

-- =========================================================
-- Q4) Inconsistencias de datos por rol (posibles focos de errores)
-- =========================================================
with approved_memberships as (
  select
    cm.user_id,
    count(*) filter (where cm.status <> 'pending') as approved_memberships
  from public.church_memberships cm
  group by cm.user_id
),
base as (
  select
    p.user_id,
    lower(p.email) as email,
    p.full_name,
    p.role,
    p.country,
    p.church_id,
    p.portal_church_id,
    coalesce(am.approved_memberships, 0) as approved_memberships
  from public.user_profiles p
  left join approved_memberships am
    on am.user_id = p.user_id
)
select
  email,
  full_name,
  role,
  country,
  church_id,
  portal_church_id,
  approved_memberships,
  case
    when role = 'national_pastor' and coalesce(country, '') = '' then 'national_pastor sin country'
    when role in ('pastor', 'local_collaborator', 'leader')
      and coalesce(church_id, portal_church_id) is null
      and approved_memberships = 0 then 'rol pastoral/local sin iglesia ni membership aprobada'
    when role not in ('user', 'admin', 'superadmin', 'national_pastor', 'pastor', 'local_collaborator', 'campus_missionary', 'leader') then 'rol no reconocido'
    else null
  end as issue
from base
where
  (role = 'national_pastor' and coalesce(country, '') = '')
  or (
    role in ('pastor', 'local_collaborator', 'leader')
    and coalesce(church_id, portal_church_id) is null
    and approved_memberships = 0
  )
  or role not in ('user', 'admin', 'superadmin', 'national_pastor', 'pastor', 'local_collaborator', 'campus_missionary', 'leader')
order by role, email
limit 1000;

-- =========================================================
-- Q5) Cobertura por rol: reservas / planes / cuotas / pagos
-- =========================================================
with booking_by_email as (
  select
    lower(b.contact_email) as email,
    count(*) as bookings_total,
    count(*) filter (where b.status = 'PAID') as bookings_paid,
    count(*) filter (where b.status <> 'PAID') as bookings_non_paid
  from public.cumbre_bookings b
  where b.contact_email is not null
  group by lower(b.contact_email)
),
plan_by_email as (
  select
    lower(b.contact_email) as email,
    count(distinct pp.id) as plans_total,
    count(distinct pp.id) filter (where pp.status = 'ACTIVE') as plans_active,
    count(distinct i.id) as installments_total,
    count(distinct i.id) filter (where i.status in ('PENDING', 'FAILED')) as installments_pending
  from public.cumbre_bookings b
  join public.cumbre_payment_plans pp
    on pp.booking_id = b.id
  left join public.cumbre_installments i
    on i.plan_id = pp.id
  where b.contact_email is not null
  group by lower(b.contact_email)
),
payment_by_email as (
  select
    lower(b.contact_email) as email,
    count(distinct pay.id) as payments_total,
    count(distinct pay.id) filter (where pay.status = 'APPROVED') as payments_approved
  from public.cumbre_bookings b
  join public.cumbre_payments pay
    on pay.booking_id = b.id
  where b.contact_email is not null
  group by lower(b.contact_email)
)
select
  p.role,
  count(*) as users_total,
  count(*) filter (where coalesce(be.bookings_total, 0) > 0) as users_with_bookings,
  count(*) filter (where coalesce(pe.plans_total, 0) > 0) as users_with_plans,
  count(*) filter (where coalesce(pe.plans_active, 0) > 0) as users_with_active_plans,
  count(*) filter (where coalesce(pe.installments_pending, 0) > 0) as users_with_pending_installments,
  count(*) filter (where coalesce(paye.payments_approved, 0) > 0) as users_with_approved_payments
from public.user_profiles p
left join booking_by_email be
  on be.email = lower(p.email)
left join plan_by_email pe
  on pe.email = lower(p.email)
left join payment_by_email paye
  on paye.email = lower(p.email)
group by p.role
order by users_total desc, p.role;

-- =========================================================
-- Q6) Usuarios por rol con planes (grupo historicamente sensible)
-- =========================================================
with booking_by_email as (
  select
    lower(b.contact_email) as email,
    count(*) as bookings_total
  from public.cumbre_bookings b
  where b.contact_email is not null
  group by lower(b.contact_email)
),
plan_by_email as (
  select
    lower(b.contact_email) as email,
    count(distinct pp.id) as plans_total,
    count(distinct pp.id) filter (where pp.status = 'ACTIVE') as plans_active
  from public.cumbre_bookings b
  join public.cumbre_payment_plans pp
    on pp.booking_id = b.id
  where b.contact_email is not null
  group by lower(b.contact_email)
)
select
  p.role,
  lower(p.email) as email,
  p.full_name,
  coalesce(be.bookings_total, 0) as bookings_total,
  coalesce(pe.plans_total, 0) as plans_total,
  coalesce(pe.plans_active, 0) as plans_active
from public.user_profiles p
left join booking_by_email be
  on be.email = lower(p.email)
left join plan_by_email pe
  on pe.email = lower(p.email)
where coalesce(pe.plans_total, 0) > 0
order by p.role, plans_active desc, plans_total desc, email
limit 1000;

-- =========================================================
-- Q7) Auditoria detallada del usuario objetivo
-- Cambia el correo aqui si quieres revisar otro usuario.
-- =========================================================
with params as (
  select lower('luis2_8@hotmail.com') as target_email
),
target_profile as (
  select
    p.user_id,
    lower(p.email) as email,
    p.full_name,
    p.role,
    p.country,
    p.city,
    p.church_name,
    p.church_id,
    p.portal_church_id,
    u.email_confirmed_at,
    u.last_sign_in_at,
    u.banned_until
  from public.user_profiles p
  left join auth.users u
    on u.id = p.user_id
  join params x
    on lower(p.email) = x.target_email
)
select * from target_profile;

-- Membresias del usuario objetivo
with params as (
  select lower('luis2_8@hotmail.com') as target_email
),
target_user as (
  select p.user_id
  from public.user_profiles p
  join params x on lower(p.email) = x.target_email
)
select
  cm.id,
  cm.role,
  cm.status,
  cm.created_at,
  c.id as church_id,
  c.name as church_name,
  c.city as church_city,
  c.country as church_country
from public.church_memberships cm
join target_user tu
  on tu.user_id = cm.user_id
left join public.churches c
  on c.id = cm.church_id
order by cm.created_at desc;

-- Reservas y relacion con planes/cuotas/pagos
with params as (
  select lower('luis2_8@hotmail.com') as target_email
)
select
  b.id as booking_id,
  b.status as booking_status,
  b.source,
  b.currency,
  b.total_amount,
  b.total_paid,
  b.created_at,
  count(distinct pp.id) as plans_total,
  count(distinct pp.id) filter (where pp.status = 'ACTIVE') as plans_active,
  count(distinct i.id) as installments_total,
  count(distinct i.id) filter (where i.status in ('PENDING', 'FAILED')) as installments_pending,
  count(distinct pay.id) as payments_total,
  count(distinct pay.id) filter (where pay.status = 'APPROVED') as payments_approved
from public.cumbre_bookings b
left join public.cumbre_payment_plans pp
  on pp.booking_id = b.id
left join public.cumbre_installments i
  on i.plan_id = pp.id
left join public.cumbre_payments pay
  on pay.booking_id = b.id
join params x
  on lower(b.contact_email) = x.target_email
group by b.id, b.status, b.source, b.currency, b.total_amount, b.total_paid, b.created_at
order by b.created_at desc;

-- Cuotas del usuario objetivo
with params as (
  select lower('luis2_8@hotmail.com') as target_email
)
select
  i.id as installment_id,
  i.booking_id,
  i.plan_id,
  i.installment_index,
  i.status,
  i.amount,
  i.currency,
  i.due_date,
  i.paid_at,
  i.provider_reference,
  i.provider_tx_id
from public.cumbre_installments i
join public.cumbre_bookings b
  on b.id = i.booking_id
join params x
  on lower(b.contact_email) = x.target_email
order by i.due_date nulls last, i.created_at desc;

-- Pagos del usuario objetivo
with params as (
  select lower('luis2_8@hotmail.com') as target_email
)
select
  pay.id as payment_id,
  pay.booking_id,
  pay.status,
  pay.provider,
  pay.method,
  pay.amount,
  pay.currency,
  pay.reference,
  pay.provider_tx_id,
  pay.created_at
from public.cumbre_payments pay
join public.cumbre_bookings b
  on b.id = pay.booking_id
join params x
  on lower(b.contact_email) = x.target_email
order by pay.created_at desc;

-- =========================================================
-- Q8) Eventos de seguridad del portal (ultimas 48 horas)
-- =========================================================
select
  se.type,
  se.identifier,
  count(*) as hits,
  max(se.created_at) as last_seen
from public.security_events se
where se.created_at >= now() - interval '48 hours'
  and (se.identifier ilike 'portal.%' or se.identifier ilike 'auth.%')
group by se.type, se.identifier
order by hits desc, last_seen desc;

