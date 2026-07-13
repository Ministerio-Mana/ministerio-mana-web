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
  add column if not exists deleted_at timestamptz;

alter table public.event_payment_evidence
  drop constraint if exists event_payment_evidence_mime_type_check,
  drop constraint if exists event_payment_evidence_size_bytes_check,
  drop constraint if exists event_payment_evidence_sharepoint_url_check,
  drop constraint if exists event_payment_evidence_sharepoint_pair_check,
  drop constraint if exists event_payment_evidence_sha256_check;

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
    check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$') not valid;

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

update public.event_payment_options
set requires_evidence = (kind <> 'CASH'),
    updated_at = now()
where provider in ('MANUAL', 'EXTERNAL')
  and requires_evidence is distinct from (kind <> 'CASH');

commit;

select
  to_regclass('public.event_payment_evidence') as evidence_table,
  to_regclass('public.idx_event_payment_evidence_active_payment') as active_payment_index;
