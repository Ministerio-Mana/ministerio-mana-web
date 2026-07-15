-- Asistentes e identificación financiera estructurada para eventos.
-- Ejecutar una sola vez después del esquema base de eventos.
-- Idempotente: no modifica pagos existentes, Wompi, Stripe, Campus ni roles.

begin;

alter table public.events
  add column if not exists registration_form_config jsonb not null default
  '{"phone":"OPTIONAL","church":false,"whatsapp_updates":false,"attendee_age":"HIDDEN","attendee_gender":"HIDDEN","payer_document":"REQUIRED","fields":[]}'::jsonb;

alter table public.events
  alter column registration_form_config set default
  '{"phone":"OPTIONAL","church":false,"whatsapp_updates":false,"attendee_age":"HIDDEN","attendee_gender":"HIDDEN","payer_document":"REQUIRED","fields":[]}'::jsonb;

create table if not exists public.event_registration_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  position integer not null check (position between 1 and 100),
  full_name text not null check (char_length(btrim(full_name)) between 3 and 120),
  age_group text check (age_group is null or age_group in ('0_5', '6_12', '13_17', '18_25', '26_59', '60_PLUS')),
  gender text check (gender is null or gender in ('FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, position),
  foreign key (event_id, registration_id)
    references public.event_registrations(event_id, id) on delete cascade
);

create table if not exists public.event_registration_payers (
  registration_id uuid primary key references public.event_registrations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  is_contact boolean not null default true,
  person_type text not null check (person_type in ('NATURAL', 'LEGAL')),
  document_type text check (document_type is null or document_type in ('CC', 'CE', 'PPT', 'PASSPORT', 'NIT', 'FOREIGN_ID', 'OTHER')),
  document_number text check (document_number is null or char_length(document_number) between 3 and 40),
  document_last4 text generated always as (right(coalesce(document_number, ''), 4)) stored,
  document_country text not null check (char_length(btrim(document_country)) between 2 and 80),
  legal_name text not null check (char_length(btrim(legal_name)) between 3 and 160),
  billing_email text not null check (char_length(btrim(billing_email)) between 5 and 254),
  tax_document_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, registration_id)
    references public.event_registrations(event_id, id) on delete cascade,
  check ((document_type is null) = (document_number is null))
);

create index if not exists idx_event_registration_attendees_event
  on public.event_registration_attendees(event_id, registration_id, position);
create index if not exists idx_event_registration_payers_event
  on public.event_registration_payers(event_id, created_at desc);

alter table public.event_registration_attendees enable row level security;
alter table public.event_registration_payers enable row level security;
revoke all on table public.event_registration_attendees from public, anon, authenticated;
revoke all on table public.event_registration_payers from public, anon, authenticated;
grant all on table public.event_registration_attendees to service_role;
grant all on table public.event_registration_payers to service_role;

comment on table public.event_registration_attendees is
  'Una fila por cupo. Los nombres permiten operación y check-in sin confundir cantidad con personas.';
comment on table public.event_registration_payers is
  'Identificación privada del pagador para conciliación, factura o certificado cuando aplique.';
comment on column public.event_registration_payers.document_number is
  'Dato privado. Nunca debe enviarse a URLs, logs públicos ni respuestas para roles sin alcance financiero.';

create or replace function public.save_event_registration_people_secure(
  p_event_id uuid,
  p_registration_id uuid,
  p_payer jsonb,
  p_attendees jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quantity integer;
  v_attendee jsonb;
  v_position integer;
  v_full_name text;
  v_age_group text;
  v_gender text;
begin
  select er.quantity
    into v_quantity
  from public.event_registrations er
  where er.id = p_registration_id
    and er.event_id = p_event_id
  for update;

  if v_quantity is null then
    raise exception 'REGISTRATION_NOT_FOUND';
  end if;
  if jsonb_typeof(p_attendees) <> 'array'
    or jsonb_array_length(p_attendees) <> v_quantity then
    raise exception 'ATTENDEE_COUNT_MISMATCH';
  end if;

  delete from public.event_registration_attendees
  where registration_id = p_registration_id;

  for v_attendee, v_position in
    select value, ordinality::integer
    from jsonb_array_elements(p_attendees) with ordinality
  loop
    v_full_name := btrim(coalesce(v_attendee ->> 'full_name', ''));
    v_age_group := nullif(upper(btrim(coalesce(v_attendee ->> 'age_group', ''))), '');
    v_gender := nullif(upper(btrim(coalesce(v_attendee ->> 'gender', ''))), '');
    if char_length(v_full_name) not between 3 and 120 then
      raise exception 'INVALID_ATTENDEE_NAME';
    end if;
    if v_age_group is not null and v_age_group not in ('0_5', '6_12', '13_17', '18_25', '26_59', '60_PLUS') then
      raise exception 'INVALID_ATTENDEE_AGE';
    end if;
    if v_gender is not null and v_gender not in ('FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY') then
      raise exception 'INVALID_ATTENDEE_GENDER';
    end if;
    insert into public.event_registration_attendees (
      event_id, registration_id, position, full_name, age_group, gender
    ) values (
      p_event_id, p_registration_id, v_position, v_full_name, v_age_group, v_gender
    );
  end loop;

  delete from public.event_registration_payers
  where registration_id = p_registration_id;

  if p_payer is not null and jsonb_typeof(p_payer) = 'object' then
    insert into public.event_registration_payers (
      registration_id,
      event_id,
      is_contact,
      person_type,
      document_type,
      document_number,
      document_country,
      legal_name,
      billing_email,
      tax_document_requested
    ) values (
      p_registration_id,
      p_event_id,
      coalesce((p_payer ->> 'is_contact')::boolean, true),
      upper(btrim(coalesce(p_payer ->> 'person_type', 'NATURAL'))),
      nullif(upper(btrim(coalesce(p_payer ->> 'document_type', ''))), ''),
      nullif(btrim(coalesce(p_payer ->> 'document_number', '')), ''),
      btrim(coalesce(p_payer ->> 'document_country', '')),
      btrim(coalesce(p_payer ->> 'legal_name', '')),
      lower(btrim(coalesce(p_payer ->> 'billing_email', ''))),
      coalesce((p_payer ->> 'tax_document_requested')::boolean, false)
    );
  end if;
end;
$$;

revoke all on function public.save_event_registration_people_secure(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_event_registration_people_secure(uuid, uuid, jsonb, jsonb)
  to service_role;

commit;

select
  to_regclass('public.event_registration_attendees') as attendees_table,
  to_regclass('public.event_registration_payers') as payers_table,
  to_regprocedure('public.save_event_registration_people_secure(uuid,uuid,jsonb,jsonb)') as save_function;
