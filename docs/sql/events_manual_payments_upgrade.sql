-- Pagos manuales para eventos: QR, transferencia, efectivo y enlaces externos.
-- Ejecutar despues de events_public_registration_upgrade.sql.
-- Idempotente y no destructivo. No modifica Wompi, Stripe ni tablas cumbre_*.

begin;

create index if not exists idx_event_manual_payments_review
  on public.event_payments(event_id, created_at desc)
  where provider in ('MANUAL', 'EXTERNAL') and status = 'UNDER_REVIEW';

create or replace function public.expire_event_manual_holds_secure(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired_ids uuid[] := array[]::uuid[];
begin
  with expired as (
    update public.event_registrations er
    set status = 'EXPIRED', updated_at = now()
    where er.event_id = p_event_id
      and er.status = 'UNDER_REVIEW'
      and er.expires_at is not null
      and er.expires_at <= now()
    returning er.id
  )
  select coalesce(array_agg(expired.id), array[]::uuid[])
  into v_expired_ids
  from expired;

  if coalesce(array_length(v_expired_ids, 1), 0) > 0 then
    update public.event_payments ep
    set status = 'VOIDED', updated_at = now()
    where ep.registration_id = any(v_expired_ids)
      and ep.status = 'UNDER_REVIEW';
  end if;

  return coalesce(array_length(v_expired_ids, 1), 0);
end;
$$;

create or replace function public.create_event_manual_registration_secure(
  p_event_id uuid,
  p_registration_id uuid,
  p_payment_id uuid,
  p_idempotency_key text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_quantity integer,
  p_donation_amount numeric,
  p_payment_option_id uuid,
  p_reported_reference text
)
returns table (
  registration_id uuid,
  payment_id uuid,
  registration_status text,
  payment_status text,
  payment_reference text,
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
  v_option record;
  v_existing record;
  v_reserved integer := 0;
  v_total numeric(14,2) := 0;
  v_unit_price numeric(14,2) := 0;
  v_expires_at timestamptz := now() + interval '72 hours';
  v_reference text;
begin
  if p_event_id is null
    or p_registration_id is null
    or p_payment_id is null
    or p_payment_option_id is null
    or p_idempotency_key is null
    or length(p_idempotency_key) < 16
    or length(p_idempotency_key) > 300
    or p_reported_reference is null
    or length(trim(p_reported_reference)) < 3
    or length(p_reported_reference) > 120
  then
    raise exception 'INVALID_MANUAL_PAYMENT_REQUEST';
  end if;

  select
    er.id as registration_id,
    er.status as registration_status,
    er.total_amount,
    er.currency,
    er.expires_at,
    ep.id as payment_id,
    ep.status as payment_status,
    ep.reference as payment_reference
  into v_existing
  from public.event_registrations er
  join public.event_payments ep on ep.registration_id = er.id and ep.event_id = er.event_id
  where er.idempotency_key = p_idempotency_key
  order by ep.created_at asc
  limit 1;

  if found then
    if v_existing.registration_id <> p_registration_id then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT';
    end if;
    return query select
      v_existing.registration_id,
      v_existing.payment_id,
      v_existing.registration_status,
      v_existing.payment_status,
      v_existing.payment_reference,
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
    e.currency
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
  if p_quantity < 1 or p_quantity > 100 then raise exception 'INVALID_QUANTITY'; end if;

  update public.event_registrations er
  set status = 'EXPIRED', updated_at = now()
  where er.event_id = p_event_id
    and er.status in ('PENDING_PAYMENT', 'UNDER_REVIEW')
    and er.expires_at is not null
    and er.expires_at <= now();

  update public.event_payments ep
  set status = 'VOIDED', updated_at = now()
  where ep.event_id = p_event_id
    and ep.status in ('PENDING', 'UNDER_REVIEW')
    and exists (
      select 1 from public.event_registrations er
      where er.id = ep.registration_id and er.status = 'EXPIRED'
    );

  if v_event.capacity is not null and v_event.capacity > 0 then
    select coalesce(sum(er.quantity), 0)::integer
    into v_reserved
    from public.event_registrations er
    where er.event_id = p_event_id
      and (
        er.status = 'CONFIRMED'
        or (
          er.status in ('PENDING_PAYMENT', 'UNDER_REVIEW')
          and (er.expires_at is null or er.expires_at > now())
        )
      );
    if v_reserved + p_quantity > v_event.capacity then
      raise exception 'EVENT_CAPACITY_EXCEEDED';
    end if;
  end if;

  if v_event.pricing_model = 'PAID' then
    if v_event.price is null or v_event.price <= 0 then raise exception 'INVALID_EVENT_PRICE'; end if;
    v_unit_price := round(v_event.price::numeric, 2);
    v_total := round(v_unit_price * p_quantity, 2);
  elsif v_event.pricing_model = 'DONATION' then
    if p_donation_amount is null or p_donation_amount <= 0 or p_donation_amount > 1000000000 then
      raise exception 'INVALID_DONATION_AMOUNT';
    end if;
    v_total := round(p_donation_amount::numeric, 2);
    v_unit_price := round(v_total / p_quantity, 2);
  else
    raise exception 'MANUAL_PAYMENT_NOT_REQUIRED';
  end if;

  select epo.id, epo.kind, epo.provider, epo.currency, epo.label
  into v_option
  from public.event_payment_options epo
  where epo.id = p_payment_option_id
    and epo.event_id = p_event_id
    and epo.kind in ('CASH', 'BANK_TRANSFER', 'QR_TRANSFER', 'EXTERNAL')
    and epo.provider in ('MANUAL', 'EXTERNAL')
    and epo.is_active = true;

  if not found then raise exception 'PAYMENT_OPTION_INVALID'; end if;
  if v_option.currency <> v_event.currency then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;

  v_reference := 'MM-MAN-' || upper(substr(replace(p_payment_id::text, '-', ''), 1, 24));

  insert into public.event_registrations (
    id, event_id, contact_name, contact_email, contact_phone, quantity,
    unit_price, total_amount, currency, status, payment_option_id,
    idempotency_key, expires_at
  ) values (
    p_registration_id, p_event_id, p_contact_name, lower(p_contact_email),
    nullif(p_contact_phone, ''), p_quantity, v_unit_price, v_total,
    v_event.currency, 'UNDER_REVIEW', p_payment_option_id,
    p_idempotency_key, v_expires_at
  );

  insert into public.event_payments (
    id, event_id, registration_id, payment_option_id, provider, reference,
    method, amount, currency, status, provider_payload, idempotency_key,
    received_at
  ) values (
    p_payment_id, p_event_id, p_registration_id, p_payment_option_id,
    v_option.provider, v_reference, v_option.kind, v_total, v_event.currency,
    'UNDER_REVIEW',
    jsonb_build_object(
      'source', 'PUBLIC_EVENT_MANUAL_REPORT',
      'reported_reference', trim(p_reported_reference),
      'payment_kind', v_option.kind,
      'payment_label', v_option.label,
      'reported_at', now()
    ),
    'manual-payment:' || p_idempotency_key,
    now()
  );

  return query select
    p_registration_id,
    p_payment_id,
    'UNDER_REVIEW'::text,
    'UNDER_REVIEW'::text,
    v_reference,
    v_total,
    v_event.currency,
    v_expires_at,
    false;
end;
$$;

create or replace function public.review_event_manual_payment_secure(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_note text default null
)
returns table (
  payment_id uuid,
  registration_id uuid,
  payment_status text,
  registration_status text,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_action text := upper(trim(coalesce(p_action, '')));
  v_payment_status text;
  v_registration_status text;
begin
  if p_payment_id is null or p_actor_user_id is null or v_action not in ('APPROVE', 'DECLINE') then
    raise exception 'INVALID_REVIEW_REQUEST';
  end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'INVALID_REVIEW_NOTE'; end if;

  select ep.id, ep.event_id, ep.registration_id, ep.status, ep.provider
  into v_payment
  from public.event_payments ep
  where ep.id = p_payment_id
  for update;

  if not found or v_payment.provider not in ('MANUAL', 'EXTERNAL') then
    raise exception 'MANUAL_PAYMENT_NOT_FOUND';
  end if;

  v_payment_status := case when v_action = 'APPROVE' then 'APPROVED' else 'DECLINED' end;
  v_registration_status := case when v_action = 'APPROVE' then 'CONFIRMED' else 'CANCELLED' end;

  if v_payment.status = v_payment_status then
    return query select v_payment.id, v_payment.registration_id, v_payment_status, v_registration_status, true;
    return;
  end if;
  if v_payment.status <> 'UNDER_REVIEW' then raise exception 'PAYMENT_ALREADY_REVIEWED'; end if;

  update public.event_payments
  set
    status = v_payment_status,
    verified_at = now(),
    verified_by = p_actor_user_id,
    provider_payload = provider_payload || jsonb_build_object('review_note', nullif(trim(p_note), '')),
    updated_at = now()
  where id = v_payment.id;

  update public.event_registrations
  set
    status = v_registration_status,
    confirmed_at = case when v_action = 'APPROVE' then now() else confirmed_at end,
    cancelled_at = case when v_action = 'DECLINE' then now() else cancelled_at end,
    expires_at = null,
    updated_at = now()
  where id = v_payment.registration_id;

  insert into public.event_finance_audit_logs (
    event_id, registration_id, payment_id, actor_user_id, action, after_data
  ) values (
    v_payment.event_id,
    v_payment.registration_id,
    v_payment.id,
    p_actor_user_id,
    case when v_action = 'APPROVE' then 'MANUAL_PAYMENT_APPROVED' else 'MANUAL_PAYMENT_DECLINED' end,
    jsonb_build_object('payment_status', v_payment_status, 'registration_status', v_registration_status, 'note', nullif(trim(p_note), ''))
  );

  return query select v_payment.id, v_payment.registration_id, v_payment_status, v_registration_status, false;
end;
$$;

create or replace function public.record_event_checkin_secure(
  p_registration_id uuid,
  p_actor_user_id uuid,
  p_quantity integer,
  p_notes text default null
)
returns table (
  registration_id uuid,
  checked_in_quantity integer,
  remaining_quantity integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration record;
  v_checked integer := 0;
begin
  if p_registration_id is null or p_actor_user_id is null or p_quantity < 1 then
    raise exception 'INVALID_CHECKIN_REQUEST';
  end if;
  if p_notes is not null and length(p_notes) > 300 then raise exception 'INVALID_CHECKIN_NOTE'; end if;

  select er.id, er.event_id, er.quantity, er.status
  into v_registration
  from public.event_registrations er
  where er.id = p_registration_id
  for update;

  if not found then raise exception 'REGISTRATION_NOT_FOUND'; end if;
  if v_registration.status <> 'CONFIRMED' then raise exception 'REGISTRATION_NOT_CONFIRMED'; end if;

  select coalesce(sum(ec.quantity), 0)::integer
  into v_checked
  from public.event_checkins ec
  where ec.registration_id = p_registration_id;

  if v_checked + p_quantity > v_registration.quantity then raise exception 'CHECKIN_QUANTITY_EXCEEDED'; end if;

  insert into public.event_checkins (event_id, registration_id, quantity, checked_in_by, notes)
  values (v_registration.event_id, p_registration_id, p_quantity, p_actor_user_id, nullif(trim(p_notes), ''));

  v_checked := v_checked + p_quantity;

  insert into public.event_finance_audit_logs (
    event_id, registration_id, actor_user_id, action, after_data
  ) values (
    v_registration.event_id,
    p_registration_id,
    p_actor_user_id,
    'EVENT_CHECKIN_RECORDED',
    jsonb_build_object('quantity', p_quantity, 'checked_in_total', v_checked)
  );

  return query select p_registration_id, v_checked, v_registration.quantity - v_checked;
end;
$$;

create or replace function public.get_event_operation_summary_secure(p_event_id uuid)
returns table (
  registrations_count bigint,
  attendees_count bigint,
  under_review_count bigint,
  confirmed_count bigint,
  checked_in_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(er.id)::bigint,
    coalesce(sum(er.quantity), 0)::bigint,
    coalesce(sum(er.quantity) filter (where er.status = 'UNDER_REVIEW'), 0)::bigint,
    coalesce(sum(er.quantity) filter (where er.status = 'CONFIRMED'), 0)::bigint,
    coalesce((
      select sum(ec.quantity)
      from public.event_checkins ec
      where ec.event_id = p_event_id
    ), 0)::bigint
  from public.event_registrations er
  where er.event_id = p_event_id;
$$;

revoke all on function public.create_event_manual_registration_secure(
  uuid, uuid, uuid, text, text, text, text, integer, numeric, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_event_manual_registration_secure(
  uuid, uuid, uuid, text, text, text, text, integer, numeric, uuid, text
) to service_role;

revoke all on function public.expire_event_manual_holds_secure(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_event_manual_holds_secure(uuid)
  to service_role;

revoke all on function public.review_event_manual_payment_secure(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_event_manual_payment_secure(uuid, uuid, text, text)
  to service_role;

revoke all on function public.record_event_checkin_secure(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_event_checkin_secure(uuid, uuid, integer, text)
  to service_role;

revoke all on function public.get_event_operation_summary_secure(uuid)
  from public, anon, authenticated;
grant execute on function public.get_event_operation_summary_secure(uuid)
  to service_role;

commit;

select
  to_regprocedure('public.create_event_manual_registration_secure(uuid,uuid,uuid,text,text,text,text,integer,numeric,uuid,text)') as manual_registration_function,
  to_regprocedure('public.expire_event_manual_holds_secure(uuid)') as expiry_function,
  to_regprocedure('public.review_event_manual_payment_secure(uuid,uuid,text,text)') as manual_review_function,
  to_regprocedure('public.record_event_checkin_secure(uuid,uuid,integer,text)') as checkin_function,
  to_regprocedure('public.get_event_operation_summary_secure(uuid)') as summary_function,
  to_regclass('public.idx_event_manual_payments_review') as review_index;
