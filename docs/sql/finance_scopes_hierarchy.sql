-- Alcances financieros jerárquicos para Portal Maná.
--
-- Reglas de propiedad:
-- - WOMPI: recaudo NACIONAL de Colombia, siempre.
-- - STRIPE: recaudo GLOBAL/internacional.
-- - Transferencia, QR o efectivo con church_id: recaudo LOCAL.
-- - Un movimiento REGIONAL debe declarar finance_region_id.
--
-- Este script es idempotente. Ejecutar en Supabase SQL Editor.

begin;

create extension if not exists pgcrypto;

create or replace function public.finance_country_key(value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(translate(coalesce(value, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '-'
    ),
    ''
  );
$$;

create table if not exists public.portal_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  scope_type text not null default 'global',
  scope_id uuid,
  scope_key text,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.portal_role_assignments
  add column if not exists scope_key text;

alter table public.portal_role_assignments
  drop constraint if exists portal_role_assignments_role_check,
  drop constraint if exists portal_role_assignments_scope_type_check,
  drop constraint if exists portal_role_assignments_status_check,
  drop constraint if exists portal_role_assignments_finance_scope_check;

alter table public.portal_role_assignments
  add constraint portal_role_assignments_role_check
    check (role in ('finance', 'intercessor')),
  add constraint portal_role_assignments_scope_type_check
    check (scope_type in ('global', 'country', 'region', 'church', 'campus')),
  add constraint portal_role_assignments_status_check
    check (status in ('active', 'inactive')),
  add constraint portal_role_assignments_finance_scope_check
    check (
      role <> 'finance'
      or (
        (scope_type = 'global' and scope_id is null and scope_key is null)
        or (scope_type = 'country' and scope_id is null and nullif(scope_key, '') is not null)
        or (scope_type in ('region', 'church') and scope_id is not null and scope_key is null)
      )
    );

create or replace function public.normalize_finance_role_assignment()
returns trigger
language plpgsql
as $$
begin
  new.role := lower(btrim(new.role));
  new.scope_type := lower(btrim(new.scope_type));
  new.status := lower(btrim(new.status));

  if new.role = 'finance' and new.scope_type = 'country' then
    new.scope_key := public.finance_country_key(new.scope_key);
    new.scope_id := null;
  elsif new.role = 'finance' and new.scope_type = 'global' then
    new.scope_id := null;
    new.scope_key := null;
  elsif new.role = 'finance' and new.scope_type in ('region', 'church') then
    new.scope_key := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_normalize_finance_role_assignment on public.portal_role_assignments;
create trigger trg_normalize_finance_role_assignment
before insert or update of role, scope_type, scope_id, scope_key, status
on public.portal_role_assignments
for each row execute function public.normalize_finance_role_assignment();

update public.portal_role_assignments
set scope_key = public.finance_country_key(scope_key),
    updated_at = now()
where role = 'finance'
  and scope_type = 'country';

drop index if exists public.idx_portal_role_assignments_unique_active;
create unique index idx_portal_role_assignments_unique_active
  on public.portal_role_assignments (
    user_id,
    role,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(scope_key, '')
  )
  where status = 'active';

create index if not exists idx_portal_role_assignments_user_role_status
  on public.portal_role_assignments(user_id, role, status);

alter table public.portal_role_assignments enable row level security;

revoke all on table public.portal_role_assignments from anon, authenticated;
grant all on table public.portal_role_assignments to service_role;

drop policy if exists service_role_all_portal_role_assignments on public.portal_role_assignments;
create policy service_role_all_portal_role_assignments
  on public.portal_role_assignments
  for all
  to service_role
  using (true)
  with check (true);

alter table public.donations
  add column if not exists finance_scope_type text not null default 'UNASSIGNED',
  add column if not exists finance_scope_country_key text,
  add column if not exists finance_region_id uuid;

do $$
begin
  if to_regclass('public.regions') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'donations_finance_region_id_fkey'
        and conrelid = 'public.donations'::regclass
    ) then
    alter table public.donations
      add constraint donations_finance_region_id_fkey
      foreign key (finance_region_id)
      references public.regions(id)
      on delete restrict
      not valid;
  end if;
end $$;

create or replace function public.classify_donation_finance_scope()
returns trigger
language plpgsql
as $$
declare
  provider_key text := upper(btrim(coalesce(new.provider, '')));
  resolved_country text;
  resolved_region uuid;
begin
  if provider_key = 'WOMPI' then
    new.finance_scope_type := 'NATIONAL';
    new.finance_scope_country_key := 'colombia';
    new.finance_region_id := null;
    return new;
  end if;

  if provider_key = 'STRIPE' then
    new.finance_scope_type := 'GLOBAL';
    new.finance_scope_country_key := null;
    new.finance_region_id := null;
    return new;
  end if;

  new.finance_scope_type := upper(btrim(coalesce(new.finance_scope_type, 'UNASSIGNED')));

  if new.finance_scope_type = 'GLOBAL' then
    new.finance_scope_country_key := null;
    new.finance_region_id := null;
    return new;
  end if;

  if new.finance_scope_type = 'NATIONAL' then
    new.finance_scope_country_key := public.finance_country_key(new.finance_scope_country_key);
    new.finance_region_id := null;
    return new;
  end if;

  if new.finance_scope_type = 'REGIONAL' and new.finance_region_id is not null then
    select public.finance_country_key(r.country)
      into resolved_country
    from public.regions r
    where r.id = new.finance_region_id;
    new.finance_scope_country_key := coalesce(
      resolved_country,
      public.finance_country_key(new.finance_scope_country_key)
    );
    return new;
  end if;

  if new.church_id is not null then
    select public.finance_country_key(c.country), c.region_id
      into resolved_country, resolved_region
    from public.churches c
    where c.id = new.church_id;
    new.finance_scope_type := 'LOCAL';
    new.finance_scope_country_key := resolved_country;
    new.finance_region_id := resolved_region;
    return new;
  end if;

  new.finance_scope_type := 'UNASSIGNED';
  new.finance_scope_country_key := null;
  new.finance_region_id := null;
  return new;
end;
$$;

drop trigger if exists trg_classify_donation_finance_scope on public.donations;
create trigger trg_classify_donation_finance_scope
before insert or update of provider, church_id, finance_scope_type, finance_scope_country_key, finance_region_id
on public.donations
for each row execute function public.classify_donation_finance_scope();

-- El proveedor define la cuenta receptora aunque el movimiento conserve church_id
-- como dato de atribución pastoral o de campaña.
update public.donations
set finance_scope_type = 'NATIONAL',
    finance_scope_country_key = 'colombia',
    finance_region_id = null
where upper(btrim(coalesce(provider, ''))) = 'WOMPI';

update public.donations
set finance_scope_type = 'GLOBAL',
    finance_scope_country_key = null,
    finance_region_id = null
where upper(btrim(coalesce(provider, ''))) = 'STRIPE';

update public.donations d
set finance_scope_type = 'LOCAL',
    finance_scope_country_key = public.finance_country_key(c.country),
    finance_region_id = c.region_id
from public.churches c
where d.church_id = c.id
  and upper(btrim(coalesce(d.provider, ''))) not in ('WOMPI', 'STRIPE');

update public.donations
set finance_scope_type = 'UNASSIGNED',
    finance_scope_country_key = null,
    finance_region_id = null
where upper(btrim(coalesce(provider, ''))) not in ('WOMPI', 'STRIPE')
  and church_id is null
  and finance_scope_type not in ('NATIONAL', 'REGIONAL', 'GLOBAL');

alter table public.donations
  drop constraint if exists donations_finance_scope_type_check,
  drop constraint if exists donations_finance_scope_country_key_check,
  drop constraint if exists donations_finance_scope_shape_check;

alter table public.donations
  add constraint donations_finance_scope_type_check
    check (finance_scope_type in ('GLOBAL', 'NATIONAL', 'REGIONAL', 'LOCAL', 'UNASSIGNED')),
  add constraint donations_finance_scope_country_key_check
    check (
      finance_scope_country_key is null
      or finance_scope_country_key = public.finance_country_key(finance_scope_country_key)
    ),
  add constraint donations_finance_scope_shape_check
    check (
      (finance_scope_type = 'GLOBAL' and finance_scope_country_key is null and finance_region_id is null)
      or (finance_scope_type = 'NATIONAL' and finance_scope_country_key is not null and finance_region_id is null)
      or (finance_scope_type = 'REGIONAL' and finance_scope_country_key is not null and finance_region_id is not null)
      or (finance_scope_type = 'LOCAL' and finance_scope_country_key is not null and church_id is not null)
      or (finance_scope_type = 'UNASSIGNED' and finance_scope_country_key is null and finance_region_id is null)
    );

create index if not exists idx_donations_finance_country
  on public.donations(finance_scope_country_key, finance_scope_type, created_at desc);
create index if not exists idx_donations_finance_region
  on public.donations(finance_region_id, finance_scope_type, created_at desc);
create index if not exists idx_donations_finance_church
  on public.donations(church_id, finance_scope_type, created_at desc);

create or replace function public.can_view_scoped_finance_donation(
  actor_user_id uuid,
  donation_scope_type text,
  donation_country_key text,
  donation_region_id uuid,
  donation_church_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.user_profiles p
      where p.user_id = actor_user_id
        and p.role in ('admin', 'superadmin')
    )
    or (
      exists (
        select 1
        from public.user_profiles p
        where p.user_id = actor_user_id
          and p.role = 'finance'
      )
      and not exists (
        select 1
        from public.portal_role_assignments a
        where a.user_id = actor_user_id
          and a.role = 'finance'
          and a.status = 'active'
      )
    )
    or exists (
      select 1
      from public.portal_role_assignments a
      where a.user_id = actor_user_id
        and a.role = 'finance'
        and a.status = 'active'
        and (
          a.scope_type = 'global'
          or (
            a.scope_type = 'country'
            and donation_scope_type in ('NATIONAL', 'REGIONAL', 'LOCAL')
            and a.scope_key = donation_country_key
          )
          or (
            a.scope_type = 'region'
            and donation_scope_type in ('REGIONAL', 'LOCAL')
            and a.scope_id = donation_region_id
          )
          or (
            a.scope_type = 'church'
            and donation_scope_type = 'LOCAL'
            and a.scope_id = donation_church_id
          )
        )
    );
$$;

revoke all on function public.can_view_scoped_finance_donation(uuid, text, text, uuid, uuid) from public;
grant execute on function public.can_view_scoped_finance_donation(uuid, text, text, uuid, uuid)
  to authenticated, service_role;

alter table public.donations enable row level security;

drop policy if exists "Scoped finance staff view assigned donations" on public.donations;
create policy "Scoped finance staff view assigned donations"
on public.donations
for select
to authenticated
using (
  public.can_view_scoped_finance_donation(
    auth.uid(),
    finance_scope_type,
    finance_scope_country_key,
    finance_region_id,
    church_id
  )
);

comment on column public.donations.finance_scope_type is
  'Cuenta responsable: GLOBAL, NATIONAL, REGIONAL, LOCAL o UNASSIGNED.';
comment on column public.donations.finance_scope_country_key is
  'Clave normalizada del país propietario; no es el país del donante.';
comment on column public.donations.finance_region_id is
  'Región propietaria para movimientos REGIONAL/LOCAL; no amplía el alcance de WOMPI o STRIPE.';

commit;

-- Ejemplos de asignación (descomenta y cambia el correo/identificador):
--
-- Finanzas nacionales Colombia:
-- insert into public.portal_role_assignments (user_id, role, scope_type, scope_key)
-- select user_id, 'finance', 'country', 'Colombia'
-- from public.user_profiles where lower(email) = lower('finanzas.nacional@dominio.com');
--
-- Finanzas regionales:
-- insert into public.portal_role_assignments (user_id, role, scope_type, scope_id)
-- select p.user_id, 'finance', 'region', r.id
-- from public.user_profiles p
-- join public.regions r on r.code = 'ANT'
-- where lower(p.email) = lower('finanzas.regional@dominio.com');
--
-- Finanzas de una iglesia:
-- insert into public.portal_role_assignments (user_id, role, scope_type, scope_id)
-- select p.user_id, 'finance', 'church', c.id
-- from public.user_profiles p
-- join public.churches c on c.code = 'IGLESIA-CODIGO'
-- where lower(p.email) = lower('finanzas.local@dominio.com');

-- Verificación: WOMPI solo debe quedar NATIONAL/colombia y STRIPE solo GLOBAL.
select
  upper(provider) as provider,
  finance_scope_type,
  finance_scope_country_key,
  count(*) as total
from public.donations
where upper(provider) in ('WOMPI', 'STRIPE')
group by upper(provider), finance_scope_type, finance_scope_country_key
order by provider, finance_scope_type;
