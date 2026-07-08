-- Campus Mana: asignaciones normalizadas por donacion
-- Permite que cada misionero Campus vea sus donantes aunque una misma
-- donacion apoye a varios misioneros y aunque el webhook reemplace raw_event.

create extension if not exists "pgcrypto";

alter table public.user_profiles
  add column if not exists campus_missionary_slug text;

create unique index if not exists idx_user_profiles_campus_missionary_slug
  on public.user_profiles(campus_missionary_slug)
  where campus_missionary_slug is not null;

create table if not exists public.campus_donation_allocations (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id) on delete cascade,
  missionary_slug text not null,
  missionary_name text not null,
  missionary_id uuid references auth.users(id) on delete set null,
  amount numeric not null,
  currency text not null check (currency in ('COP', 'USD')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_campus_donation_allocations_unique
  on public.campus_donation_allocations(donation_id, missionary_slug);

create index if not exists idx_campus_donation_allocations_donation
  on public.campus_donation_allocations(donation_id);

create index if not exists idx_campus_donation_allocations_missionary
  on public.campus_donation_allocations(missionary_id)
  where missionary_id is not null;

alter table public.campus_donation_allocations enable row level security;

drop policy if exists "Usuarios ven asignaciones propias de donaciones Campus" on public.campus_donation_allocations;
create policy "Usuarios ven asignaciones propias de donaciones Campus"
  on public.campus_donation_allocations
  for select
  using (auth.uid() = missionary_id);

comment on table public.campus_donation_allocations
  is 'Distribucion por misionero de cada donacion Campus Mana.';

comment on column public.campus_donation_allocations.missionary_id
  is 'Usuario del portal con rol campus_missionary cuando se pudo empatar el misionero.';

comment on column public.user_profiles.campus_missionary_slug
  is 'Slug estable del misionero Campus para empatar donaciones sin depender del nombre visible.';

-- Backfill para donaciones creadas antes de esta tabla.
-- Recupera asignaciones desde raw_event.missionaryMatches y raw_event.allocations
-- cuando esos datos todavia existen.
with campus_rows as (
  select
    d.id as donation_id,
    d.currency,
    coalesce(d.raw_event -> 'missionaryMatches', '[]'::jsonb) as matches,
    coalesce(d.raw_event -> 'allocations', '[]'::jsonb) as allocations
  from public.donations d
  where
    d.raw_event is not null
    and (
      d.donation_type = 'campus'
      or d.source ilike '%campus%'
      or d.campus ilike '%Campus%'
    )
),
expanded as (
  select
    row.donation_id,
    row.currency,
    match_item ->> 'slug' as missionary_slug,
    match_item ->> 'name' as missionary_name,
    case
      when coalesce(match_item ->> 'userId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (match_item ->> 'userId')::uuid
      else null
    end as missionary_id,
    coalesce(
      (
        select
          case
            when coalesce(allocation_item ->> 'amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
              then (allocation_item ->> 'amount')::numeric
            else null
          end
        from jsonb_array_elements(row.allocations) allocation_item
        where allocation_item ->> 'slug' = match_item ->> 'slug'
        limit 1
      ),
      0
    ) as amount
  from campus_rows row,
    jsonb_array_elements(row.matches) match_item
  where
    coalesce(match_item ->> 'slug', '') <> ''
    and coalesce(match_item ->> 'name', '') <> ''
)
insert into public.campus_donation_allocations (
  donation_id,
  missionary_slug,
  missionary_name,
  missionary_id,
  amount,
  currency
)
select
  donation_id,
  missionary_slug,
  missionary_name,
  missionary_id,
  amount,
  currency
from expanded
where amount > 0
on conflict (donation_id, missionary_slug) do update
set
  missionary_name = excluded.missionary_name,
  missionary_id = coalesce(public.campus_donation_allocations.missionary_id, excluded.missionary_id),
  amount = excluded.amount,
  currency = excluded.currency;
