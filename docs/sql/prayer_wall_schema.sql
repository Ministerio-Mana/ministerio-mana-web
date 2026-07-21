-- Prayer Wall / Peticiones
-- Ejecutar en Supabase SQL Editor de produccion con rol admin/postgres.

create extension if not exists "pgcrypto";

create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  request_text text not null,
  city text,
  country text,
  prayers_count integer not null default 0,
  approved boolean not null default false,
  visibility text not null default 'private',
  moderation_status text not null default 'private',
  flagged boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  admin_note text,
  ai_consent boolean not null default false,
  ai_consent_at timestamptz,
  ai_status text not null default 'not_run',
  ai_recommendation text,
  ai_reason_codes text[] not null default '{}',
  ai_model text,
  ai_policy_version text,
  ai_reviewed_at timestamptz,
  ai_urgent_pastoral_review boolean not null default false,
  ai_auto_approved boolean not null default false,
  ai_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prayer_requests
  add column if not exists visibility text not null default 'private',
  add column if not exists moderation_status text not null default 'private',
  add column if not exists flagged boolean not null default false,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists admin_note text,
  add column if not exists ai_consent boolean not null default false,
  add column if not exists ai_consent_at timestamptz,
  add column if not exists ai_status text not null default 'not_run',
  add column if not exists ai_recommendation text,
  add column if not exists ai_reason_codes text[] not null default '{}',
  add column if not exists ai_model text,
  add column if not exists ai_policy_version text,
  add column if not exists ai_reviewed_at timestamptz,
  add column if not exists ai_urgent_pastoral_review boolean not null default false,
  add column if not exists ai_auto_approved boolean not null default false,
  add column if not exists ai_error_code text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.prayer_requests drop constraint if exists prayer_requests_ai_status_check;
alter table public.prayer_requests add constraint prayer_requests_ai_status_check
  check (ai_status in ('not_run', 'safe', 'review', 'error'));
alter table public.prayer_requests drop constraint if exists prayer_requests_ai_recommendation_check;
alter table public.prayer_requests add constraint prayer_requests_ai_recommendation_check
  check (ai_recommendation is null or ai_recommendation in ('approve', 'review'));

create index if not exists prayer_requests_public_wall_idx
  on public.prayer_requests(created_at desc)
  where approved = true
    and visibility = 'public'
    and moderation_status = 'approved';

create index if not exists prayer_requests_admin_status_idx
  on public.prayer_requests(moderation_status, visibility, created_at desc);

create index if not exists prayer_requests_ai_review_idx
  on public.prayer_requests(ai_status, ai_recommendation, created_at desc)
  where visibility = 'public' and ai_consent = true;

comment on column public.prayer_requests.ai_reason_codes is
  'Códigos controlados de auditoría; nunca guardar prompts ni respuestas completas del proveedor.';

alter table public.prayer_requests enable row level security;

revoke all on table public.prayer_requests from anon, authenticated;
grant all on table public.prayer_requests to service_role;

drop policy if exists service_role_all_prayer_requests on public.prayer_requests;
create policy service_role_all_prayer_requests
  on public.prayer_requests
  for all
  to service_role
  using (true)
  with check (true);

-- Rol de intercesion en el portal:
-- update public.user_profiles set role = 'intercessor' where lower(email) = lower('persona@dominio.com');
