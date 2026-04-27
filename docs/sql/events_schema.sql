-- Events Table Schema
-- Supports Global, National, and Local events

create type event_scope as enum ('GLOBAL', 'NATIONAL', 'LOCAL');
create type event_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  scope event_scope not null default 'LOCAL',
  
  -- Scoping fields
  church_id uuid references public.churches(id), -- For LOCAL scope
  city text, -- For NATIONAL scope (or regional)
  country text default 'Colombia', -- For NATIONAL scope
  
  -- Event details
  start_date timestamptz not null,
  end_date timestamptz,
  banner_url text,
  location_name text,
  location_address text,
  price numeric default 0,
  currency text default 'COP',
  
  status event_status not null default 'DRAFT',
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS Policies
alter table public.events enable row level security;

-- Policy: Read Access
-- Global: All
-- National: Match Country
-- Local: Match Church or Created By
create policy "Public read valid events"
  on public.events for select
  using (
    (scope = 'GLOBAL') OR
    (scope = 'NATIONAL' AND country = (select country from user_profiles where user_id = auth.uid())) OR
    (scope = 'LOCAL' AND church_id = (select church_id from user_profiles where user_id = auth.uid())) OR
    (created_by = auth.uid()) -- Creator always sees
  );

-- Policy: Write Access
-- Only Admins or Pastors (for their scope)
-- Simplifying to: Authenticated users can create (validated by app logic)
create policy "Auth users can insert events"
  on public.events for insert
  with check (auth.role() = 'authenticated'); 

-- Ideally restrict Update to Creator or Admin
create policy "Creator can update events"
  on public.events for update
  using (created_by = auth.uid());
