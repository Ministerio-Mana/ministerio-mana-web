-- Add location and contact info to churches
alter table public.churches
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists continent text,
  add column if not exists address text,
  add column if not exists maps_url text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

-- Fill continent for legacy rows where it is empty.
update public.churches
set continent = case
  when lower(trim(country)) in ('colombia', 'ecuador', 'mexico', 'méxico', 'estados unidos', 'united states', 'canada', 'panama', 'costa rica', 'guatemala', 'honduras', 'nicaragua', 'el salvador', 'belice', 'centroamerica', 'centroamérica', 'brasil', 'argentina', 'peru', 'perú', 'chile', 'bolivia', 'paraguay', 'uruguay', 'venezuela') then 'América'
  when lower(trim(country)) in ('francia', 'europa', 'españa', 'espana', 'alemania', 'suiza', 'italia', 'portugal', 'reino unido', 'inglaterra') then 'Europa'
  when lower(trim(country)) in ('australia', 'nueva zelanda') then 'Oceanía'
  else coalesce(continent, 'América')
end
where continent is null
  or btrim(continent) = '';

create index if not exists churches_continent_idx on public.churches(continent);
create index if not exists churches_country_idx on public.churches(country);
create index if not exists churches_city_idx on public.churches(city);

-- Ensure RLS is enabled for public read on map/selector endpoints.
alter table public.churches enable row level security;

-- Re-create policy idempotently to avoid 42710 when script runs multiple times.
-- Use a simple policy name to avoid copy/paste issues in SQL editor.
drop policy if exists churches_public_read on public.churches;

create policy churches_public_read
on public.churches
for select
using (true);
