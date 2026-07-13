-- Comprobantes privados de pagos manuales para Eventos.
-- Ejecutar después de events_finance_schema.sql. Usa la misma biblioteca privada
-- configurada para event_documents_sharepoint.sql.
-- No habilita borrado automático: la retención debe aprobarse con Contabilidad.

begin;

alter table public.event_payment_evidence
  add column if not exists sharepoint_drive_id text,
  add column if not exists sharepoint_item_id text,
  add column if not exists sharepoint_web_url text,
  add column if not exists sharepoint_etag text,
  add column if not exists retention_until timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_started_at timestamptz,
  add column if not exists deletion_attempts integer not null default 0,
  add column if not exists deletion_last_error text;

alter table public.event_payment_evidence
  drop constraint if exists event_payment_evidence_mime_type_check,
  drop constraint if exists event_payment_evidence_size_bytes_check,
  drop constraint if exists event_payment_evidence_sharepoint_url_check,
  drop constraint if exists event_payment_evidence_sharepoint_pair_check,
  drop constraint if exists event_payment_evidence_sha256_check,
  drop constraint if exists event_payment_evidence_deletion_attempts_check;

alter table public.event_payment_evidence
  add constraint event_payment_evidence_mime_type_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')) not valid,
  add constraint event_payment_evidence_size_bytes_check
    check (size_bytes > 0 and size_bytes <= 4194304) not valid,
  add constraint event_payment_evidence_sharepoint_url_check
    check (sharepoint_web_url is null or sharepoint_web_url ~ '^https://') not valid,
  add constraint event_payment_evidence_sharepoint_pair_check
    check ((sharepoint_drive_id is null) = (sharepoint_item_id is null)) not valid,
  add constraint event_payment_evidence_sha256_check
    check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$') not valid,
  add constraint event_payment_evidence_deletion_attempts_check
    check (deletion_attempts >= 0) not valid;

create unique index if not exists idx_event_payment_evidence_sharepoint_item
  on public.event_payment_evidence(sharepoint_drive_id, sharepoint_item_id)
  where sharepoint_drive_id is not null and sharepoint_item_id is not null;

create unique index if not exists idx_event_payment_evidence_active_payment
  on public.event_payment_evidence(payment_id)
  where payment_id is not null and deleted_at is null;

create index if not exists idx_event_payment_evidence_retention
  on public.event_payment_evidence(retention_until)
  where retention_until is not null and deleted_at is null;

comment on column public.event_payment_evidence.retention_until is
  'Fecha mínima de conservación aprobada por Contabilidad. NULL impide eliminación automática.';

create or replace function public.claim_event_payment_evidence_retention(batch_size integer default 25)
returns table (
  id uuid,
  event_id uuid,
  registration_id uuid,
  payment_id uuid,
  sharepoint_drive_id text,
  sharepoint_item_id text,
  retention_until timestamptz,
  deletion_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select evidence.id
    from public.event_payment_evidence evidence
    where evidence.retention_until is not null
      and evidence.retention_until <= now()
      and evidence.deleted_at is null
      and evidence.status in ('APPROVED', 'REJECTED')
      and evidence.sharepoint_drive_id is not null
      and evidence.sharepoint_item_id is not null
      and evidence.deletion_attempts < 10
      and (
        evidence.deletion_started_at is null
        or evidence.deletion_started_at < now() - interval '1 hour'
      )
    order by evidence.retention_until, evidence.created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 25), 100))
  ), claimed as (
    update public.event_payment_evidence evidence
    set deletion_started_at = now(),
        deletion_attempts = evidence.deletion_attempts + 1,
        deletion_last_error = null
    from candidates
    where evidence.id = candidates.id
    returning evidence.*
  )
  select
    claimed.id,
    claimed.event_id,
    claimed.registration_id,
    claimed.payment_id,
    claimed.sharepoint_drive_id,
    claimed.sharepoint_item_id,
    claimed.retention_until,
    claimed.deletion_attempts
  from claimed;
end;
$$;

revoke all on function public.claim_event_payment_evidence_retention(integer) from public, anon, authenticated;
grant execute on function public.claim_event_payment_evidence_retention(integer) to service_role;

update public.event_payment_options
set requires_evidence = (kind <> 'CASH'),
    updated_at = now()
where provider in ('MANUAL', 'EXTERNAL')
  and requires_evidence is distinct from (kind <> 'CASH');

commit;

select
  to_regclass('public.event_payment_evidence') as evidence_table,
  to_regclass('public.idx_event_payment_evidence_active_payment') as active_payment_index;
