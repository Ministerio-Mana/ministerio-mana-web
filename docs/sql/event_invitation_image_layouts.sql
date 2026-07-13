-- Portal Maná: plantillas automáticas de invitación según orientación de la foto.
-- Ejecutar después de event_invitation_images_sharepoint.sql.

alter table public.events
  add column if not exists banner_layout text;

update public.events
set banner_layout = 'HORIZONTAL'
where banner_layout is null or banner_layout not in ('HORIZONTAL', 'SQUARE', 'VERTICAL');

alter table public.events
  alter column banner_layout set default 'HORIZONTAL',
  alter column banner_layout set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass and conname = 'events_banner_layout_check'
  ) then
    alter table public.events add constraint events_banner_layout_check
      check (banner_layout in ('HORIZONTAL', 'SQUARE', 'VERTICAL'));
  end if;
end $$;

alter table public.event_invitation_images
  add column if not exists layout text;

update public.event_invitation_images
set layout = 'HORIZONTAL'
where layout is null or layout not in ('HORIZONTAL', 'SQUARE', 'VERTICAL');

alter table public.event_invitation_images
  alter column layout set default 'HORIZONTAL',
  alter column layout set not null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.event_invitation_images'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) like '%width = 1600%'
        or pg_get_constraintdef(oid) like '%height = 900%'
      )
  loop
    execute format('alter table public.event_invitation_images drop constraint %I', constraint_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_invitation_images'::regclass and conname = 'event_invitation_images_layout_check'
  ) then
    alter table public.event_invitation_images add constraint event_invitation_images_layout_check
      check (layout in ('HORIZONTAL', 'SQUARE', 'VERTICAL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.event_invitation_images'::regclass and conname = 'event_invitation_images_dimensions_check'
  ) then
    alter table public.event_invitation_images add constraint event_invitation_images_dimensions_check
      check (
        (layout = 'HORIZONTAL' and width between 640 and 1600 and height between 480 and 1200)
        or (layout = 'SQUARE' and width between 480 and 1200 and height between 480 and 1200)
        or (layout = 'VERTICAL' and width between 480 and 1080 and height between 640 and 1350)
      );
  end if;
end $$;

select
  column_name,
  column_default,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('events', 'event_invitation_images')
  and column_name in ('banner_layout', 'layout');
