-- Integridad adicional para instalaciones que ya ejecutaron events_finance_schema.sql.
-- Idempotente y no destructivo. No modifica Cumbre ni pagos historicos.

begin;

create unique index if not exists idx_event_payment_options_unique
  on public.event_payment_options(event_id, kind, provider, currency);

commit;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'idx_event_payment_options_unique';
