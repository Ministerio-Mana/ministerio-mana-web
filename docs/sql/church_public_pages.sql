-- Paginas publicas editables por iglesia
-- Ejecutar una sola vez en Supabase SQL Editor con rol admin/postgres.
-- No modifica eventos, pagos, donaciones, Campus ni membresias existentes.

create extension if not exists pgcrypto;

create table if not exists public.church_public_pages (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null unique references public.churches(id) on delete cascade,
  slug text not null unique,
  status text not null default 'DRAFT',
  template text not null default 'ESSENTIAL',
  display_name text not null,
  tagline text,
  description text,
  hero_image_url text,
  hero_image_alt text,
  pastor_name text,
  pastor_title text,
  pastor_image_url text,
  pastor_image_alt text,
  service_schedule text,
  contact_whatsapp text,
  contact_whatsapp_message text,
  contact_email text,
  story_config jsonb not null default '{"preset":"editorial","theme":"navy","scenes":[]}'::jsonb,
  gallery jsonb not null default '[]'::jsonb,
  published_snapshot jsonb,
  version integer not null default 1,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint church_public_pages_slug_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 160),
  constraint church_public_pages_status_check
    check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  constraint church_public_pages_template_check
    check (template in ('ESSENTIAL', 'STORY', 'MOSAIC')),
  constraint church_public_pages_version_check
    check (version > 0),
  constraint church_public_pages_story_object_check
    check (jsonb_typeof(story_config) = 'object'),
  constraint church_public_pages_gallery_array_check
    check (jsonb_typeof(gallery) = 'array'),
  constraint church_public_pages_snapshot_object_check
    check (published_snapshot is null or jsonb_typeof(published_snapshot) = 'object')
);

create index if not exists church_public_pages_status_idx
  on public.church_public_pages(status, published_at desc);

create index if not exists church_public_pages_updated_idx
  on public.church_public_pages(updated_at desc);

create table if not exists public.church_public_page_audit_logs (
  id bigint generated always as identity primary key,
  church_id uuid not null references public.churches(id) on delete cascade,
  page_id uuid references public.church_public_pages(id) on delete set null,
  action text not null,
  previous_snapshot jsonb,
  next_snapshot jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  request_ip text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists church_public_page_audit_church_idx
  on public.church_public_page_audit_logs(church_id, created_at desc);

alter table public.church_public_pages enable row level security;
alter table public.church_public_page_audit_logs enable row level security;

-- La lectura publica pasa por una ruta server-side que entrega solo paginas
-- publicadas y campos aprobados. Las escrituras pasan por APIs con service_role
-- despues de comprobar el alcance local, regional, nacional o administrativo.
revoke all on table public.church_public_pages from anon, authenticated;
revoke all on table public.church_public_page_audit_logs from anon, authenticated;

grant all on table public.church_public_pages to service_role;
grant all on table public.church_public_page_audit_logs to service_role;

select
  to_regclass('public.church_public_pages') as pages_table,
  to_regclass('public.church_public_page_audit_logs') as audit_table;
