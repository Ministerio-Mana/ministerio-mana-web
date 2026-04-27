-- Bootstrap no destructivo para RBAC regional
-- Fecha: 2026-02-18
-- Uso: ejecutar en Supabase SQL Editor (produccion) con rol admin.
-- Objetivo:
-- 1) Habilitar scope regional sin romper los roles actuales.
-- 2) Agregar estructura para asignar pastores/colaboradores regionales.
-- 3) Permitir scope regional real en eventos (events.region_id).

create extension if not exists "pgcrypto";

-- =========================================================
-- 0) Compatibilidad de scope REGIONAL en events.scope (enum)
-- =========================================================
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
-- 1) Catalogo de regiones por pais
-- =========================================================
create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_regions_country_code
  on public.regions(country, code);

create index if not exists idx_regions_country_name
  on public.regions(country, name);

-- =========================================================
-- 2) Scope regional en iglesias y perfiles (no destructivo)
-- =========================================================
alter table public.churches
  add column if not exists region_id uuid;

alter table public.user_profiles
  add column if not exists region_id uuid;

alter table public.events
  add column if not exists region_id uuid;

create index if not exists idx_churches_region_id
  on public.churches(region_id);

create index if not exists idx_user_profiles_region_id
  on public.user_profiles(region_id);

create index if not exists idx_events_region_id
  on public.events(region_id);

create index if not exists idx_events_scope_region
  on public.events(scope, region_id);

-- =========================================================
-- 3) Asignaciones explicitas de liderazgo regional
--    (permite uno o varios lideres por region)
-- =========================================================
create table if not exists public.region_leadership_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  region_id uuid not null,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_region_leadership_unique_active
  on public.region_leadership_assignments(user_id, region_id, role, status);

create index if not exists idx_region_leadership_region
  on public.region_leadership_assignments(region_id, status);

-- =========================================================
-- 4) Verificacion rapida
-- =========================================================
select
  p.role,
  count(*) as total_users,
  count(*) filter (where p.role in ('regional_pastor', 'regional_collaborator') and p.region_id is null) as regional_roles_without_region_id
from public.user_profiles p
group by p.role
order by total_users desc, p.role;

select
  c.country,
  count(*) filter (where c.region_id is null) as churches_without_region,
  count(*) as churches_total
from public.churches c
group by c.country
order by c.country;

select
  e.scope,
  count(*) as total_events,
  count(*) filter (where e.scope::text = 'REGIONAL' and e.region_id is null) as regional_events_without_region
from public.events e
group by e.scope
order by e.scope;
