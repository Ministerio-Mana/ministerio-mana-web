-- Experiencia pública de eventos: contacto por WhatsApp y campos opcionales
-- del formulario de inscripción. Ejecutar después de los upgrades de eventos.
-- Idempotente y no destructivo; no altera Campus, Wompi, Stripe ni roles.

begin;

alter table public.events
  add column if not exists contact_whatsapp text,
  add column if not exists contact_whatsapp_message text,
  add column if not exists registration_form_config jsonb not null default '{"phone":"OPTIONAL","church":false,"whatsapp_updates":false}'::jsonb;

alter table public.event_registrations
  add column if not exists form_responses jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_registration_form_config_object_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_registration_form_config_object_check
      check (jsonb_typeof(registration_form_config) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'event_registrations_form_responses_object_check'
      and conrelid = 'public.event_registrations'::regclass
  ) then
    alter table public.event_registrations
      add constraint event_registrations_form_responses_object_check
      check (jsonb_typeof(form_responses) = 'object');
  end if;
end $$;

comment on column public.events.contact_whatsapp is
  'Número internacional de información del evento. La web genera el enlace wa.me de forma segura.';
comment on column public.events.registration_form_config is
  'Opciones simples del formulario público: teléfono, iglesia y consentimiento de recordatorios por WhatsApp.';
comment on column public.event_registrations.form_responses is
  'Respuestas opcionales autorizadas por la configuración del formulario del evento.';

commit;

select
  column_name,
  column_default,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'events'
  and column_name in ('contact_whatsapp', 'contact_whatsapp_message', 'registration_form_config')
order by column_name;
