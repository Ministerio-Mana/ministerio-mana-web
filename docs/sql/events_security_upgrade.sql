-- Endurecimiento no destructivo de Eventos.
-- Ejecutar una vez en Supabase SQL Editor (produccion).
-- La aplicacion escribe por /api/portal/events usando service_role.

begin;

alter table public.events enable row level security;

-- Retira las politicas antiguas que permitian escribir directamente desde el navegador.
drop policy if exists "Auth users can insert events" on public.events;
drop policy if exists "Creator can update events" on public.events;
drop policy if exists "Public read valid events" on public.events;
drop policy if exists "Authenticated read scoped events" on public.events;

-- La lectura directa queda limitada a eventos publicados dentro del alcance del usuario.
-- El creador conserva lectura de sus borradores y archivados.
create policy "Authenticated read scoped events"
on public.events
for select
to authenticated
using (
  created_by = auth.uid()
  or (
    status = 'PUBLISHED'
    and (
      scope = 'GLOBAL'
      or (
        scope = 'NATIONAL'
        and country = (
          select p.country
          from public.user_profiles p
          where p.user_id = auth.uid()
          limit 1
        )
      )
      or (
        scope = 'LOCAL'
        and church_id = (
          select coalesce(p.church_id, p.portal_church_id)
          from public.user_profiles p
          where p.user_id = auth.uid()
          limit 1
        )
      )
    )
  )
);

revoke all on table public.events from anon;
revoke insert, update, delete, truncate, references, trigger on table public.events from authenticated;
grant select on table public.events to authenticated;

commit;

-- Verificacion: debe mostrar solo SELECT para authenticated y ninguna politica INSERT/UPDATE/DELETE.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'events'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'events'
order by policyname;
