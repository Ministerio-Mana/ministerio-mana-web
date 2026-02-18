-- Clasificacion canonica de donaciones por dominio de pago
-- Objetivo:
-- 1) Separar claramente Cumbre vs Donaciones vs Campus (sin romper historico).
-- 2) Mantener trazabilidad contable aun cuando los prefijos viejos sean mixtos.
--
-- Script no destructivo: agrega columnas si faltan y hace backfill.

alter table public.donations
  add column if not exists payment_domain text,
  add column if not exists concept_code text,
  add column if not exists concept_label text;

create index if not exists idx_donations_payment_domain
  on public.donations(payment_domain);

create index if not exists idx_donations_provider_reference
  on public.donations(provider, reference);

create index if not exists idx_donations_booking_domain
  on public.donations(cumbre_booking_id, payment_domain);

with classified as (
  select
    d.id,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
        or lower(coalesce(d.project_name, '')) like '%cumbre%'
        or lower(coalesce(d.event_name, '')) like '%cumbre%'
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'CUMBRE'
      when lower(coalesce(d.donation_type, '')) = 'campus'
        or lower(coalesce(d.source, '')) like '%campus%'
      then 'CAMPUS'
      when lower(coalesce(d.donation_type, '')) = 'primicias'
        or lower(coalesce(d.source, '')) like '%primicias%'
      then 'PRIMICIAS'
      when lower(coalesce(d.donation_type, '')) in ('diezmos', 'ofrendas', 'misiones', 'peregrinaciones', 'evento', 'general')
      then 'DONATION'
      else 'OTHER'
    end as payment_domain_new,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'EVENT'
      when lower(coalesce(d.donation_type, '')) = 'diezmos' then 'TITHE'
      when lower(coalesce(d.donation_type, '')) = 'ofrendas' then 'OFFERING'
      when lower(coalesce(d.donation_type, '')) = 'misiones' then 'MISSIONS'
      when lower(coalesce(d.donation_type, '')) = 'campus' then 'CAMPUS'
      when lower(coalesce(d.donation_type, '')) = 'evento' then 'EVENT'
      when lower(coalesce(d.donation_type, '')) = 'peregrinaciones' then 'PILGRIMAGE'
      when lower(coalesce(d.donation_type, '')) = 'general' then 'GENERAL'
      when lower(coalesce(d.donation_type, '')) = 'primicias' then 'OFFERING'
      else 'OTHER'
    end as concept_code_new,
    case
      when d.cumbre_booking_id is not null
        or lower(coalesce(d.source, '')) like '%cumbre%'
        or lower(coalesce(d.source, '')) in ('portal-iglesia', 'portal-iglesia-edit')
        or lower(coalesce(d.reference, '')) like 'mm-evt-cm26-%'
      then 'Eventos'
      when lower(coalesce(d.donation_type, '')) = 'diezmos' then 'Diezmos'
      when lower(coalesce(d.donation_type, '')) = 'ofrendas' then 'Ofrendas'
      when lower(coalesce(d.donation_type, '')) = 'misiones' then 'Misiones'
      when lower(coalesce(d.donation_type, '')) = 'campus' then 'Campus'
      when lower(coalesce(d.donation_type, '')) = 'evento' then 'Eventos'
      when lower(coalesce(d.donation_type, '')) = 'peregrinaciones' then 'Peregrinaciones'
      when lower(coalesce(d.donation_type, '')) = 'general' then 'General'
      when lower(coalesce(d.donation_type, '')) = 'primicias' then 'Ofrendas'
      else 'Otros'
    end as concept_label_new
  from public.donations d
)
update public.donations d
set
  payment_domain = coalesce(d.payment_domain, c.payment_domain_new),
  concept_code = coalesce(d.concept_code, c.concept_code_new),
  concept_label = coalesce(d.concept_label, c.concept_label_new)
from classified c
where d.id = c.id
  and (
    d.payment_domain is null
    or d.concept_code is null
    or d.concept_label is null
  );

-- Verificacion rapida
select
  payment_domain,
  concept_code,
  count(*) as total
from public.donations
group by payment_domain, concept_code
order by payment_domain, total desc;
