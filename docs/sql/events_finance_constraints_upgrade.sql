-- Integridad adicional para instalaciones que ya ejecutaron events_finance_schema.sql.
-- Idempotente y no destructivo. No modifica Cumbre ni pagos historicos.

begin;

do $$
begin
  if exists (
    select 1
    from public.event_payment_options
    group by event_id, kind, provider, currency
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'No se creó idx_event_payment_options_unique: existen métodos de pago duplicados.',
      hint = 'Consulta event_id, kind, provider, currency y resuelve los duplicados antes de repetir esta migración.';
  end if;
end;
$$;

create unique index if not exists idx_event_payment_options_unique
  on public.event_payment_options(event_id, kind, provider, currency);

commit;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'idx_event_payment_options_unique';
