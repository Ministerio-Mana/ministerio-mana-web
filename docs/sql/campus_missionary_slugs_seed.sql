-- Campus Mana: asignar slugs estables a usuarios misioneros.
-- Ejecutar despues de docs/sql/campus_donation_allocations.sql.

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'amaury-padilla',
  updated_at = now()
where lower(email) = lower('amaury.padilla@ministeriomana.org');

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'rocio-nino',
  updated_at = now()
where lower(email) = lower('campusuniversitario@ministeriomana.org');

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'leidy-gaviria',
  updated_at = now()
where lower(email) = lower('leidy.gaviria@ministeriomana.org');

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'ariel-guzman',
  updated_at = now()
where lower(email) = lower('arielguzman@ministeriomana.org');

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'maria-camila-rios',
  updated_at = now()
where lower(email) = lower('camila@ministeriomana.org');

update public.user_profiles
set
  role = 'campus_missionary',
  campus_missionary_slug = 'oscar-hernandez',
  updated_at = now()
where lower(email) = lower('oscar.hernandez@ministeriomana.org');

-- Conectar asignaciones historicas con el usuario correcto por slug.
update public.campus_donation_allocations allocations
set missionary_id = profiles.user_id
from public.user_profiles profiles
where profiles.role = 'campus_missionary'
  and profiles.campus_missionary_slug = allocations.missionary_slug
  and allocations.missionary_id is distinct from profiles.user_id;

-- Verificacion: deben aparecer 6 filas con slug.
select
  email,
  full_name,
  role,
  campus_missionary_slug
from public.user_profiles
where lower(email) in (
  lower('amaury.padilla@ministeriomana.org'),
  lower('campusuniversitario@ministeriomana.org'),
  lower('leidy.gaviria@ministeriomana.org'),
  lower('arielguzman@ministeriomana.org'),
  lower('camila@ministeriomana.org'),
  lower('oscar.hernandez@ministeriomana.org')
)
order by campus_missionary_slug;

-- Verificacion: asignaciones Campus ya conectadas a usuarios.
select
  allocations.missionary_slug,
  profiles.email,
  count(*) as allocations_count
from public.campus_donation_allocations allocations
left join public.user_profiles profiles
  on profiles.user_id = allocations.missionary_id
group by allocations.missionary_slug, profiles.email
order by allocations.missionary_slug, profiles.email;
