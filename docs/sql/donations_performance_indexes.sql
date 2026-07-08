-- Indices no destructivos para acelerar el panel de Donaciones.
-- Enfocados en los filtros usados por /api/portal/donations:
--   order by created_at desc
--   status
--   payment_domain
--   status + payment_domain
--
-- Ejecutar en Supabase SQL Editor. "concurrently" evita bloquear escrituras,
-- pero Supabase puede requerir correr cada sentencia por separado.

create index concurrently if not exists idx_donations_created_at_desc
  on public.donations (created_at desc);

create index concurrently if not exists idx_donations_status_created_at_desc
  on public.donations (status, created_at desc);

create index concurrently if not exists idx_donations_payment_domain_created_at_desc
  on public.donations (payment_domain, created_at desc);

create index concurrently if not exists idx_donations_domain_status_created_at_desc
  on public.donations (payment_domain, status, created_at desc);
