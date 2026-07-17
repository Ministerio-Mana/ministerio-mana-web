-- Gestión jerárquica del directorio de iglesias y grupos Maná.
-- Fecha: 2026-07-16.
-- Ejecutar una vez en Supabase SQL Editor con rol postgres/admin.
-- Es aditivo: conserva iglesias, páginas, eventos, membresías y roles actuales.

create extension if not exists pgcrypto;

alter table public.churches
  add column if not exists kind text not null default 'CHURCH',
  add column if not exists lifecycle_status text not null default 'ACTIVE',
  add column if not exists is_public boolean not null default true,
  add column if not exists show_on_map boolean not null default true,
  add column if not exists service text,
  add column if not exists notes text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Las filas históricas continúan visibles. Las nuevas se crean como borrador desde la API.
update public.churches
set
  kind = coalesce(nullif(btrim(kind), ''), 'CHURCH'),
  lifecycle_status = coalesce(nullif(btrim(lifecycle_status), ''), 'ACTIVE'),
  version = greatest(coalesce(version, 1), 1),
  is_public = coalesce(is_public, true),
  show_on_map = coalesce(show_on_map, true);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'churches_kind_check'
  ) then
    alter table public.churches
      add constraint churches_kind_check check (kind in ('CHURCH', 'GROUP'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'churches_lifecycle_status_check'
  ) then
    alter table public.churches
      add constraint churches_lifecycle_status_check check (lifecycle_status in ('DRAFT', 'ACTIVE', 'INACTIVE'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'churches_version_check'
  ) then
    alter table public.churches
      add constraint churches_version_check check (version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'churches_coordinates_check'
  ) then
    alter table public.churches
      add constraint churches_coordinates_check check (
        (lat is null and lng is null)
        or (lat between -90 and 90 and lng between -180 and 180)
      );
  end if;
end $$;

create index if not exists churches_directory_visibility_idx
  on public.churches(lifecycle_status, is_public, show_on_map);

create index if not exists churches_directory_scope_idx
  on public.churches(country, region_id, city);

create table if not exists public.church_directory_audit_logs (
  id bigint generated always as identity primary key,
  church_id uuid not null references public.churches(id) on delete cascade,
  action text not null,
  previous_snapshot jsonb,
  next_snapshot jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  request_ip text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists church_directory_audit_church_idx
  on public.church_directory_audit_logs(church_id, created_at desc);

alter table public.church_directory_audit_logs enable row level security;
revoke all on table public.church_directory_audit_logs from anon, authenticated;
grant all on table public.church_directory_audit_logs to service_role;
grant usage, select on sequence public.church_directory_audit_logs_id_seq to service_role;

select
  to_regclass('public.churches') as churches_table,
  to_regclass('public.church_directory_audit_logs') as audit_table,
  count(*) filter (where lifecycle_status = 'ACTIVE' and is_public) as public_active_churches
from public.churches;
