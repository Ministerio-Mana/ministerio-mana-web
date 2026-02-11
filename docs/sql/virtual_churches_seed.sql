-- Seed Maná Virtual churches for regions/countries without local churches.
-- Safe to run multiple times (idempotent).

insert into public.churches (name, city, country)
select 'Ministerio Maná Virtual', null, 'Estados Unidos'
where not exists (
  select 1 from public.churches
  where lower(name) = lower('Ministerio Maná Virtual')
    and country = 'Estados Unidos'
);

insert into public.churches (name, city, country)
select 'Ministerio Maná Virtual', null, 'Europa'
where not exists (
  select 1 from public.churches
  where lower(name) = lower('Ministerio Maná Virtual')
    and country = 'Europa'
);

insert into public.churches (name, city, country)
select 'Ministerio Maná Virtual', null, 'Centroamérica'
where not exists (
  select 1 from public.churches
  where lower(name) = lower('Ministerio Maná Virtual')
    and country = 'Centroamérica'
);

insert into public.churches (name, city, country)
select 'Ministerio Maná Virtual', null, 'Australia'
where not exists (
  select 1 from public.churches
  where lower(name) = lower('Ministerio Maná Virtual')
    and country = 'Australia'
);
