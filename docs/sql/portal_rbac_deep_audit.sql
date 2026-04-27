-- Portal RBAC Deep Audit
-- Fecha: 2026-02-18
-- Uso: ejecutar en Supabase SQL Editor (produccion) con rol admin.
-- Seguridad: SOLO lectura (sin updates/deletes/inserts).

-- =========================================================
-- Contrato de roles de perfil (actual)
-- =========================================================
-- user
-- local_collaborator
-- pastor
-- regional_collaborator
-- regional_pastor
-- national_collaborator
-- national_pastor
-- campus_missionary
-- leader
-- admin
-- superadmin

-- =========================================================
-- Q1) Distribucion de perfiles y campos criticos por rol
-- =========================================================
select
  p.role,
  count(*) as total_users,
  count(*) filter (where coalesce(p.email, '') = '') as email_vacio,
  count(*) filter (where p.user_id is null) as user_id_nulo,
  count(*) filter (where coalesce(p.country, '') = '') as sin_country,
  count(*) filter (where coalesce(p.church_id, p.portal_church_id) is null) as sin_church_scope,
  count(*) filter (where p.region_id is null) as sin_region_scope
from public.user_profiles p
group by p.role
order by total_users desc, p.role;

-- =========================================================
-- Q2) Roles no reconocidos por el contrato actual
-- =========================================================
select
  p.user_id,
  lower(p.email) as email,
  p.role,
  p.country,
  p.church_id,
  p.portal_church_id,
  p.region_id
from public.user_profiles p
where p.role not in (
  'user',
  'admin',
  'superadmin',
  'national_pastor',
  'national_collaborator',
  'regional_pastor',
  'regional_collaborator',
  'pastor',
  'local_collaborator',
  'campus_missionary',
  'leader'
)
order by p.role, lower(p.email);

-- =========================================================
-- Q3) Rol efectivo por memberships (fallback operativo)
--    church_admin -> pastor
--    church_member -> local_collaborator
-- =========================================================
with membership_flags as (
  select
    cm.user_id,
    bool_or(cm.role = 'church_admin' and cm.status <> 'pending') as has_admin_membership,
    bool_or(cm.role = 'church_member' and cm.status <> 'pending') as has_member_membership,
    count(*) filter (where cm.status <> 'pending') as memberships_ok
  from public.church_memberships cm
  group by cm.user_id
),
resolved as (
  select
    p.user_id,
    lower(p.email) as email,
    p.role as profile_role,
    case
      when p.role in (
        'superadmin', 'admin',
        'national_pastor', 'national_collaborator',
        'regional_pastor', 'regional_collaborator',
        'pastor', 'local_collaborator'
      ) then p.role
      when coalesce(mf.has_admin_membership, false) then 'pastor'
      when coalesce(mf.has_member_membership, false) then 'local_collaborator'
      else p.role
    end as effective_role,
    coalesce(mf.memberships_ok, 0) as memberships_ok
  from public.user_profiles p
  left join membership_flags mf on mf.user_id = p.user_id
)
select
  profile_role,
  effective_role,
  count(*) as users_count
from resolved
group by profile_role, effective_role
order by profile_role, users_count desc;

-- =========================================================
-- Q4) Usuarios con mismatch profile_role vs effective_role
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
      when p.role in (
        'superadmin', 'admin',
        'national_pastor', 'national_collaborator',
        'regional_pastor', 'regional_collaborator',
        'pastor', 'local_collaborator'
      ) then p.role
      when coalesce(mf.has_admin_membership, false) then 'pastor'
      when coalesce(mf.has_member_membership, false) then 'local_collaborator'
      else p.role
    end as effective_role
  from public.user_profiles p
  left join membership_flags mf on mf.user_id = p.user_id
)
select
  email,
  full_name,
  profile_role,
  effective_role
from resolved
where profile_role <> effective_role
order by profile_role, effective_role, email
limit 1000;

-- =========================================================
-- Q5) Integridad de scope por tipo de rol
-- =========================================================
with memberships_ok as (
  select
    cm.user_id,
    count(*) filter (where cm.status <> 'pending') as memberships_ok
  from public.church_memberships cm
  group by cm.user_id
),
regional_assignments as (
  select
    rla.user_id,
    count(*) filter (
      where rla.status = 'active'
        and rla.role in ('regional_pastor', 'regional_collaborator')
    ) as regional_assignments_ok
  from public.region_leadership_assignments rla
  group by rla.user_id
)
select
  lower(p.email) as email,
  p.role,
  p.country,
  p.church_id,
  p.portal_church_id,
  p.region_id,
  coalesce(m.memberships_ok, 0) as memberships_ok,
  coalesce(ra.regional_assignments_ok, 0) as regional_assignments_ok,
  case
    when p.role in ('national_pastor', 'national_collaborator')
      and coalesce(p.country, '') = '' then 'NATIONAL_SIN_COUNTRY'
    when p.role in ('regional_pastor', 'regional_collaborator')
      and p.region_id is null
      and coalesce(ra.regional_assignments_ok, 0) = 0 then 'REGIONAL_SIN_REGION'
    when p.role in ('pastor', 'local_collaborator', 'leader')
      and coalesce(p.church_id, p.portal_church_id) is null
      and coalesce(m.memberships_ok, 0) = 0 then 'LOCAL_SIN_IGLESIA'
    else null
  end as issue
from public.user_profiles p
left join memberships_ok m on m.user_id = p.user_id
left join regional_assignments ra on ra.user_id = p.user_id
where
  (
    p.role in ('national_pastor', 'national_collaborator')
    and coalesce(p.country, '') = ''
  )
  or (
    p.role in ('regional_pastor', 'regional_collaborator')
    and p.region_id is null
    and coalesce(ra.regional_assignments_ok, 0) = 0
  )
  or (
    p.role in ('pastor', 'local_collaborator', 'leader')
    and coalesce(p.church_id, p.portal_church_id) is null
    and coalesce(m.memberships_ok, 0) = 0
  )
order by p.role, lower(p.email);

-- =========================================================
-- Q6) Memberships de un mismo usuario en multiples paises
--    (riesgo de scope cruzado accidental)
-- =========================================================
with active_memberships as (
  select
    cm.user_id,
    cm.church_id,
    c.country
  from public.church_memberships cm
  join public.churches c on c.id = cm.church_id
  where cm.status <> 'pending'
),
agg as (
  select
    am.user_id,
    count(distinct am.church_id) as churches_count,
    count(distinct coalesce(am.country, '')) as countries_count
  from active_memberships am
  group by am.user_id
)
select
  lower(p.email) as email,
  p.role,
  a.churches_count,
  a.countries_count
from agg a
join public.user_profiles p on p.user_id = a.user_id
where a.countries_count > 1
order by a.countries_count desc, a.churches_count desc, email;

-- =========================================================
-- Q7) Nacionales con memberships fuera de su pais
-- =========================================================
select
  lower(p.email) as email,
  p.role,
  p.country as profile_country,
  c.id as church_id,
  c.name as church_name,
  c.country as church_country,
  cm.role as membership_role,
  cm.status as membership_status
from public.user_profiles p
join public.church_memberships cm on cm.user_id = p.user_id and cm.status <> 'pending'
join public.churches c on c.id = cm.church_id
where p.role in ('national_pastor', 'national_collaborator')
  and coalesce(p.country, '') <> ''
  and c.country <> p.country
order by email, c.country, c.name;

-- =========================================================
-- Q8) Regionales con iglesias fuera de su region asignada
-- =========================================================
with active_region_scope as (
  select distinct
    rla.user_id,
    rla.region_id
  from public.region_leadership_assignments rla
  where rla.status = 'active'
    and rla.role in ('regional_pastor', 'regional_collaborator')
),
active_memberships as (
  select
    cm.user_id,
    cm.church_id
  from public.church_memberships cm
  where cm.status <> 'pending'
)
select
  lower(p.email) as email,
  p.role,
  c.id as church_id,
  c.name as church_name,
  c.country,
  c.region_id as church_region_id,
  ars.region_id as allowed_region_id
from public.user_profiles p
join active_region_scope ars on ars.user_id = p.user_id
join active_memberships am on am.user_id = p.user_id
join public.churches c on c.id = am.church_id
where p.role in ('regional_pastor', 'regional_collaborator')
  and c.region_id is not null
  and c.region_id <> ars.region_id
order by email, c.country, c.name;

-- =========================================================
-- Q9) Eventos con scope inconsistente
-- =========================================================
select
  e.id,
  e.title,
  e.scope,
  e.country,
  e.region_id,
  e.church_id,
  e.created_by,
  e.created_at,
  case
    when e.scope::text = 'LOCAL' and e.church_id is null then 'LOCAL_SIN_CHURCH_ID'
    when e.scope::text = 'LOCAL' and e.region_id is null then 'LOCAL_SIN_REGION_ID'
    when e.scope::text = 'REGIONAL' and e.region_id is null then 'REGIONAL_SIN_REGION_ID'
    when e.scope::text = 'NATIONAL' and coalesce(e.country, '') = '' then 'NATIONAL_SIN_COUNTRY'
    when e.scope::text = 'GLOBAL' and (e.church_id is not null or e.region_id is not null or coalesce(e.country, '') <> '') then 'GLOBAL_CON_SCOPE_RESIDUAL'
    else null
  end as issue
from public.events e
where
  (e.scope::text = 'LOCAL' and e.church_id is null)
  or (e.scope::text = 'LOCAL' and e.region_id is null)
  or (e.scope::text = 'REGIONAL' and e.region_id is null)
  or (e.scope::text = 'NATIONAL' and coalesce(e.country, '') = '')
  or (e.scope::text = 'GLOBAL' and (e.church_id is not null or e.region_id is not null or coalesce(e.country, '') <> ''))
order by e.created_at desc;

-- =========================================================
-- Q10) Eventos regionales creados fuera del scope del creador
-- =========================================================
with creator_scope as (
  select distinct
    rla.user_id,
    rla.region_id
  from public.region_leadership_assignments rla
  where rla.status = 'active'
    and rla.role in ('regional_pastor', 'regional_collaborator')
)
select
  e.id,
  e.title,
  e.scope,
  e.region_id as event_region_id,
  lower(p.email) as creator_email,
  p.role as creator_role,
  p.region_id as profile_region_id,
  e.created_at
from public.events e
join public.user_profiles p on p.user_id = e.created_by
left join creator_scope cs
  on cs.user_id = p.user_id
 and cs.region_id = e.region_id
where e.scope::text = 'REGIONAL'
  and p.role in ('regional_pastor', 'regional_collaborator')
  and (
    e.region_id is null
    or cs.user_id is null
  )
order by e.created_at desc;

-- =========================================================
-- Q11) Cobertura de perfiles para contactos Cumbre
--     (contact_email sin user_profile asociado)
-- =========================================================
select
  lower(b.contact_email) as contact_email,
  count(*) as bookings_count,
  min(b.created_at) as first_seen,
  max(b.created_at) as last_seen
from public.cumbre_bookings b
left join public.user_profiles p on lower(p.email) = lower(b.contact_email)
where b.contact_email is not null
  and p.user_id is null
group by lower(b.contact_email)
order by bookings_count desc, last_seen desc
limit 1000;

-- =========================================================
-- Q12) Bookings portal-iglesia sin church_id
-- =========================================================
select
  b.id,
  b.created_at,
  b.contact_name,
  lower(b.contact_email) as contact_email,
  b.source,
  b.church_id,
  b.contact_church,
  b.total_amount,
  b.total_paid,
  b.status
from public.cumbre_bookings b
where coalesce(b.source, '') = 'portal-iglesia'
  and b.church_id is null
order by b.created_at desc;

-- =========================================================
-- Q13) Calidad de user_profiles vs auth.users
-- =========================================================
select
  lower(p.email) as email,
  p.role,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.banned_until,
  case
    when u.id is null then 'SIN_AUTH_USER'
    when u.email_confirmed_at is null then 'AUTH_NO_CONFIRMADA'
    else 'OK'
  end as auth_issue
from public.user_profiles p
left join auth.users u on u.id = p.user_id
where
  u.id is null
  or u.email_confirmed_at is null
order by auth_issue, email
limit 2000;

-- =========================================================
-- Q14) Roles locales sin membership activa en su iglesia de perfil
-- =========================================================
with active as (
  select
    cm.user_id,
    cm.church_id,
    max(cm.updated_at) as last_membership_update
  from public.church_memberships cm
  where cm.status <> 'pending'
  group by cm.user_id, cm.church_id
)
select
  lower(p.email) as email,
  p.role,
  coalesce(p.church_id, p.portal_church_id) as profile_church_id,
  a.church_id as active_membership_church_id,
  a.last_membership_update
from public.user_profiles p
left join active a
  on a.user_id = p.user_id
 and a.church_id = coalesce(p.church_id, p.portal_church_id)
where p.role in ('pastor', 'local_collaborator')
  and coalesce(p.church_id, p.portal_church_id) is not null
  and a.church_id is null
order by p.role, email;

-- =========================================================
-- Q15) Integridad de cuotas Cumbre (planes e installments)
-- =========================================================
select
  pp.id as plan_id,
  pp.booking_id,
  pp.status as plan_status,
  pp.installment_count,
  count(i.id) as installments_count,
  min(i.due_date) as first_due_date,
  max(i.due_date) as last_due_date
from public.cumbre_payment_plans pp
left join public.cumbre_installments i on i.plan_id = pp.id
group by pp.id, pp.booking_id, pp.status, pp.installment_count
having count(i.id) <> pp.installment_count
order by pp.created_at desc;

-- =========================================================
-- Q16) Regionales sin assignment activo (control principal)
-- =========================================================
select
  lower(p.email) as email,
  p.role,
  p.country,
  p.region_id,
  r.code as profile_region_code,
  count(rla.id) filter (
    where rla.status = 'active'
      and rla.role in ('regional_pastor', 'regional_collaborator')
  ) as active_assignments
from public.user_profiles p
left join public.regions r on r.id = p.region_id
left join public.region_leadership_assignments rla on rla.user_id = p.user_id
where p.role in ('regional_pastor', 'regional_collaborator')
group by p.user_id, p.email, p.role, p.country, p.region_id, r.code
having count(rla.id) filter (
  where rla.status = 'active'
    and rla.role in ('regional_pastor', 'regional_collaborator')
) = 0
order by p.role, email;

-- =========================================================
-- Q17) Diagnostico dirigido por correos reportados
-- =========================================================
with targets(email) as (
  values
    ('luis2_8@hotmail.com'),
    ('monicapalacio@ministeriomana.org')
),
membership_flags as (
  select
    cm.user_id,
    count(*) filter (where cm.status <> 'pending') as memberships_ok,
    bool_or(cm.role = 'church_admin' and cm.status <> 'pending') as has_church_admin,
    bool_or(cm.role = 'church_member' and cm.status <> 'pending') as has_church_member
  from public.church_memberships cm
  group by cm.user_id
),
regional_flags as (
  select
    rla.user_id,
    count(*) filter (
      where rla.status = 'active'
        and rla.role in ('regional_pastor', 'regional_collaborator')
    ) as regional_assignments_ok
  from public.region_leadership_assignments rla
  group by rla.user_id
),
booking_flags as (
  select
    lower(b.contact_email) as email,
    count(*) as bookings
  from public.cumbre_bookings b
  where b.contact_email is not null
  group by lower(b.contact_email)
)
select
  lower(t.email) as target_email,
  p.user_id,
  lower(p.email) as profile_email,
  p.role,
  p.country,
  p.church_id,
  p.portal_church_id,
  p.region_id,
  r.code as region_code,
  p.full_name,
  u.email_confirmed_at,
  u.last_sign_in_at,
  coalesce(mf.memberships_ok, 0) as memberships_ok,
  coalesce(mf.has_church_admin, false) as has_church_admin,
  coalesce(mf.has_church_member, false) as has_church_member,
  coalesce(rf.regional_assignments_ok, 0) as regional_assignments_ok,
  coalesce(bf.bookings, 0) as bookings
from targets t
left join public.user_profiles p on lower(p.email) = lower(t.email)
left join auth.users u on u.id = p.user_id
left join public.regions r on r.id = p.region_id
left join membership_flags mf on mf.user_id = p.user_id
left join regional_flags rf on rf.user_id = p.user_id
left join booking_flags bf on bf.email = lower(p.email)
order by lower(t.email);
