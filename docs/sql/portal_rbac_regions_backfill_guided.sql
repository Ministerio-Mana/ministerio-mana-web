-- Backfill guiado para RBAC regional
-- Fecha: 2026-02-18
-- Uso: ejecutar en Supabase SQL Editor (produccion) con rol admin.
-- Riesgo: MEDIO (insert/update). No elimina historico.
--
-- Orden recomendado:
-- 1) Ejecuta secciones A-D (catalogo + iglesias + perfiles + assignments).
-- 2) Ejecuta seccion E (eventos) cuando A-D queden validadas.
-- 3) Ejecuta seccion F (smoke test) por cada regional_pastor.

-- =========================================================
-- P0) Preflight de columnas (idempotente, no destructivo)
-- =========================================================
alter table public.churches
  add column if not exists region_id uuid;

alter table public.user_profiles
  add column if not exists region_id uuid;

alter table public.events
  add column if not exists region_id uuid;

-- Enum compat: agrega REGIONAL si events.scope usa event_scope enum
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'event_scope'
      and n.nspname = 'public'
  ) then
    begin
      alter type public.event_scope add value if not exists 'REGIONAL';
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

-- =========================================================
-- A) Semilla de regiones por pais (EDITA estos VALUES)
-- =========================================================
with seed(country, code, name) as (
  values
    -- Colombia
    ('Colombia', 'CO-CAR', 'Caribe'),
    ('Colombia', 'CO-PAC', 'Pacifico'),
    ('Colombia', 'CO-CEN', 'Centro'),
    ('Colombia', 'CO-ANT', 'Antioquia'),
    ('Colombia', 'CO-OR', 'Oriente'),
    -- Ecuador
    ('Ecuador', 'EC-SIE', 'Sierra'),
    ('Ecuador', 'EC-COS', 'Costa'),
    ('Ecuador', 'EC-AMZ', 'Amazonia')
)
insert into public.regions (country, code, name, is_active)
select
  s.country,
  s.code,
  s.name,
  true
from seed s
on conflict (country, code) do update
set
  name = excluded.name,
  is_active = true,
  updated_at = now();

-- Validacion A1
select country, code, name, is_active
from public.regions
order by country, code;

-- =========================================================
-- B) Backfill iglesias -> region_id (EDITA los VALUES)
-- 1) Regla por ciudad
-- 2) Correccion manual por church_id (si aplica)
-- =========================================================

-- B1) Regla por ciudad
with city_map(country, city, region_code) as (
  values
    -- Colombia (ajusta si algun caso pertenece a otra region en tu operacion)
    ('Colombia', 'Cali', 'CO-PAC'),
    ('Colombia', 'Bogotá', 'CO-CEN'),
    ('Colombia', 'Bogota', 'CO-CEN'),
    ('Colombia', 'Armenia', 'CO-CEN'),
    ('Colombia', 'Bucaramanga', 'CO-OR'),
    ('Colombia', 'Buenaventura', 'CO-PAC'),
    ('Colombia', 'Cartago', 'CO-PAC'),
    ('Colombia', 'Ibagué', 'CO-CEN'),
    ('Colombia', 'Ibague', 'CO-CEN'),
    ('Colombia', 'La Unión (Valle)', 'CO-PAC'),
    ('Colombia', 'La Union (Valle)', 'CO-PAC'),
    ('Colombia', 'Manizales', 'CO-CEN'),
    ('Colombia', 'Marinilla', 'CO-ANT'),
    ('Colombia', 'Medellín', 'CO-ANT'),
    ('Colombia', 'Medellin', 'CO-ANT'),
    ('Colombia', 'Medellín / Itagüí', 'CO-ANT'),
    ('Colombia', 'Medellin / Itagui', 'CO-ANT'),
    ('Colombia', 'Pasto', 'CO-PAC'),
    ('Colombia', 'Pereira', 'CO-CEN'),
    ('Colombia', 'Tuluá', 'CO-PAC'),
    ('Colombia', 'Tulua', 'CO-PAC'),
    ('Colombia', 'Barranquilla', 'CO-CAR'),
    ('Colombia', 'Cartagena', 'CO-CAR'),
    -- Ecuador
    ('Ecuador', 'Quito', 'EC-SIE'),
    ('Ecuador', 'Guayaquil', 'EC-COS'),
    ('Ecuador', 'Guayaquil (Norte)', 'EC-COS'),
    ('Ecuador', 'Guayaquil (Sur)', 'EC-COS'),
    ('Ecuador', 'Cuenca', 'EC-SIE')
),
resolved as (
  select
    c.id as church_id,
    r.id as region_id
  from public.churches c
  join city_map m
    on lower(trim(c.country)) = lower(trim(m.country))
   and lower(trim(c.city)) = lower(trim(m.city))
  join public.regions r
    on lower(trim(r.country)) = lower(trim(m.country))
   and r.code = m.region_code
)
update public.churches c
set
  region_id = x.region_id
from resolved x
where c.id = x.church_id
  and coalesce(c.region_id::text, '') <> coalesce(x.region_id::text, '');

-- B2) Correccion manual por ID (deja vacio si no aplica)
with manual(church_id, region_code) as (
  values
    -- ('00000000-0000-0000-0000-000000000000', 'CO-PAC')
    (null::uuid, null::text)
),
resolved as (
  select
    m.church_id,
    r.id as region_id
  from manual m
  join public.churches c on c.id = m.church_id
  join public.regions r
    on lower(trim(r.country)) = lower(trim(c.country))
   and r.code = m.region_code
  where m.church_id is not null
)
update public.churches c
set
  region_id = x.region_id
from resolved x
where c.id = x.church_id
  and coalesce(c.region_id::text, '') <> coalesce(x.region_id::text, '');

-- Validacion B
select
  country,
  count(*) as churches_total,
  count(*) filter (where region_id is null) as churches_without_region,
  count(*) filter (where region_id is not null) as churches_with_region
from public.churches
group by country
order by country;

select
  c.id,
  c.name,
  c.city,
  c.country,
  c.region_id,
  r.code as region_code,
  r.name as region_name
from public.churches c
left join public.regions r on r.id = c.region_id
order by c.country, c.city, c.name
limit 500;

-- =========================================================
-- C) Backfill perfiles regionales -> region_id
-- =========================================================
update public.user_profiles p
set
  region_id = c.region_id,
  country = coalesce(nullif(p.country, ''), c.country),
  updated_at = now()
from public.churches c
where p.role in ('regional_pastor', 'regional_collaborator')
  and p.region_id is null
  and c.id = coalesce(p.church_id, p.portal_church_id)
  and c.region_id is not null;

-- Validacion C
select
  p.role,
  count(*) as total,
  count(*) filter (where p.region_id is null) as without_region
from public.user_profiles p
where p.role in ('regional_pastor', 'regional_collaborator')
group by p.role
order by p.role;

-- =========================================================
-- D) Asignaciones regionales (region_leadership_assignments)
-- 1) Sincroniza desde perfiles regionales existentes.
-- 2) Inserta manualmente por email si necesitas.
-- =========================================================

-- D1) Sync desde perfiles
insert into public.region_leadership_assignments (
  user_id,
  region_id,
  role,
  status
)
select
  p.user_id,
  p.region_id,
  p.role,
  'active'
from public.user_profiles p
where p.role in ('regional_pastor', 'regional_collaborator')
  and p.region_id is not null
on conflict (user_id, region_id, role, status) do nothing;

-- D2) Manual por email (EDITA y descomenta filas)
with manual(email, region_code, role) as (
  values
    -- ('julian@example.com', 'CO-PAC', 'regional_pastor'),
    -- ('colaborador@example.com', 'CO-PAC', 'regional_collaborator')
    (null::text, null::text, null::text)
),
resolved as (
  select
    p.user_id,
    p.email,
    r.id as region_id,
    m.role,
    r.country
  from manual m
  join public.user_profiles p on lower(p.email) = lower(m.email)
  join public.regions r on r.code = m.region_code
  where m.email is not null
)
insert into public.region_leadership_assignments (user_id, region_id, role, status)
select user_id, region_id, role, 'active'
from resolved
on conflict (user_id, region_id, role, status) do nothing;

-- D3) Para perfiles con una sola region activa, sincroniza region_id en user_profiles
with one_region as (
  select
    rla.user_id,
    min(rla.region_id::text)::uuid as region_id
  from public.region_leadership_assignments rla
  where rla.status = 'active'
    and rla.role in ('regional_pastor', 'regional_collaborator')
  group by rla.user_id
  having count(distinct rla.region_id) = 1
)
update public.user_profiles p
set
  region_id = o.region_id,
  country = coalesce(nullif(p.country, ''), r.country),
  updated_at = now()
from one_region o
join public.regions r on r.id = o.region_id
where p.user_id = o.user_id
  and p.role in ('regional_pastor', 'regional_collaborator')
  and coalesce(p.region_id::text, '') <> coalesce(o.region_id::text, '');

-- Validacion D
select
  lower(p.email) as email,
  p.role,
  p.country,
  p.region_id,
  r.code as region_code,
  r.name as region_name
from public.user_profiles p
left join public.regions r on r.id = p.region_id
where p.role in ('regional_pastor', 'regional_collaborator')
order by p.role, email;

select
  lower(p.email) as email,
  rla.role,
  rla.status,
  r.code as region_code,
  r.name as region_name,
  r.country
from public.region_leadership_assignments rla
join public.user_profiles p on p.user_id = rla.user_id
join public.regions r on r.id = rla.region_id
where rla.status = 'active'
order by email, rla.role, r.code;

-- =========================================================
-- E) Backfill eventos -> region_id (recomendado)
-- =========================================================

-- E0) Garantiza columna regional en events (idempotente)
alter table public.events
  add column if not exists region_id uuid;

-- E1) Eventos LOCAL heredan region de su church_id
update public.events e
set
  region_id = c.region_id,
  country = coalesce(nullif(e.country, ''), c.country)
from public.churches c
where e.scope = 'LOCAL'
  and e.church_id = c.id
  and c.region_id is not null
  and (e.region_id is null or e.region_id <> c.region_id);

-- E2) Eventos REGIONAL sin region_id heredan del creador si el creador tiene region unica
with creator_region as (
  select
    p.user_id,
    p.region_id
  from public.user_profiles p
  where p.region_id is not null
)
update public.events e
set
  region_id = cr.region_id,
  country = coalesce(nullif(e.country, ''), p.country)
from creator_region cr
join public.user_profiles p on p.user_id = cr.user_id
where e.scope::text = 'REGIONAL'
  and e.created_by = cr.user_id
  and e.region_id is null;

-- Validacion E
select
  e.scope,
  count(*) as total_events,
  count(*) filter (where e.scope::text = 'REGIONAL' and e.region_id is null) as regional_without_region,
  count(*) filter (where e.scope::text = 'LOCAL' and e.church_id is not null and e.region_id is null) as local_without_region
from public.events e
group by e.scope
order by e.scope;

-- =========================================================
-- F) Smoke test para regional_pastor (EDITA email objetivo)
-- =========================================================
-- IMPORTANTE: usa el mismo email en F1 y F2.

with target as (
  select lower('julian@example.com') as email
),
actor as (
  select
    p.user_id,
    lower(p.email) as email,
    p.role,
    p.country,
    p.region_id
  from public.user_profiles p
  join target t on lower(p.email) = t.email
),
scope_regions as (
  select distinct coalesce(rla.region_id, a.region_id) as region_id
  from actor a
  left join public.region_leadership_assignments rla
    on rla.user_id = a.user_id
   and rla.status = 'active'
   and rla.role in ('regional_pastor', 'regional_collaborator')
  where coalesce(rla.region_id, a.region_id) is not null
)
select
  a.email as actor_email,
  a.role as actor_role,
  r.code as region_code,
  r.name as region_name,
  c.id as church_id,
  c.name as church_name,
  c.city,
  c.country
from actor a
join scope_regions sr on true
join public.regions r on r.id = sr.region_id
join public.churches c on c.region_id = sr.region_id
order by r.code, c.city, c.name;

-- F2) Verifica que no haya iglesias fuera del scope en la misma consulta de control
with target as (
  select lower('julian@example.com') as email
),
actor as (
  select p.user_id, p.country
  from public.user_profiles p
  join target t on lower(p.email) = t.email
),
scope_regions as (
  select distinct rla.region_id
  from actor a
  join public.region_leadership_assignments rla
    on rla.user_id = a.user_id
   and rla.status = 'active'
   and rla.role in ('regional_pastor', 'regional_collaborator')
)
select
  count(*) as churches_in_actor_country_outside_region_scope
from actor a
join public.churches c
  on lower(trim(c.country)) = lower(trim(a.country))
where c.region_id is not null
  and c.region_id not in (select region_id from scope_regions);
