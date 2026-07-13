-- Contrato canónico de zona horaria y modalidad de eventos.
-- Ejecutar después de events_platform_upgrade.sql y events_finance_schema.sql.
-- Idempotente: normaliza etiquetas históricas antes de fijar las restricciones.

begin;

alter table public.events drop constraint if exists events_timezone_check;
alter table public.events drop constraint if exists events_attendance_mode_check;

update public.events as event
set timezone = case
  when normalized.key in ('AMERICABOGOTA', 'BOGOTA', 'COLOMBIABOGOTA') then 'America/Bogota'
  when normalized.key in ('AMERICAGUAYAQUIL', 'ECUADORGUAYAQUIL') then 'America/Guayaquil'
  when normalized.key in ('AMERICAMEXICOCITY', 'MEXICOCIUDADDEMEXICO') then 'America/Mexico_City'
  when normalized.key in ('AMERICAPANAMA', 'CENTROAMERICAPANAMA') then 'America/Panama'
  when normalized.key in ('AMERICANEWYORK', 'ESTADOSUNIDOSESTE') then 'America/New_York'
  when normalized.key in ('AMERICACHICAGO', 'ESTADOSUNIDOSCENTRO') then 'America/Chicago'
  when normalized.key in ('AMERICADENVER', 'ESTADOSUNIDOSMONTANA') then 'America/Denver'
  when normalized.key in ('AMERICALOSANGELES', 'ESTADOSUNIDOSPACIFICO') then 'America/Los_Angeles'
  when normalized.key in ('EUROPEMADRID', 'EUROPAMADRID') then 'Europe/Madrid'
  when normalized.key in ('EUROPEPARIS', 'EUROPAPARIS') then 'Europe/Paris'
  when normalized.key in ('AUSTRALIASYDNEY', 'AUSTRALIASIDNEY') then 'Australia/Sydney'
  when normalized.key = 'UTC' then 'UTC'
  else timezone
end
from (
  select id, regexp_replace(
    translate(upper(timezone), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]', '', 'g'
  ) as key
  from public.events
  where timezone is not null
) as normalized
where event.id = normalized.id;

update public.events as event
set attendance_mode = case
  when normalized.key in ('INPERSON', 'ONSITE', 'PRESENCIAL', 'PRESENTIAL') then 'IN_PERSON'
  when normalized.key in ('ONLINE', 'VIRTUAL') then 'ONLINE'
  when normalized.key in ('HYBRID', 'HIBRIDO') then 'HYBRID'
  else attendance_mode
end
from (
  select id, regexp_replace(
    translate(upper(attendance_mode), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]', '', 'g'
  ) as key
  from public.events
  where attendance_mode is not null
) as normalized
where event.id = normalized.id;

alter table public.events add constraint events_timezone_check check (
  timezone in (
    'America/Bogota', 'America/Guayaquil', 'America/Mexico_City', 'America/Panama',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/Madrid', 'Europe/Paris', 'Australia/Sydney', 'UTC'
  )
) not valid;

alter table public.events add constraint events_attendance_mode_check check (
  attendance_mode in ('IN_PERSON', 'ONLINE', 'HYBRID')
) not valid;

do $$
begin
  if not exists (
    select 1 from public.events
    where timezone not in (
        'America/Bogota', 'America/Guayaquil', 'America/Mexico_City', 'America/Panama',
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'Europe/Madrid', 'Europe/Paris', 'Australia/Sydney', 'UTC'
      )
      or attendance_mode not in ('IN_PERSON', 'ONLINE', 'HYBRID')
  ) then
    alter table public.events validate constraint events_timezone_check;
    alter table public.events validate constraint events_attendance_mode_check;
  else
    raise notice 'Hay eventos con timezone o attendance_mode fuera del contrato; revisa la consulta final.';
  end if;
end $$;

commit;

select id, title, timezone, attendance_mode
from public.events
where timezone not in (
    'America/Bogota', 'America/Guayaquil', 'America/Mexico_City', 'America/Panama',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/Madrid', 'Europe/Paris', 'Australia/Sydney', 'UTC'
  )
  or attendance_mode not in ('IN_PERSON', 'ONLINE', 'HYBRID');
