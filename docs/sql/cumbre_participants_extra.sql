-- Campos extra para participantes (email opcional)
alter table public.cumbre_participants
  add column if not exists email text;
