-- Campos extra para reservas manuales / contabilidad
alter table cumbre_bookings
  add column if not exists contact_document_type text;

alter table cumbre_bookings
  add column if not exists contact_document_number text;

alter table cumbre_bookings
  add column if not exists contact_country text;

alter table cumbre_bookings
  add column if not exists contact_city text;

alter table cumbre_bookings
  add column if not exists contact_church text;

alter table cumbre_bookings
  add column if not exists updated_at timestamptz default now();

alter table cumbre_bookings
  add column if not exists payment_method text;

alter table cumbre_bookings
  add column if not exists payment_status text;
