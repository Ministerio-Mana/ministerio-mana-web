-- Cumbre 2026: recordatorios de cuotas (email/whatsapp)
create extension if not exists "pgcrypto";

create table if not exists public.cumbre_installment_reminders (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references cumbre_installments(id) on delete cascade,
  reminder_key text not null,
  channel text not null,
  sent_at timestamptz not null default now(),
  payload jsonb,
  error text
);

create unique index if not exists cumbre_installment_reminders_unique
  on public.cumbre_installment_reminders(installment_id, reminder_key, channel);

create index if not exists cumbre_installment_reminders_installment_idx
  on public.cumbre_installment_reminders(installment_id);
