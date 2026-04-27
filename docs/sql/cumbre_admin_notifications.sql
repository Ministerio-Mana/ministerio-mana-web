-- Cumbre 2026: log de avisos manuales desde panel admin
create extension if not exists "pgcrypto";

create table if not exists public.cumbre_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references cumbre_bookings(id) on delete cascade,
  kind text not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  sent_by_email text,
  sent_by_name text,
  payload jsonb
);

create index if not exists cumbre_admin_notifications_booking_idx
  on public.cumbre_admin_notifications(booking_id);

create index if not exists cumbre_admin_notifications_kind_channel_idx
  on public.cumbre_admin_notifications(kind, channel);

alter table public.cumbre_admin_notifications enable row level security;
