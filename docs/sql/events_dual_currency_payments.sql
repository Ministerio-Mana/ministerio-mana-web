-- Portal Maná: cobro dual para eventos globales.
-- Wompi cobra COP en Colombia y Stripe cobra USD para asistentes internacionales.
-- Ejecutar después de events_public_registration_upgrade.sql y events_finance_constraints_upgrade.sql.
-- Idempotente y no destructivo. No modifica tablas de Campus, Cumbre ni donaciones.

begin;

alter table public.events
  add column if not exists price_cop numeric(14,2),
  add column if not exists price_usd numeric(14,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_price_cop_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events add constraint events_price_cop_check
      check (price_cop is null or price_cop >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'events_price_usd_check'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events add constraint events_price_usd_check
      check (price_usd is null or price_usd >= 0);
  end if;
end $$;

update public.events
set price_cop = price
where price_cop is null
  and upper(coalesce(currency, '')) = 'COP'
  and coalesce(price, 0) > 0;

update public.events
set price_usd = price
where price_usd is null
  and upper(coalesce(currency, '')) = 'USD'
  and coalesce(price, 0) > 0;

create or replace function public.set_event_online_payment_options_secure(
  p_event_id uuid,
  p_mode text,
  p_actor_user_id uuid default null
)
returns table (
  payment_provider text,
  payment_currency text,
  payment_option_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := upper(btrim(coalesce(p_mode, 'NONE')));
  v_provider text;
  v_currency text;
  v_label text;
begin
  if p_event_id is null or v_mode not in ('NONE', 'WOMPI', 'STRIPE', 'DUAL') then
    raise exception 'INVALID_EVENT_PAYMENT_MODE';
  end if;

  select
    e.id,
    e.scope,
    e.registration_mode,
    e.pricing_model,
    e.price,
    e.currency,
    e.price_cop,
    e.price_usd
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_mode <> 'NONE' and v_event.registration_mode <> 'INTERNAL' then
    raise exception 'EVENT_INTERNAL_REGISTRATION_REQUIRED';
  end if;
  if v_mode <> 'NONE' and v_event.pricing_model = 'FREE' then
    raise exception 'EVENT_ONLINE_PAYMENT_NOT_REQUIRED';
  end if;
  if v_mode = 'DUAL' and v_event.scope <> 'GLOBAL' then
    raise exception 'DUAL_PAYMENT_REQUIRES_GLOBAL_EVENT';
  end if;

  if v_event.pricing_model = 'PAID' then
    if v_mode in ('WOMPI', 'DUAL')
      and coalesce(v_event.price_cop, case when v_event.currency = 'COP' then v_event.price end, 0) <= 0
    then
      raise exception 'INVALID_EVENT_PRICE_COP';
    end if;
    if v_mode in ('STRIPE', 'DUAL')
      and coalesce(v_event.price_usd, case when v_event.currency = 'USD' then v_event.price end, 0) <= 0
    then
      raise exception 'INVALID_EVENT_PRICE_USD';
    end if;
  end if;

  update public.event_payment_options
  set is_active = false, updated_at = now()
  where event_id = p_event_id
    and kind = 'ONLINE';

  if v_mode = 'NONE' then
    return;
  end if;

  update public.event_payment_options
  set is_active = false, updated_at = now()
  where event_id = p_event_id
    and provider in ('MANUAL', 'EXTERNAL');

  foreach v_provider in array (case
    when v_mode = 'DUAL' then array['WOMPI', 'STRIPE']::text[]
    else array[v_mode]::text[]
  end) loop
    v_currency := case when v_provider = 'WOMPI' then 'COP' else 'USD' end;
    v_label := case
      when v_provider = 'WOMPI' then 'Colombia · Pago en pesos con Wompi'
      else 'Fuera de Colombia · Pago en dólares con Stripe'
    end;

    insert into public.event_payment_options (
      event_id,
      kind,
      provider,
      currency,
      label,
      requires_evidence,
      is_active,
      created_by,
      updated_at
    ) values (
      p_event_id,
      'ONLINE',
      v_provider,
      v_currency,
      v_label,
      false,
      true,
      p_actor_user_id,
      now()
    )
    on conflict (event_id, kind, provider, currency)
    do update set
      label = excluded.label,
      requires_evidence = false,
      is_active = true,
      updated_at = now();
  end loop;

  return query
  select epo.provider, epo.currency, epo.id
  from public.event_payment_options epo
  where epo.event_id = p_event_id
    and epo.kind = 'ONLINE'
    and epo.is_active = true
  order by case when epo.provider = 'WOMPI' then 1 else 2 end;
end;
$$;

revoke all on function public.set_event_online_payment_options_secure(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_event_online_payment_options_secure(uuid, text, uuid)
  to service_role;

create or replace function public.create_event_registration_secure(
  p_event_id uuid,
  p_registration_id uuid,
  p_idempotency_key text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_quantity integer,
  p_donation_amount numeric default null,
  p_payment_option_id uuid default null,
  p_payment_provider text default null
)
returns table (
  registration_id uuid,
  registration_status text,
  total_amount numeric,
  currency text,
  expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_existing record;
  v_option record;
  v_reserved integer := 0;
  v_unit_price numeric(14,2) := 0;
  v_total_amount numeric(14,2) := 0;
  v_registration_currency text := 'COP';
  v_status text := 'PENDING_PAYMENT';
  v_expires_at timestamptz := null;
begin
  if p_registration_id is null
    or p_event_id is null
    or p_idempotency_key is null
    or length(p_idempotency_key) < 16
    or length(p_idempotency_key) > 300
  then
    raise exception 'INVALID_REGISTRATION_REQUEST';
  end if;

  select er.id, er.status, er.total_amount, er.currency, er.expires_at
    into v_existing
  from public.event_registrations er
  where er.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.id <> p_registration_id then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return query select
      v_existing.id,
      v_existing.status,
      v_existing.total_amount,
      v_existing.currency,
      v_existing.expires_at,
      true;
    return;
  end if;

  select
    e.id,
    e.status,
    e.registration_mode,
    e.registration_opens_at,
    e.registration_closes_at,
    e.start_date,
    e.end_date,
    e.capacity,
    e.pricing_model,
    e.price,
    e.currency,
    e.price_cop,
    e.price_usd,
    e.registration_requires_approval
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_event.status <> 'PUBLISHED' or v_event.registration_mode <> 'INTERNAL' then
    raise exception 'EVENT_REGISTRATION_CLOSED';
  end if;
  if v_event.registration_opens_at is not null and v_event.registration_opens_at > now() then
    raise exception 'EVENT_REGISTRATION_NOT_OPEN';
  end if;
  if v_event.registration_closes_at is not null and v_event.registration_closes_at < now() then
    raise exception 'EVENT_REGISTRATION_CLOSED';
  end if;
  if coalesce(v_event.end_date, v_event.start_date) < now() then
    raise exception 'EVENT_REGISTRATION_CLOSED';
  end if;
  if p_quantity < 1 or p_quantity > 100 then
    raise exception 'INVALID_QUANTITY';
  end if;

  update public.event_registrations as er
  set status = 'EXPIRED', updated_at = now()
  where er.event_id = p_event_id
    and er.status = 'PENDING_PAYMENT'
    and er.expires_at is not null
    and er.expires_at <= now();

  if v_event.capacity is not null and v_event.capacity > 0 then
    select coalesce(sum(er.quantity), 0)::integer
      into v_reserved
    from public.event_registrations er
    where er.event_id = p_event_id
      and (
        er.status in ('CONFIRMED', 'UNDER_REVIEW')
        or (er.status = 'PENDING_PAYMENT' and (er.expires_at is null or er.expires_at > now()))
      );
    if v_reserved + p_quantity > v_event.capacity then
      raise exception 'EVENT_CAPACITY_EXCEEDED';
    end if;
  end if;

  if v_event.pricing_model = 'FREE' then
    v_registration_currency := coalesce(v_event.currency, 'COP');
    v_unit_price := 0;
    v_total_amount := 0;
    v_status := case when v_event.registration_requires_approval then 'UNDER_REVIEW' else 'CONFIRMED' end;
    p_payment_option_id := null;
  else
    if p_payment_option_id is null then raise exception 'PAYMENT_OPTION_REQUIRED'; end if;
    select epo.id, epo.provider, epo.currency
      into v_option
    from public.event_payment_options epo
    where epo.id = p_payment_option_id
      and epo.event_id = p_event_id
      and epo.kind = 'ONLINE'
      and epo.is_active = true;
    if not found
      or v_option.provider not in ('WOMPI', 'STRIPE')
      or v_option.provider <> upper(coalesce(p_payment_provider, ''))
    then
      raise exception 'PAYMENT_OPTION_INVALID';
    end if;
    if (v_option.provider = 'WOMPI' and v_option.currency <> 'COP')
      or (v_option.provider = 'STRIPE' and v_option.currency <> 'USD')
    then
      raise exception 'PAYMENT_CURRENCY_MISMATCH';
    end if;
    v_registration_currency := v_option.currency;

    if v_event.pricing_model = 'PAID' then
      v_unit_price := case
        when v_option.provider = 'WOMPI'
          then coalesce(v_event.price_cop, case when v_event.currency = 'COP' then v_event.price end)
        else coalesce(v_event.price_usd, case when v_event.currency = 'USD' then v_event.price end)
      end;
      if v_unit_price is null or v_unit_price <= 0 then raise exception 'INVALID_EVENT_PRICE'; end if;
      v_unit_price := round(v_unit_price::numeric, 2);
      v_total_amount := round(v_unit_price * p_quantity, 2);
    elsif v_event.pricing_model = 'DONATION' then
      if p_donation_amount is null or p_donation_amount <= 0 or p_donation_amount > 1000000000 then
        raise exception 'INVALID_DONATION_AMOUNT';
      end if;
      v_total_amount := round(p_donation_amount::numeric, 2);
      v_unit_price := round(v_total_amount / p_quantity, 2);
    else
      raise exception 'INVALID_PRICING_MODEL';
    end if;
    v_status := 'PENDING_PAYMENT';
    v_expires_at := now() + interval '31 minutes';
  end if;

  insert into public.event_registrations (
    id,
    event_id,
    contact_name,
    contact_email,
    contact_phone,
    quantity,
    unit_price,
    total_amount,
    currency,
    status,
    payment_option_id,
    idempotency_key,
    confirmed_at,
    expires_at
  ) values (
    p_registration_id,
    p_event_id,
    p_contact_name,
    lower(p_contact_email),
    nullif(p_contact_phone, ''),
    p_quantity,
    v_unit_price,
    v_total_amount,
    v_registration_currency,
    v_status,
    p_payment_option_id,
    p_idempotency_key,
    case when v_status = 'CONFIRMED' then now() else null end,
    v_expires_at
  );

  return query select
    p_registration_id,
    v_status,
    v_total_amount,
    v_registration_currency,
    v_expires_at,
    false;
end;
$$;

revoke all on function public.create_event_registration_secure(
  uuid, uuid, text, text, text, text, integer, numeric, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_event_registration_secure(
  uuid, uuid, text, text, text, text, integer, numeric, uuid, text
) to service_role;

create or replace function public.get_event_payment_totals_secure(p_event_id uuid)
returns table (
  provider text,
  currency text,
  payment_count bigint,
  approved_count bigint,
  approved_amount numeric,
  pending_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    ep.provider,
    ep.currency,
    count(*)::bigint as payment_count,
    count(*) filter (where ep.status = 'APPROVED')::bigint as approved_count,
    coalesce(sum(ep.amount) filter (where ep.status = 'APPROVED'), 0)::numeric as approved_amount,
    count(*) filter (where ep.status in ('PENDING', 'UNDER_REVIEW'))::bigint as pending_count
  from public.event_payments ep
  where ep.event_id = p_event_id
  group by ep.provider, ep.currency
  order by ep.currency, ep.provider;
$$;

revoke all on function public.get_event_payment_totals_secure(uuid)
  from public, anon, authenticated;
grant execute on function public.get_event_payment_totals_secure(uuid)
  to service_role;

comment on column public.events.price_cop is
  'Precio fijo por persona en COP para Wompi. No representa una conversión automática.';
comment on column public.events.price_usd is
  'Precio fijo por persona en USD para Stripe. No representa una conversión automática.';

commit;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'events'
  and column_name in ('price_cop', 'price_usd')
order by column_name;

select
  to_regprocedure('public.set_event_online_payment_options_secure(uuid,text,uuid)') as payment_options_function,
  to_regprocedure('public.create_event_registration_secure(uuid,uuid,text,text,text,text,integer,numeric,uuid,text)') as registration_function,
  to_regprocedure('public.get_event_payment_totals_secure(uuid)') as totals_function;
