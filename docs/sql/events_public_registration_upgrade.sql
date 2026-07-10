-- Inscripcion publica segura para eventos genericos.
-- Ejecutar despues de events_finance_schema.sql.
-- Idempotente y no destructivo. No modifica tablas cumbre_*.

begin;

alter table public.event_registrations
  add column if not exists expires_at timestamptz;

create index if not exists idx_event_registrations_pending_expiry
  on public.event_registrations(event_id, expires_at)
  where status = 'PENDING_PAYMENT';

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
    v_unit_price := 0;
    v_total_amount := 0;
    v_status := case when v_event.registration_requires_approval then 'UNDER_REVIEW' else 'CONFIRMED' end;
  elsif v_event.pricing_model = 'PAID' then
    if v_event.price is null or v_event.price <= 0 then raise exception 'INVALID_EVENT_PRICE'; end if;
    v_unit_price := round(v_event.price::numeric, 2);
    v_total_amount := round(v_unit_price * p_quantity, 2);
    v_status := 'PENDING_PAYMENT';
    v_expires_at := now() + interval '31 minutes';
  elsif v_event.pricing_model = 'DONATION' then
    if p_donation_amount is null or p_donation_amount <= 0 or p_donation_amount > 1000000000 then
      raise exception 'INVALID_DONATION_AMOUNT';
    end if;
    v_total_amount := round(p_donation_amount::numeric, 2);
    v_unit_price := round(v_total_amount / p_quantity, 2);
    v_status := 'PENDING_PAYMENT';
    v_expires_at := now() + interval '31 minutes';
  else
    raise exception 'INVALID_PRICING_MODEL';
  end if;

  if v_total_amount > 0 then
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
      or v_option.provider <> p_payment_provider
    then
      raise exception 'PAYMENT_OPTION_INVALID';
    end if;
    if v_option.currency <> v_event.currency then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
  else
    p_payment_option_id := null;
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
    v_event.currency,
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
    v_event.currency,
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

commit;

select
  to_regprocedure('public.create_event_registration_secure(uuid,uuid,text,text,text,text,integer,numeric,uuid,text)') as registration_function,
  to_regclass('public.idx_event_registrations_pending_expiry') as expiry_index;
