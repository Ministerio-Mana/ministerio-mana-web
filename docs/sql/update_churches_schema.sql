-- Add location and contact info to churches
alter table public.churches
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists address text,
  add column if not exists maps_url text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

-- Ensure RLS is enabled for public read on map/selector endpoints.
alter table public.churches enable row level security;

-- Re-create policy idempotently to avoid 42710 when script runs multiple times.
-- Use a simple policy name to avoid copy/paste issues in SQL editor.
drop policy if exists churches_public_read on public.churches;

create policy churches_public_read
on public.churches
for select
using (true);
