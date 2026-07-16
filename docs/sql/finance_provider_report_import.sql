-- Importación atómica de reportes oficiales de Wompi y Stripe.
-- Requiere: docs/sql/finance_provider_reconciliation.sql
--
-- Propiedades:
-- - Solo service_role puede ejecutarla.
-- - Rechaza el mismo archivo por SHA-256.
-- - Rechaza IDs repetidos dentro del archivo desde la API y contradicciones contra la base aquí.
-- - Nunca degrada una transacción que ya tenga comisión y neto exactos.
-- - El lote, los abonos y las transacciones se confirman o revierten juntos.

create or replace function public.import_finance_provider_report_secure(
  p_provider text,
  p_report_type text,
  p_file_sha256 text,
  p_source_file_name text,
  p_row_count integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_settlements jsonb,
  p_transactions jsonb,
  p_imported_by uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text := upper(trim(coalesce(p_provider, '')));
  v_report_type text := upper(trim(coalesce(p_report_type, '')));
  v_batch_id uuid;
  v_existing_batch public.finance_provider_import_batches%rowtype;
  v_existing_transaction public.finance_provider_transactions%rowtype;
  v_settlement jsonb;
  v_transaction jsonb;
  v_settlement_id uuid;
  v_provider_settlement_id text;
  v_provider_transaction_id text;
  v_currency text;
  v_gross bigint;
  v_fee bigint;
  v_tax bigint;
  v_withholding bigint;
  v_adjustment bigint;
  v_net bigint;
  v_exact boolean;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_enriched_count integer := 0;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Solo el servicio privado puede importar conciliaciones.' using errcode = '42501';
  end if;

  if to_regclass('public.finance_provider_import_batches') is null
    or to_regclass('public.finance_provider_settlements') is null
    or to_regclass('public.finance_provider_transactions') is null then
    raise exception 'Falta ejecutar finance_provider_reconciliation.sql.';
  end if;

  if v_provider not in ('WOMPI', 'STRIPE') then
    raise exception 'Proveedor financiero inválido.';
  end if;
  if v_report_type not in ('SALES', 'PAYOUT_RECONCILIATION') then
    raise exception 'Tipo de reporte financiero inválido.';
  end if;
  if (v_provider = 'WOMPI' and v_report_type <> 'SALES')
    or (v_provider = 'STRIPE' and v_report_type <> 'PAYOUT_RECONCILIATION') then
    raise exception 'El tipo de reporte no corresponde al proveedor.';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Huella SHA-256 inválida.';
  end if;
  if p_row_count is null or p_row_count < 1 or p_row_count > 10000 then
    raise exception 'Cantidad de filas inválida.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'Período del reporte inválido.';
  end if;
  if jsonb_typeof(coalesce(p_transactions, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_settlements, 'null'::jsonb)) <> 'array' then
    raise exception 'El contenido del reporte debe ser una lista.';
  end if;
  if jsonb_array_length(p_transactions) <> p_row_count then
    raise exception 'La cantidad de transacciones no coincide con el lote.';
  end if;
  if jsonb_array_length(p_settlements) > 10000 then
    raise exception 'El reporte contiene demasiados abonos.';
  end if;

  select *
  into v_existing_batch
  from public.finance_provider_import_batches
  where provider = v_provider
    and report_type = v_report_type
    and file_sha256 = p_file_sha256
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'duplicate', true,
      'batch_id', v_existing_batch.id,
      'imported_at', v_existing_batch.imported_at,
      'row_count', v_existing_batch.row_count
    );
  end if;

  insert into public.finance_provider_import_batches (
    provider,
    report_type,
    period_start,
    period_end,
    file_sha256,
    source_file_name,
    row_count,
    status,
    imported_by,
    notes
  ) values (
    v_provider,
    v_report_type,
    p_period_start,
    p_period_end,
    p_file_sha256,
    left(regexp_replace(coalesce(p_source_file_name, 'reporte.csv'), '[[:cntrl:]]', '', 'g'), 180),
    p_row_count,
    'IMPORTED',
    p_imported_by,
    left(p_notes, 1000)
  ) returning id into v_batch_id;

  for v_settlement in select value from jsonb_array_elements(p_settlements)
  loop
    v_provider_settlement_id := left(trim(coalesce(v_settlement ->> 'provider_settlement_id', '')), 180);
    v_currency := upper(trim(coalesce(v_settlement ->> 'currency', '')));
    if v_provider_settlement_id = '' or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'El reporte contiene un abono inválido.';
    end if;

    if exists (
      select 1
      from public.finance_provider_settlements existing
      where existing.provider = v_provider
        and existing.provider_settlement_id = v_provider_settlement_id
        and existing.currency <> v_currency
    ) then
      raise exception 'El abono % contradice la moneda guardada.', v_provider_settlement_id;
    end if;

    insert into public.finance_provider_settlements (
      provider,
      provider_settlement_id,
      currency,
      currency_exponent,
      period_start,
      period_end,
      gross_amount_minor,
      fee_amount_minor,
      tax_amount_minor,
      withholding_amount_minor,
      adjustment_amount_minor,
      net_amount_minor,
      bank_deposit_amount_minor,
      transfer_reference,
      status,
      values_source,
      import_batch_id,
      settled_at
    ) values (
      v_provider,
      v_provider_settlement_id,
      v_currency,
      coalesce((v_settlement ->> 'currency_exponent')::smallint, 2),
      (v_settlement ->> 'period_start')::timestamptz,
      (v_settlement ->> 'period_end')::timestamptz,
      (v_settlement ->> 'gross_amount_minor')::bigint,
      (v_settlement ->> 'fee_amount_minor')::bigint,
      (v_settlement ->> 'tax_amount_minor')::bigint,
      (v_settlement ->> 'withholding_amount_minor')::bigint,
      (v_settlement ->> 'adjustment_amount_minor')::bigint,
      (v_settlement ->> 'net_amount_minor')::bigint,
      (v_settlement ->> 'bank_deposit_amount_minor')::bigint,
      nullif(left(trim(coalesce(v_settlement ->> 'transfer_reference', '')), 300), ''),
      upper(trim(coalesce(v_settlement ->> 'status', 'PENDING'))),
      'PROVIDER_REPORT',
      v_batch_id,
      (v_settlement ->> 'settled_at')::timestamptz
    )
    on conflict (provider, provider_settlement_id) do update set
      period_start = least(public.finance_provider_settlements.period_start, excluded.period_start),
      period_end = greatest(public.finance_provider_settlements.period_end, excluded.period_end),
      gross_amount_minor = coalesce(excluded.gross_amount_minor, public.finance_provider_settlements.gross_amount_minor),
      fee_amount_minor = coalesce(excluded.fee_amount_minor, public.finance_provider_settlements.fee_amount_minor),
      tax_amount_minor = coalesce(excluded.tax_amount_minor, public.finance_provider_settlements.tax_amount_minor),
      withholding_amount_minor = coalesce(excluded.withholding_amount_minor, public.finance_provider_settlements.withholding_amount_minor),
      adjustment_amount_minor = coalesce(excluded.adjustment_amount_minor, public.finance_provider_settlements.adjustment_amount_minor),
      net_amount_minor = coalesce(excluded.net_amount_minor, public.finance_provider_settlements.net_amount_minor),
      bank_deposit_amount_minor = coalesce(excluded.bank_deposit_amount_minor, public.finance_provider_settlements.bank_deposit_amount_minor),
      transfer_reference = coalesce(excluded.transfer_reference, public.finance_provider_settlements.transfer_reference),
      status = case
        when excluded.status = 'PAID' then 'PAID'
        else public.finance_provider_settlements.status
      end,
      values_source = 'PROVIDER_REPORT',
      import_batch_id = excluded.import_batch_id,
      settled_at = coalesce(excluded.settled_at, public.finance_provider_settlements.settled_at);
  end loop;

  for v_transaction in select value from jsonb_array_elements(p_transactions)
  loop
    v_provider_transaction_id := left(trim(coalesce(v_transaction ->> 'provider_transaction_id', '')), 180);
    v_currency := upper(trim(coalesce(v_transaction ->> 'currency', '')));
    v_gross := (v_transaction ->> 'gross_amount_minor')::bigint;
    v_fee := (v_transaction ->> 'fee_amount_minor')::bigint;
    v_tax := (v_transaction ->> 'tax_amount_minor')::bigint;
    v_withholding := (v_transaction ->> 'withholding_amount_minor')::bigint;
    v_adjustment := (v_transaction ->> 'adjustment_amount_minor')::bigint;
    v_net := (v_transaction ->> 'net_amount_minor')::bigint;
    v_exact := coalesce((v_transaction ->> 'exact_amounts')::boolean, false);

    if v_provider_transaction_id = '' or v_currency !~ '^[A-Z]{3}$'
      or v_gross is null or (v_transaction ->> 'occurred_at') is null then
      raise exception 'El reporte contiene una transacción inválida.';
    end if;
    if v_exact and (v_fee is null or v_net is null) then
      raise exception 'La transacción exacta % no trae comisión o neto.', v_provider_transaction_id;
    end if;
    if v_exact and v_gross - v_fee - coalesce(v_tax, 0) - coalesce(v_withholding, 0) + coalesce(v_adjustment, 0) <> v_net then
      raise exception 'La ecuación financiera de % no coincide.', v_provider_transaction_id;
    end if;

    v_provider_settlement_id := nullif(left(trim(coalesce(v_transaction ->> 'provider_settlement_id', '')), 180), '');
    v_settlement_id := null;
    if v_provider_settlement_id is not null then
      select id into v_settlement_id
      from public.finance_provider_settlements
      where provider = v_provider
        and provider_settlement_id = v_provider_settlement_id
      limit 1;
      if v_settlement_id is null then
        raise exception 'La transacción % referencia un abono inexistente.', v_provider_transaction_id;
      end if;
    end if;

    select * into v_existing_transaction
    from public.finance_provider_transactions
    where provider = v_provider
      and provider_transaction_id = v_provider_transaction_id
    limit 1;

    if found then
      if v_existing_transaction.currency <> v_currency
        or v_existing_transaction.gross_amount_minor <> v_gross then
        raise exception 'La transacción % contradice bruto o moneda ya guardados.', v_provider_transaction_id;
      end if;
      if v_existing_transaction.exact_amounts and v_exact and (
        v_existing_transaction.fee_amount_minor is distinct from v_fee
        or v_existing_transaction.net_amount_minor is distinct from v_net
        or v_existing_transaction.tax_amount_minor is distinct from v_tax
        or v_existing_transaction.withholding_amount_minor is distinct from v_withholding
        or v_existing_transaction.adjustment_amount_minor is distinct from v_adjustment
      ) then
        raise exception 'La transacción % contradice valores exactos ya guardados.', v_provider_transaction_id;
      end if;
      v_updated_count := v_updated_count + 1;
      if not v_existing_transaction.exact_amounts and v_exact then
        v_enriched_count := v_enriched_count + 1;
      end if;
    else
      v_inserted_count := v_inserted_count + 1;
    end if;

    insert into public.finance_provider_transactions (
      provider,
      provider_transaction_id,
      provider_balance_transaction_id,
      reference,
      currency,
      currency_exponent,
      gross_amount_minor,
      fee_amount_minor,
      tax_amount_minor,
      withholding_amount_minor,
      adjustment_amount_minor,
      net_amount_minor,
      payment_method,
      status,
      values_source,
      exact_amounts,
      settlement_id,
      import_batch_id,
      occurred_at,
      available_at,
      settled_at,
      provider_payload_sha256
    ) values (
      v_provider,
      v_provider_transaction_id,
      nullif(left(trim(coalesce(v_transaction ->> 'provider_balance_transaction_id', '')), 180), ''),
      nullif(left(trim(coalesce(v_transaction ->> 'reference', '')), 500), ''),
      v_currency,
      coalesce((v_transaction ->> 'currency_exponent')::smallint, 2),
      v_gross,
      v_fee,
      v_tax,
      v_withholding,
      v_adjustment,
      v_net,
      nullif(left(trim(coalesce(v_transaction ->> 'payment_method', '')), 120), ''),
      nullif(left(trim(coalesce(v_transaction ->> 'status', '')), 120), ''),
      'PROVIDER_REPORT',
      v_exact,
      v_settlement_id,
      v_batch_id,
      (v_transaction ->> 'occurred_at')::timestamptz,
      (v_transaction ->> 'available_at')::timestamptz,
      (v_transaction ->> 'settled_at')::timestamptz,
      nullif(v_transaction ->> 'provider_payload_sha256', '')
    )
    on conflict (provider, provider_transaction_id) do update set
      provider_balance_transaction_id = coalesce(excluded.provider_balance_transaction_id, public.finance_provider_transactions.provider_balance_transaction_id),
      reference = coalesce(excluded.reference, public.finance_provider_transactions.reference),
      fee_amount_minor = case when excluded.exact_amounts then excluded.fee_amount_minor else public.finance_provider_transactions.fee_amount_minor end,
      tax_amount_minor = case when excluded.exact_amounts then excluded.tax_amount_minor else public.finance_provider_transactions.tax_amount_minor end,
      withholding_amount_minor = case when excluded.exact_amounts then excluded.withholding_amount_minor else public.finance_provider_transactions.withholding_amount_minor end,
      adjustment_amount_minor = case when excluded.exact_amounts then excluded.adjustment_amount_minor else public.finance_provider_transactions.adjustment_amount_minor end,
      net_amount_minor = case when excluded.exact_amounts then excluded.net_amount_minor else public.finance_provider_transactions.net_amount_minor end,
      payment_method = coalesce(excluded.payment_method, public.finance_provider_transactions.payment_method),
      status = coalesce(excluded.status, public.finance_provider_transactions.status),
      values_source = case when excluded.exact_amounts then excluded.values_source else public.finance_provider_transactions.values_source end,
      exact_amounts = public.finance_provider_transactions.exact_amounts or excluded.exact_amounts,
      settlement_id = coalesce(excluded.settlement_id, public.finance_provider_transactions.settlement_id),
      import_batch_id = excluded.import_batch_id,
      occurred_at = excluded.occurred_at,
      available_at = coalesce(excluded.available_at, public.finance_provider_transactions.available_at),
      settled_at = coalesce(excluded.settled_at, public.finance_provider_transactions.settled_at),
      provider_payload_sha256 = coalesce(excluded.provider_payload_sha256, public.finance_provider_transactions.provider_payload_sha256);
  end loop;

  insert into public.finance_provider_reconciliation_audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data
  ) values (
    p_imported_by,
    'PROVIDER_REPORT_IMPORTED',
    'IMPORT_BATCH',
    v_batch_id,
    jsonb_build_object(
      'provider', v_provider,
      'report_type', v_report_type,
      'row_count', p_row_count,
      'inserted_count', v_inserted_count,
      'updated_count', v_updated_count,
      'enriched_count', v_enriched_count,
      'file_sha256', p_file_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'batch_id', v_batch_id,
    'row_count', p_row_count,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'enriched_count', v_enriched_count
  );
end;
$$;

revoke all on function public.import_finance_provider_report_secure(
  text, text, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, uuid, text
) from public, anon, authenticated;

grant execute on function public.import_finance_provider_report_secure(
  text, text, text, text, integer, timestamptz, timestamptz, jsonb, jsonb, uuid, text
) to service_role;

select
  to_regprocedure(
    'public.import_finance_provider_report_secure(text,text,text,text,integer,timestamptz,timestamptz,jsonb,jsonb,uuid,text)'
  ) as import_function;
