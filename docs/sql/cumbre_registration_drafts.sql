-- Drafts para registro post-pago de la Cumbre (autosave)
create table if not exists public.cumbre_registration_drafts (
  booking_id uuid primary key references cumbre_bookings(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
