-- Portal Maná: imagen pública de invitación por evento, almacenada en SharePoint.
-- Seguro para ejecutar varias veces. No modifica ImageKit, Campus, Wompi, Stripe ni roles.

create table if not exists public.event_invitation_images (
  event_id uuid primary key references public.events(id) on delete restrict,
  original_name text not null check (char_length(original_name) between 1 and 180),
  mime_type text not null check (mime_type = 'image/webp'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 768000),
  width integer not null check (width = 1600),
  height integer not null check (height = 900),
  sharepoint_drive_id text not null,
  sharepoint_item_id text not null,
  sharepoint_web_url text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sharepoint_web_url is null or sharepoint_web_url ~ '^https://')
);

create unique index if not exists idx_event_invitation_images_sharepoint_item
  on public.event_invitation_images(sharepoint_drive_id, sharepoint_item_id);

create table if not exists public.event_invitation_image_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_event_invitation_image_audit_event_created
  on public.event_invitation_image_audit_logs(event_id, created_at desc);

alter table public.event_invitation_images enable row level security;
alter table public.event_invitation_image_audit_logs enable row level security;

revoke all on table public.event_invitation_images from public, anon, authenticated;
revoke all on table public.event_invitation_image_audit_logs from public, anon, authenticated;
grant all on table public.event_invitation_images to service_role;
grant all on table public.event_invitation_image_audit_logs to service_role;

select
  to_regclass('public.event_invitation_images') as invitation_images_table,
  to_regclass('public.event_invitation_image_audit_logs') as audit_table;
