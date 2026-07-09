-- Portal Mana: endurecimiento de seguridad posterior a auditoria.
-- Idempotente. Ejecutar una vez en Supabase SQL Editor como postgres/admin.

begin;

-- 1) El contador publico de oraciones se incrementa de forma atomica y
-- solo para peticiones publicas ya aprobadas.
create or replace function public.increment_public_prayer_count(prayer_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.prayer_requests
  set prayers_count = prayers_count + 1,
      updated_at = now()
  where id = prayer_id
    and approved = true
    and visibility = 'public'
    and moderation_status = 'approved'
  returning prayers_count;
$$;

revoke all on function public.increment_public_prayer_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_public_prayer_count(uuid) to service_role;

-- 2) Vinculos Campus inmutables. No se usa el nombre visible para autorizar.
with missionary_accounts(email, missionary_slug) as (
  values
    ('amaury.padilla@ministeriomana.org', 'amaury-padilla'),
    ('arielguzman@ministeriomana.org', 'ariel-guzman'),
    ('leidy.gaviria@ministeriomana.org', 'leidy-gaviria'),
    ('camila@ministeriomana.org', 'maria-camila-rios'),
    ('oscar.hernandez@ministeriomana.org', 'oscar-hernandez'),
    ('campusuniversitario@ministeriomana.org', 'rocio-nino')
)
update public.user_profiles profile
set campus_missionary_slug = account.missionary_slug,
    updated_at = now()
from missionary_accounts account
where lower(profile.email) = lower(account.email)
  and profile.role = 'campus_missionary'
  and not exists (
    select 1
    from public.user_profiles owner
    where owner.campus_missionary_slug = account.missionary_slug
      and owner.user_id <> profile.user_id
  );

update public.campus_donation_allocations allocation
set missionary_id = profile.user_id
from public.user_profiles profile
where profile.role = 'campus_missionary'
  and profile.campus_missionary_slug = allocation.missionary_slug
  and allocation.missionary_id is distinct from profile.user_id;

commit;

-- Resultado esperado: hasta seis filas, cada slug con un solo usuario.
select
  profile.email,
  profile.role,
  profile.campus_missionary_slug,
  profile.user_id,
  count(allocation.id) as allocations_count
from public.user_profiles profile
left join public.campus_donation_allocations allocation
  on allocation.missionary_id = profile.user_id
where profile.campus_missionary_slug is not null
group by profile.email, profile.role, profile.campus_missionary_slug, profile.user_id
order by profile.campus_missionary_slug;
