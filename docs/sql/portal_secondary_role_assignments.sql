-- Roles secundarios del Portal Mana.
--
-- Caso actual:
-- - Una persona conserva su rol principal (por ejemplo pastor)
-- - Y recibe acceso adicional a Peticiones con rol secundario intercessor.
--
-- Ejecutar una vez en Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.portal_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  scope_type text not null default 'global',
  scope_id uuid,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint portal_role_assignments_role_check
    check (role in ('intercessor')),
  constraint portal_role_assignments_scope_type_check
    check (scope_type in ('global', 'country', 'region', 'church', 'campus')),
  constraint portal_role_assignments_status_check
    check (status in ('active', 'inactive'))
);

create unique index if not exists idx_portal_role_assignments_unique_active
  on public.portal_role_assignments(
    user_id,
    role,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

create index if not exists idx_portal_role_assignments_user_status
  on public.portal_role_assignments(user_id, status);

alter table public.portal_role_assignments enable row level security;

revoke all on table public.portal_role_assignments from anon, authenticated;
grant all on table public.portal_role_assignments to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'portal_role_assignments'
      and policyname = 'service_role_all_portal_role_assignments'
  ) then
    create policy service_role_all_portal_role_assignments
      on public.portal_role_assignments
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- Ejemplo: dar acceso de intercesion a una pastora sin cambiar su rol pastor.
-- Cambia el correo por el real.
--
-- insert into public.portal_role_assignments (user_id, role, scope_type, status)
-- select p.user_id, 'intercessor', 'global', 'active'
-- from public.user_profiles p
-- where lower(p.email) = lower('pastora@dominio.com')
--   and not exists (
--     select 1
--     from public.portal_role_assignments a
--     where a.user_id = p.user_id
--       and a.role = 'intercessor'
--       and a.scope_type = 'global'
--       and a.status = 'active'
--   );

-- Diagnostico:
-- select
--   p.email,
--   p.full_name,
--   p.role as rol_principal,
--   a.role as rol_secundario,
--   a.scope_type,
--   a.status,
--   a.created_at
-- from public.portal_role_assignments a
-- join public.user_profiles p on p.user_id = a.user_id
-- order by a.created_at desc;
