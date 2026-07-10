-- Wompi: recuperación segura de pagos locales PENDING.
-- Requiere haber ejecutado wompi_reliability_upgrade.sql previamente.
-- No aprueba pagos por inferencia y se puede ejecutar varias veces.

-- Un evento histórico PENDING también sirve: contiene el transaction ID. El
-- cron copiará ese ID y consultará el estado actual directamente en Wompi.
update public.mm_wompi_event_inbox i
set
  processing_status = 'RECEIVED',
  processed_at = null,
  last_processing_error = null,
  updated_at = now()
where i.tx_id is not null
  and exists (
    select 1
    from public.donations d
    where d.provider = 'wompi'
      and d.reference = i.reference
      and d.status = 'PENDING'
  );

-- Clasifica todos los PENDING de Campus en una sola tabla. La columna de María
-- Camila permite saber cuántos de cada grupo están asignados a ella.
with pending_campus as (
  select
    d.id,
    d.created_at,
    case
      when latest_event.reference is null then 'SIN_EVENTO_WOMPI'
      when latest_event.tx_id is null then 'EVENTO_SIN_TRANSACTION_ID'
      when upper(coalesce(latest_event.status, '')) = 'APPROVED' then 'EVENTO_APPROVED_POR_RECUPERAR'
      when upper(coalesce(latest_event.status, '')) in ('DECLINED', 'VOIDED', 'ERROR', 'FAILED') then 'EVENTO_FALLIDO_POR_RECUPERAR'
      else 'EVENTO_PENDING_CON_ID'
    end as pending_classification
  from public.donations d
  left join lateral (
    select i.reference, i.tx_id, i.status
    from public.mm_wompi_event_inbox i
    where i.reference = d.reference
    order by i.received_at desc
    limit 1
  ) latest_event on true
  where d.provider = 'wompi'
    and d.status = 'PENDING'
    and (
      lower(coalesce(d.donation_type, '')) = 'campus'
      or lower(coalesce(d.source, '')) like '%campus%'
    )
)
select
  p.pending_classification,
  count(*) as payments_count,
  count(*) filter (where exists (
    select 1
    from public.campus_donation_allocations a
    where a.donation_id = p.id
      and a.missionary_slug = 'maria-camila-rios'
  )) as maria_camila_count,
  min(p.created_at) as oldest_payment,
  max(p.created_at) as newest_payment
from pending_campus p
group by p.pending_classification
order by p.pending_classification;
