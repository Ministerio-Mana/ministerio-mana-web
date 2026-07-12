-- Portal Mana: metadata y auditoria de documentos de eventos en SharePoint.
-- Seguro para ejecutar varias veces. No modifica pagos, inscripciones ni eventos.

create table if not exists public.event_documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  status text not null default 'UPLOADING'
    check (status in ('UPLOADING', 'READY', 'FAILED', 'ARCHIVED')),
  original_name text not null check (char_length(original_name) between 1 and 180),
  stored_name text not null check (char_length(stored_name) between 1 and 220),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 4194304),
  sharepoint_drive_id text,
  sharepoint_item_id text,
  sharepoint_web_url text,
  sharepoint_etag text,
  error_code text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sharepoint_web_url is null or sharepoint_web_url ~ '^https://')
);

create unique index if not exists idx_event_documents_sharepoint_item
  on public.event_documents(sharepoint_drive_id, sharepoint_item_id)
  where sharepoint_drive_id is not null and sharepoint_item_id is not null;

create index if not exists idx_event_documents_event_created
  on public.event_documents(event_id, created_at desc);

create index if not exists idx_event_documents_uploader_created
  on public.event_documents(uploaded_by, created_at desc);

create table if not exists public.event_document_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  document_id uuid references public.event_documents(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_event_document_audit_event_created
  on public.event_document_audit_logs(event_id, created_at desc);

alter table public.event_documents enable row level security;
alter table public.event_document_audit_logs enable row level security;

revoke all on table public.event_documents from public, anon, authenticated;
revoke all on table public.event_document_audit_logs from public, anon, authenticated;
grant all on table public.event_documents to service_role;
grant all on table public.event_document_audit_logs to service_role;

select
  to_regclass('public.event_documents') as documents_table,
  to_regclass('public.event_document_audit_logs') as audit_table;
