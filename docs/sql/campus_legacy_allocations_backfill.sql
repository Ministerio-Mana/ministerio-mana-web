-- Campus Mana: recupera asignaciones historicas guardadas en raw_event.
-- Idempotente. No divide ni inventa montos: solo usa allocations[].amount
-- o amountPerMissionary/amount_per_missionary cuando fueron guardados.

begin;

with campus_rows as (
  select
    donation.id as donation_id,
    donation.currency,
    donation.raw_event,
    case
      when jsonb_typeof(donation.raw_event -> 'missionaryMatches') = 'array'
        then donation.raw_event -> 'missionaryMatches'
      else '[]'::jsonb
    end as matches,
    case
      when jsonb_typeof(donation.raw_event -> 'missionaries') = 'array'
        then donation.raw_event -> 'missionaries'
      else '[]'::jsonb
    end as missionaries,
    case
      when jsonb_typeof(donation.raw_event -> 'allocations') = 'array'
        then donation.raw_event -> 'allocations'
      else '[]'::jsonb
    end as allocations
  from public.donations donation
  where donation.raw_event is not null
    and (
      donation.donation_type = 'campus'
      or donation.source ilike '%campus%'
      or donation.campus ilike '%Campus%'
      or donation.project_name ilike 'campus-multi:%'
    )
),
raw_candidates as (
  select
    row.donation_id,
    row.currency,
    row.raw_event,
    row.allocations,
    nullif(trim(match_item ->> 'slug'), '') as missionary_slug,
    nullif(trim(match_item ->> 'name'), '') as raw_missionary_name
  from campus_rows row
  cross join lateral jsonb_array_elements(row.matches) match_item

  union all

  select
    row.donation_id,
    row.currency,
    row.raw_event,
    row.allocations,
    nullif(trim(case
      when jsonb_typeof(missionary_item) = 'string' then missionary_item #>> '{}'
      when jsonb_typeof(missionary_item) = 'object' then missionary_item ->> 'slug'
      else null
    end), '') as missionary_slug,
    nullif(trim(case
      when jsonb_typeof(missionary_item) = 'object' then missionary_item ->> 'name'
      else null
    end), '') as raw_missionary_name
  from campus_rows row
  cross join lateral jsonb_array_elements(row.missionaries) missionary_item
),
deduplicated_candidates as (
  select
    candidate.donation_id,
    candidate.currency,
    candidate.raw_event,
    candidate.allocations,
    candidate.missionary_slug,
    max(candidate.raw_missionary_name) as raw_missionary_name
  from raw_candidates candidate
  where candidate.missionary_slug is not null
  group by
    candidate.donation_id,
    candidate.currency,
    candidate.raw_event,
    candidate.allocations,
    candidate.missionary_slug
),
canonical_missionaries(missionary_slug, missionary_name) as (
  values
    ('amaury-padilla', 'Amaury Padilla'),
    ('ariel-guzman', 'Ariel Guzman'),
    ('leidy-gaviria', 'Leidy Gaviria'),
    ('maria-camila-rios', 'Maria Camila Rios'),
    ('oscar-hernandez', 'Oscar Hernandez'),
    ('rocio-nino', 'Rocio Nino')
),
resolved as (
  select
    candidate.donation_id,
    candidate.missionary_slug,
    coalesce(
      candidate.raw_missionary_name,
      canonical.missionary_name,
      candidate.missionary_slug
    ) as missionary_name,
    profile.user_id as missionary_id,
    coalesce(
      (
        select case
          when coalesce(allocation_item ->> 'amount', '') ~ '^[0-9]+([.][0-9]+)?$'
            then (allocation_item ->> 'amount')::numeric
          else null
        end
        from jsonb_array_elements(candidate.allocations) allocation_item
        where allocation_item ->> 'slug' = candidate.missionary_slug
        limit 1
      ),
      case
        when coalesce(candidate.raw_event ->> 'amountPerMissionary', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.raw_event ->> 'amountPerMissionary')::numeric
        else null
      end,
      case
        when coalesce(candidate.raw_event ->> 'amount_per_missionary', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.raw_event ->> 'amount_per_missionary')::numeric
        else null
      end
    ) as amount,
    candidate.currency
  from deduplicated_candidates candidate
  left join canonical_missionaries canonical
    on canonical.missionary_slug = candidate.missionary_slug
  left join public.user_profiles profile
    on profile.role = 'campus_missionary'
    and profile.campus_missionary_slug = candidate.missionary_slug
),
upserted as (
  insert into public.campus_donation_allocations (
    donation_id,
    missionary_slug,
    missionary_name,
    missionary_id,
    amount,
    currency
  )
  select
    resolved.donation_id,
    resolved.missionary_slug,
    resolved.missionary_name,
    resolved.missionary_id,
    resolved.amount,
    resolved.currency
  from resolved
  where resolved.amount > 0
  on conflict (donation_id, missionary_slug) do update
  set
    missionary_name = excluded.missionary_name,
    missionary_id = coalesce(excluded.missionary_id, public.campus_donation_allocations.missionary_id),
    amount = case
      when public.campus_donation_allocations.amount <= 0 then excluded.amount
      else public.campus_donation_allocations.amount
    end,
    currency = coalesce(public.campus_donation_allocations.currency, excluded.currency)
  returning donation_id, missionary_slug
)
select count(*) as allocations_inserted_or_verified
from upserted;

commit;

-- Verificacion por misionero. raw_mentions cuenta donaciones que nombran el slug;
-- allocations_count cuenta filas normalizadas y linked_count las enlazadas al usuario.
with missionary_accounts(email, missionary_slug) as (
  values
    ('amaury.padilla@ministeriomana.org', 'amaury-padilla'),
    ('arielguzman@ministeriomana.org', 'ariel-guzman'),
    ('leidy.gaviria@ministeriomana.org', 'leidy-gaviria'),
    ('camila@ministeriomana.org', 'maria-camila-rios'),
    ('oscar.hernandez@ministeriomana.org', 'oscar-hernandez'),
    ('campusuniversitario@ministeriomana.org', 'rocio-nino')
),
raw_mentions as (
  select
    account.missionary_slug,
    count(distinct donation.id) as raw_mentions
  from missionary_accounts account
  left join public.donations donation
    on donation.raw_event @> jsonb_build_object(
      'missionaries', jsonb_build_array(account.missionary_slug)
    )
    or donation.raw_event @> jsonb_build_object(
      'missionaryMatches', jsonb_build_array(jsonb_build_object('slug', account.missionary_slug))
    )
  group by account.missionary_slug
)
select
  account.email,
  account.missionary_slug,
  profile.user_id,
  raw.raw_mentions,
  count(allocation.id) as allocations_count,
  count(allocation.id) filter (where allocation.missionary_id = profile.user_id) as linked_count
from missionary_accounts account
left join public.user_profiles profile
  on lower(profile.email) = lower(account.email)
left join raw_mentions raw
  on raw.missionary_slug = account.missionary_slug
left join public.campus_donation_allocations allocation
  on allocation.missionary_slug = account.missionary_slug
group by account.email, account.missionary_slug, profile.user_id, raw.raw_mentions
order by account.missionary_slug;

-- Si esta consulta devuelve filas, esas donaciones no guardaron un monto explicito
-- suficiente para reconstruirlas con seguridad. No se modifican automaticamente.
with campus_rows as (
  select
    donation.id,
    donation.reference,
    donation.created_at,
    donation.raw_event,
    case
      when jsonb_typeof(donation.raw_event -> 'missionaries') = 'array'
        then donation.raw_event -> 'missionaries'
      else '[]'::jsonb
    end as missionaries
  from public.donations donation
  where donation.raw_event is not null
    and (
      donation.donation_type = 'campus'
      or donation.source ilike '%campus%'
      or donation.campus ilike '%Campus%'
      or donation.project_name ilike 'campus-multi:%'
    )
)
select
  row.id as donation_id,
  row.reference,
  row.created_at,
  row.missionaries
from campus_rows row
where jsonb_array_length(row.missionaries) > 0
  and not (
    coalesce(row.raw_event ->> 'amountPerMissionary', '') ~ '^[0-9]+([.][0-9]+)?$'
    or coalesce(row.raw_event ->> 'amount_per_missionary', '') ~ '^[0-9]+([.][0-9]+)?$'
    or jsonb_typeof(row.raw_event -> 'allocations') = 'array'
  )
order by row.created_at desc;
