-- CMS base para Portal de Contenidos (Sitio Publico)
-- Ejecutar en Supabase SQL Editor (produccion) con rol admin/postgres.

create extension if not exists pgcrypto;

create table if not exists public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique,
  route_path text not null unique,
  locale text not null default 'es',
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1,
  seo jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists cms_pages_status_idx on public.cms_pages(status);
create index if not exists cms_pages_locale_idx on public.cms_pages(locale);

create table if not exists public.cms_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  section_key text not null,
  kind text not null,
  title text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  position integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(page_id, section_key)
);

create index if not exists cms_sections_page_idx on public.cms_sections(page_id, position);
create index if not exists cms_sections_status_idx on public.cms_sections(status);

create table if not exists public.cms_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('page', 'section')),
  entity_id uuid not null,
  page_id uuid references public.cms_pages(id) on delete cascade,
  action text not null check (action in ('create', 'update', 'publish', 'unpublish', 'delete', 'reorder')),
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cms_revisions_entity_idx on public.cms_revisions(entity_type, entity_id, created_at desc);
create index if not exists cms_revisions_page_idx on public.cms_revisions(page_id, created_at desc);

create table if not exists public.cms_audit_logs (
  id bigint generated always as identity primary key,
  module text not null default 'cms',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  page_id uuid references public.cms_pages(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id),
  actor_email text,
  request_ip text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cms_audit_logs_created_idx on public.cms_audit_logs(created_at desc);
create index if not exists cms_audit_logs_page_idx on public.cms_audit_logs(page_id, created_at desc);

create table if not exists public.cms_media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'cms-media',
  path text not null unique,
  public_url text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  tags text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists cms_media_created_idx on public.cms_media(created_at desc);
create index if not exists cms_media_tags_idx on public.cms_media using gin(tags);

alter table public.cms_pages enable row level security;
alter table public.cms_sections enable row level security;
alter table public.cms_revisions enable row level security;
alter table public.cms_audit_logs enable row level security;
alter table public.cms_media enable row level security;

-- Nota: la app usa service_role en backend para operaciones CMS,
-- pero mantenemos politicas defensivas para consultas autenticadas de admins.

drop policy if exists cms_pages_admin_read on public.cms_pages;
create policy cms_pages_admin_read
on public.cms_pages for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_pages_admin_write on public.cms_pages;
create policy cms_pages_admin_write
on public.cms_pages for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_sections_admin_read on public.cms_sections;
create policy cms_sections_admin_read
on public.cms_sections for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_sections_admin_write on public.cms_sections;
create policy cms_sections_admin_write
on public.cms_sections for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_revisions_admin_read on public.cms_revisions;
create policy cms_revisions_admin_read
on public.cms_revisions for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_audit_logs_admin_read on public.cms_audit_logs;
create policy cms_audit_logs_admin_read
on public.cms_audit_logs for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_media_admin_read on public.cms_media;
create policy cms_media_admin_read
on public.cms_media for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

drop policy if exists cms_media_admin_write on public.cms_media;
create policy cms_media_admin_write
on public.cms_media for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.user_id = auth.uid()
      and p.role in ('admin', 'superadmin')
  )
);

insert into public.cms_pages (page_key, route_path, locale, title, description, status)
values
  ('home', '/', 'es', 'Inicio', 'Pagina principal del sitio', 'draft'),
  ('eventos', '/eventos', 'es', 'Eventos', 'Listado principal de eventos', 'draft'),
  ('noticias', '/noticias', 'es', 'Noticias', 'Listado principal de noticias', 'draft')
on conflict (page_key) do nothing;
