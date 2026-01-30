-- Drafts para formulario manual de iglesias (autosave)
create table if not exists public.portal_iglesia_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
