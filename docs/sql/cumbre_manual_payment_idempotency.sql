-- Cumbre 2026: evita abonos duplicados por reintentos o doble envío.
-- Seguro para ejecutar varias veces. No elimina ni modifica pagos existentes.

begin;

do $$
begin
  if exists (
    select 1
    from public.cumbre_payments
    where provider_tx_id is not null
    group by provider, provider_tx_id
    having count(*) > 1
  ) then
    raise exception 'Hay provider_tx_id duplicados en cumbre_payments. Revisar antes de crear el índice único.';
  end if;

  if exists (
    select 1
    from public.cumbre_payments
    where reference is not null
    group by booking_id, provider, reference
    having count(*) > 1
  ) then
    raise exception 'Hay referencias duplicadas en cumbre_payments. Revisar antes de crear el índice único.';
  end if;
end;
$$;

create unique index if not exists idx_cumbre_payments_provider_tx_unique
  on public.cumbre_payments(provider, provider_tx_id)
  where provider_tx_id is not null;

create unique index if not exists idx_cumbre_payments_booking_reference_unique
  on public.cumbre_payments(booking_id, provider, reference)
  where reference is not null;

commit;
