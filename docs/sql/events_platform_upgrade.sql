-- Plataforma publica de eventos: paginas, visibilidad e inscripcion externa.
-- Guardado para ejecutar mas adelante en Supabase SQL Editor (produccion).
-- Idempotente: se puede ejecutar nuevamente sin duplicar columnas ni indices.
-- No borra eventos, pagos, inscripciones historicas ni usuarios.

begin;

alter table public.events
  add column if not exists slug text,
  add column if not exists visibility text not null default 'UNLISTED',
  add column if not exists category text,
  add column if not exists registration_mode text not null default 'NONE',
  add column if not exists registration_url text,
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists capacity integer,
  add column if not exists contact_email text,
  add column if not exists timezone text not null default 'America/Bogota',
  add column if not exists page_settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_visibility_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_visibility_check
      check (visibility in ('PUBLIC', 'UNLISTED', 'PRIVATE'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_registration_mode_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_registration_mode_check
      check (registration_mode in ('NONE', 'EXTERNAL', 'INTERNAL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_capacity_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_capacity_check
      check (capacity is null or capacity >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_registration_dates_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_registration_dates_check
      check (
        registration_opens_at is null
        or registration_closes_at is null
        or registration_closes_at >= registration_opens_at
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_page_settings_object_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_page_settings_object_check
      check (jsonb_typeof(page_settings) = 'object');
  end if;
end $$;

-- Mantiene los eventos existentes fuera del catalogo publico hasta que un gestor
-- decida publicarlos. El enlace directo por UUID sigue funcionando.
update public.events
set visibility = 'UNLISTED'
where visibility is null;

-- La Cumbre ya tenia una pagina publica conocida y se conserva en el archivo.
update public.events
set
  slug = 'cumbre-mundial-2026',
  visibility = 'PUBLIC',
  category = coalesce(category, 'Cumbre')
where id = '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202'::uuid;

-- Los demas reciben un slug estable y sin colisiones. Luego puede editarse.
update public.events
set slug = coalesce(
    nullif(trim(both '-' from lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
    'evento'
  )
  || '-' || left(id::text, 8)
where slug is null or btrim(slug) = '';

create unique index if not exists idx_events_slug_unique
  on public.events (lower(slug))
  where slug is not null;

create index if not exists idx_events_public_catalog
  on public.events (visibility, status, start_date desc);

create index if not exists idx_events_registration_window
  on public.events (registration_mode, registration_opens_at, registration_closes_at)
  where registration_mode <> 'NONE';

-- La pagina publica consulta desde el servidor. No se exponen escrituras ni datos
-- administrativos al navegador anonimo.
alter table public.events enable row level security;
revoke all on table public.events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.events from authenticated;
grant select on table public.events to authenticated;

commit;

-- Verificacion: debe devolver una fila por evento y ningun slug repetido.
select
  id,
  title,
  slug,
  visibility,
  registration_mode,
  status,
  start_date
from public.events
order by start_date desc;

select lower(slug) as duplicated_slug, count(*)
from public.events
where slug is not null
group by lower(slug)
having count(*) > 1;
