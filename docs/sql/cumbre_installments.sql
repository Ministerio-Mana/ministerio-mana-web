-- Cumbre 2026: planes de pago a cuotas (mensual/quincenal)

create table if not exists cumbre_payment_plans (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references cumbre_bookings(id) on delete cascade,
  status text not null default 'ACTIVE',
  frequency text not null,
  start_date date not null,
  end_date date not null,
  total_amount numeric not null,
  currency text not null,
  installment_count int not null,
  installment_amount numeric not null,
  amount_paid numeric not null default 0,
  provider text not null,
  auto_debit boolean not null default true,
  provider_customer_id text,
  provider_payment_method_id text,
  provider_subscription_id text,
  next_due_date date,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cumbre_payment_plans_booking
  on cumbre_payment_plans(booking_id);

create table if not exists cumbre_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references cumbre_payment_plans(id) on delete cascade,
  booking_id uuid not null references cumbre_bookings(id) on delete cascade,
  installment_index int not null,
  due_date date not null,
  amount numeric not null,
  currency text not null,
  status text not null default 'PENDING',
  attempt_count int not null default 0,
  last_error text,
  provider_reference text,
  provider_tx_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_cumbre_installments_plan_index
  on cumbre_installments(plan_id, installment_index);

create index if not exists idx_cumbre_installments_due
  on cumbre_installments(status, due_date);

alter table cumbre_payments
  add column if not exists plan_id uuid references cumbre_payment_plans(id);

alter table cumbre_payments
  add column if not exists installment_id uuid references cumbre_installments(id);
