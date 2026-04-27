-- Bootstrap de perfiles faltantes desde Cumbre bookings
-- Fecha: 2026-02-18
-- Uso: ejecutar en Supabase SQL Editor (produccion) con rol admin.
-- Riesgo: BAJO/MEDIO (crea tabla de cola + upserts; update de bookings es OPCIONAL).
-- Objetivo:
-- 1) Detectar contactos de cumbre_bookings sin user_profile.
-- 2) Consolidarlos en una cola idempotente para activacion/invitacion.
-- 3) (Opcional) backfill de church_id en bookings portal-iglesia cuando la inferencia sea segura.

create extension if not exists "pgcrypto";

-- =========================================================
-- A) Cola canónica de bootstrap (idempotente)
-- =========================================================
create table if not exists public.portal_profile_bootstrap_queue (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  full_name text,
  phone text,
  document_type text,
  document_number text,
  country text,
  city text,
  church_name text,
  church_id uuid references public.churches(id),
  source text,
  first_seen timestamptz,
  last_seen timestamptz,
  bookings_count integer not null default 0,
  gross_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  profile_exists boolean not null default false,
  profile_user_id uuid,
  status text not null default 'pending', -- pending | invited | linked | ignored
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_bootstrap_queue_email_norm
  on public.portal_profile_bootstrap_queue(email_normalized);

create index if not exists idx_bootstrap_queue_status
  on public.portal_profile_bootstrap_queue(status, updated_at desc);

create index if not exists idx_bootstrap_queue_church
  on public.portal_profile_bootstrap_queue(church_id, status);

-- =========================================================
-- B) Preview: candidatos sin perfil (SOLO LECTURA)
-- =========================================================
with base as (
  select
    lower(trim(b.contact_email)) as email_normalized,
    b.contact_email,
    b.contact_name,
    b.contact_phone,
    b.contact_document_type,
    b.contact_document_number,
    b.contact_country,
    b.contact_city,
    b.contact_church,
    b.church_id,
    b.source,
    b.total_amount,
    b.total_paid,
    b.created_at
  from public.cumbre_bookings b
  where b.contact_email is not null
    and trim(b.contact_email) <> ''
    -- Si quieres excluir alias de pruebas tipo "usuario+test@dominio.com", descomenta:
    -- and split_part(lower(trim(b.contact_email)), '@', 1) not like '%+%'
),
agg as (
  select
    email_normalized,
    min(contact_email) as email,
    max(nullif(trim(contact_name), '')) as full_name,
    max(nullif(trim(contact_phone), '')) as phone,
    max(nullif(trim(contact_document_type), '')) as document_type,
    max(nullif(trim(contact_document_number), '')) as document_number,
    max(nullif(trim(contact_country), '')) as country,
    max(nullif(trim(contact_city), '')) as city,
    max(nullif(trim(contact_church), '')) as church_name,
    max(church_id::text)::uuid as direct_church_id,
    case
      when bool_or(coalesce(source, '') = 'portal-iglesia') then 'portal-iglesia'
      else coalesce(max(nullif(source, '')), 'cumbre')
    end as source,
    min(created_at) as first_seen,
    max(created_at) as last_seen,
    count(*)::int as bookings_count,
    coalesce(sum(coalesce(total_amount, 0)), 0)::numeric as gross_amount,
    coalesce(sum(coalesce(total_paid, 0)), 0)::numeric as paid_amount
  from base
  group by email_normalized
)
select
  a.email,
  a.full_name,
  a.country,
  a.city,
  a.church_name,
  a.bookings_count,
  a.gross_amount,
  a.paid_amount,
  a.first_seen,
  a.last_seen
from agg a
left join public.user_profiles p
  on lower(trim(p.email)) = a.email_normalized
where p.user_id is null
order by a.bookings_count desc, a.last_seen desc
limit 1000;

-- =========================================================
-- C) Carga/refresh de cola bootstrap (idempotente)
-- =========================================================
with base as (
  select
    lower(trim(b.contact_email)) as email_normalized,
    b.contact_email,
    b.contact_name,
    b.contact_phone,
    b.contact_document_type,
    b.contact_document_number,
    b.contact_country,
    b.contact_city,
    b.contact_church,
    b.church_id,
    b.source,
    b.total_amount,
    b.total_paid,
    b.created_at
  from public.cumbre_bookings b
  where b.contact_email is not null
    and trim(b.contact_email) <> ''
    -- Si quieres excluir alias de pruebas tipo "usuario+test@dominio.com", descomenta:
    -- and split_part(lower(trim(b.contact_email)), '@', 1) not like '%+%'
),
agg as (
  select
    email_normalized,
    min(contact_email) as email,
    max(nullif(trim(contact_name), '')) as full_name,
    max(nullif(trim(contact_phone), '')) as phone,
    max(nullif(trim(contact_document_type), '')) as document_type,
    max(nullif(trim(contact_document_number), '')) as document_number,
    max(nullif(trim(contact_country), '')) as country,
    max(nullif(trim(contact_city), '')) as city,
    max(nullif(trim(contact_church), '')) as church_name,
    max(church_id::text)::uuid as direct_church_id,
    case
      when bool_or(coalesce(source, '') = 'portal-iglesia') then 'portal-iglesia'
      else coalesce(max(nullif(source, '')), 'cumbre')
    end as source,
    min(created_at) as first_seen,
    max(created_at) as last_seen,
    count(*)::int as bookings_count,
    coalesce(sum(coalesce(total_amount, 0)), 0)::numeric as gross_amount,
    coalesce(sum(coalesce(total_paid, 0)), 0)::numeric as paid_amount
  from base
  group by email_normalized
),
churches_norm as (
  select
    c.id,
    lower(trim(coalesce(c.country, ''))) as country_key,
    lower(regexp_replace(coalesce(c.name, ''), '[^a-z0-9]+', '', 'g')) as church_key
  from public.churches c
),
church_unique_by_country as (
  select
    country_key,
    church_key,
    min(id::text)::uuid as church_id
  from churches_norm
  where church_key <> ''
  group by country_key, church_key
  having count(*) = 1
),
resolved as (
  select
    a.email,
    a.email_normalized,
    a.full_name,
    a.phone,
    a.document_type,
    a.document_number,
    a.country,
    a.city,
    a.church_name,
    coalesce(
      a.direct_church_id,
      cuc.church_id
    ) as resolved_church_id,
    a.source,
    a.first_seen,
    a.last_seen,
    a.bookings_count,
    a.gross_amount,
    a.paid_amount,
    p.user_id as existing_profile_user_id
  from agg a
  left join public.user_profiles p
    on lower(trim(p.email)) = a.email_normalized
  left join church_unique_by_country cuc
    on cuc.country_key = lower(trim(coalesce(a.country, '')))
   and cuc.church_key = lower(regexp_replace(coalesce(a.church_name, ''), '[^a-z0-9]+', '', 'g'))
)
insert into public.portal_profile_bootstrap_queue (
  email,
  email_normalized,
  full_name,
  phone,
  document_type,
  document_number,
  country,
  city,
  church_name,
  church_id,
  source,
  first_seen,
  last_seen,
  bookings_count,
  gross_amount,
  paid_amount,
  profile_exists,
  profile_user_id,
  status,
  updated_at
)
select
  r.email,
  r.email_normalized,
  r.full_name,
  r.phone,
  r.document_type,
  r.document_number,
  r.country,
  r.city,
  r.church_name,
  r.resolved_church_id,
  r.source,
  r.first_seen,
  r.last_seen,
  r.bookings_count,
  r.gross_amount,
  r.paid_amount,
  (r.existing_profile_user_id is not null) as profile_exists,
  r.existing_profile_user_id,
  case when r.existing_profile_user_id is not null then 'linked' else 'pending' end as status,
  now()
from resolved r
on conflict (email_normalized) do update
set
  email = excluded.email,
  full_name = coalesce(excluded.full_name, public.portal_profile_bootstrap_queue.full_name),
  phone = coalesce(excluded.phone, public.portal_profile_bootstrap_queue.phone),
  document_type = coalesce(excluded.document_type, public.portal_profile_bootstrap_queue.document_type),
  document_number = coalesce(excluded.document_number, public.portal_profile_bootstrap_queue.document_number),
  country = coalesce(excluded.country, public.portal_profile_bootstrap_queue.country),
  city = coalesce(excluded.city, public.portal_profile_bootstrap_queue.city),
  church_name = coalesce(excluded.church_name, public.portal_profile_bootstrap_queue.church_name),
  church_id = coalesce(excluded.church_id, public.portal_profile_bootstrap_queue.church_id),
  source = coalesce(excluded.source, public.portal_profile_bootstrap_queue.source),
  first_seen = least(public.portal_profile_bootstrap_queue.first_seen, excluded.first_seen),
  last_seen = greatest(public.portal_profile_bootstrap_queue.last_seen, excluded.last_seen),
  bookings_count = greatest(public.portal_profile_bootstrap_queue.bookings_count, excluded.bookings_count),
  gross_amount = excluded.gross_amount,
  paid_amount = excluded.paid_amount,
  profile_exists = excluded.profile_exists,
  profile_user_id = excluded.profile_user_id,
  status = case
    when excluded.profile_exists then 'linked'
    when public.portal_profile_bootstrap_queue.status = 'ignored' then 'ignored'
    else 'pending'
  end,
  updated_at = now();

-- =========================================================
-- D) Reconciliacion: marcar filas ya enlazadas a profile
-- =========================================================
update public.portal_profile_bootstrap_queue q
set
  profile_exists = true,
  profile_user_id = p.user_id,
  status = case when q.status = 'ignored' then 'ignored' else 'linked' end,
  updated_at = now()
from public.user_profiles p
where lower(trim(p.email)) = q.email_normalized
  and (
    q.profile_exists is distinct from true
    or q.profile_user_id is distinct from p.user_id
    or q.status <> 'linked'
  );

-- =========================================================
-- E) Reportes operativos de la cola
-- =========================================================

-- E1) Resumen por estado
select
  status,
  count(*) as total,
  sum(bookings_count) as bookings_total,
  sum(paid_amount) as paid_total
from public.portal_profile_bootstrap_queue
group by status
order by status;

-- E2) Pendientes de activacion (priorizar por monto/pagos)
select
  email,
  full_name,
  country,
  city,
  church_name,
  church_id,
  bookings_count,
  paid_amount,
  last_seen,
  status
from public.portal_profile_bootstrap_queue
where status = 'pending'
order by paid_amount desc, bookings_count desc, last_seen desc
limit 1000;

-- E3) Pendientes con bookings portal-iglesia y church_id aun nulo
select
  email,
  full_name,
  church_name,
  country,
  city,
  bookings_count,
  last_seen
from public.portal_profile_bootstrap_queue
where status = 'pending'
  and source = 'portal-iglesia'
  and church_id is null
order by last_seen desc;

-- =========================================================
-- F) OPCIONAL: backfill church_id en bookings portal-iglesia
-- =========================================================
-- Ejecuta SOLO despues de validar manualmente E3.
-- Esta parte si modifica historico de bookings.

-- update public.cumbre_bookings b
-- set
--   church_id = q.church_id,
--   updated_at = now()
-- from public.portal_profile_bootstrap_queue q
-- where q.status in ('pending', 'linked', 'invited')
--   and q.church_id is not null
--   and lower(trim(b.contact_email)) = q.email_normalized
--   and coalesce(b.source, '') = 'portal-iglesia'
--   and b.church_id is null;

-- Validacion F (solo lectura)
select
  count(*) as portal_iglesia_without_church_after
from public.cumbre_bookings b
where coalesce(b.source, '') = 'portal-iglesia'
  and b.church_id is null;
