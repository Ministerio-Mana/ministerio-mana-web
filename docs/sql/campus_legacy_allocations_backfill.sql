-- Campus Mana: recupera asignaciones historicas sin duplicar donaciones.
-- Usa montos explicitos; solo divide el total en registros anteriores al
-- 16-may-2026, cuando el formulario obligaba a usar el mismo monto para todos.

begin;

with canonical(missionary_slug, missionary_name) as (
  values
    ('amaury-padilla', 'Amaury Padilla'),
    ('ariel-guzman', 'Ariel Guzmán'),
    ('leidy-gaviria', 'Leidy Gaviria'),
    ('maria-camila-rios', 'María Camila Ríos'),
    ('oscar-hernandez', 'Óscar Hernández'),
    ('rocio-nino', 'Rocío Niño')
),
campus_rows as (
  select
    donation.id,
    donation.created_at,
    donation.amount as total_amount,
    donation.currency,
    donation.project_name,
    donation.raw_event,
    case
      when jsonb_typeof(donation.raw_event -> 'allocations') = 'array'
        then donation.raw_event -> 'allocations'
      else '[]'::jsonb
    end as allocations,
    case
      when jsonb_typeof(donation.raw_event -> 'missionaryMatches') = 'array'
        then donation.raw_event -> 'missionaryMatches'
      else '[]'::jsonb
    end as matches,
    case
      when jsonb_typeof(donation.raw_event -> 'missionaries') = 'array'
        then donation.raw_event -> 'missionaries'
      else '[]'::jsonb
    end as missionaries
  from public.donations donation
  where donation.donation_type = 'campus'
     or donation.source ilike '%campus%'
     or donation.campus ilike '%Campus%'
     or donation.project_name ilike 'campus-multi:%'
),
raw_candidates as (
  select row.*, nullif(trim(match_item ->> 'slug'), '') as missionary_slug
  from campus_rows row
  cross join lateral jsonb_array_elements(row.matches) match_item

  union all

  select row.*, nullif(trim(case
    when jsonb_typeof(missionary_item) = 'string' then missionary_item #>> '{}'
    when jsonb_typeof(missionary_item) = 'object' then missionary_item ->> 'slug'
    else null
  end), '') as missionary_slug
  from campus_rows row
  cross join lateral jsonb_array_elements(row.missionaries) missionary_item

  union all

  select row.*, nullif(trim(project_slug), '') as missionary_slug
  from campus_rows row
  cross join lateral unnest(string_to_array(
    substring(row.project_name from length('campus-multi:') + 1),
    ','
  )) project_slug
  where row.project_name ilike 'campus-multi:%'
),
deduplicated as (
  select distinct on (candidate.id, candidate.missionary_slug)
    candidate.*
  from raw_candidates candidate
  join canonical
    on canonical.missionary_slug = candidate.missionary_slug
  where candidate.missionary_slug is not null
  order by candidate.id, candidate.missionary_slug
),
resolved as (
  select
    candidate.*,
    canonical.missionary_name,
    profile.user_id as missionary_id,
    count(*) over (partition by candidate.id) as missionary_count,
    coalesce(
      (
        select (allocation_item ->> 'amount')::numeric
        from jsonb_array_elements(candidate.allocations) allocation_item
        where allocation_item ->> 'slug' = candidate.missionary_slug
          and coalesce(allocation_item ->> 'amount', '') ~ '^[0-9]+([.][0-9]+)?$'
        limit 1
      ),
      (
        select trim(split_part(summary_item, ':', 2))::numeric
        from regexp_split_to_table(
          coalesce(candidate.raw_event #>> '{metadata,allocation_summary}', ''),
          ','
        ) summary_item
        where trim(split_part(summary_item, ':', 1)) = candidate.missionary_slug
          and trim(split_part(summary_item, ':', 2)) ~ '^[0-9]+([.][0-9]+)?$'
        limit 1
      ),
      case
        when coalesce(candidate.raw_event ->> 'amountPerMissionary', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.raw_event ->> 'amountPerMissionary')::numeric
      end,
      case
        when coalesce(candidate.raw_event #>> '{metadata,amount_per_missionary}', '') ~ '^[0-9]+([.][0-9]+)?$'
          then (candidate.raw_event #>> '{metadata,amount_per_missionary}')::numeric
      end
    ) as explicit_amount
  from deduplicated candidate
  join canonical
    on canonical.missionary_slug = candidate.missionary_slug
  left join public.user_profiles profile
    on profile.role = 'campus_missionary'
    and profile.campus_missionary_slug = candidate.missionary_slug
),
ready as (
  select
    resolved.id as donation_id,
    resolved.missionary_slug,
    resolved.missionary_name,
    resolved.missionary_id,
    coalesce(
      resolved.explicit_amount,
      case
        when resolved.created_at < '2026-05-16T05:36:49Z'::timestamptz
          and resolved.missionary_count > 0
          then round(
            resolved.total_amount / resolved.missionary_count,
            case when resolved.currency = 'USD' then 2 else 0 end
          )
      end
    ) as allocation_amount,
    resolved.currency
  from resolved
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
    ready.donation_id,
    ready.missionary_slug,
    ready.missionary_name,
    ready.missionary_id,
    ready.allocation_amount,
    ready.currency
  from ready
  where ready.allocation_amount > 0
  on conflict (donation_id, missionary_slug) do update
  set
    missionary_id = coalesce(excluded.missionary_id, public.campus_donation_allocations.missionary_id),
    amount = case
      when public.campus_donation_allocations.amount <= 0 then excluded.amount
      else public.campus_donation_allocations.amount
    end
  returning donation_id, missionary_slug
)
select count(*) as allocations_inserted_or_verified
from upserted;

commit;

-- Resultado esperado: Amaury y los demas deben tener allocations_count > 0,
-- y allocations_count debe ser igual a linked_count.
with accounts(email, missionary_slug) as (
  values
    ('amaury.padilla@ministeriomana.org', 'amaury-padilla'),
    ('arielguzman@ministeriomana.org', 'ariel-guzman'),
    ('leidy.gaviria@ministeriomana.org', 'leidy-gaviria'),
    ('camila@ministeriomana.org', 'maria-camila-rios'),
    ('oscar.hernandez@ministeriomana.org', 'oscar-hernandez'),
    ('campusuniversitario@ministeriomana.org', 'rocio-nino')
)
select
  account.email,
  account.missionary_slug,
  count(allocation.id) as allocations_count,
  count(allocation.id) filter (
    where allocation.missionary_id = profile.user_id
  ) as linked_count
from accounts account
left join public.user_profiles profile
  on lower(profile.email) = lower(account.email)
left join public.campus_donation_allocations allocation
  on allocation.missionary_slug = account.missionary_slug
group by account.email, account.missionary_slug
order by account.missionary_slug;

-- Debe devolver 0 filas. Si devuelve alguna, no se inventa su distribucion.
select
  donation.id as donation_id,
  donation.created_at,
  donation.amount,
  donation.currency,
  donation.project_name
from public.donations donation
where donation.project_name ilike '%amaury-padilla%'
  and donation.status in ('APPROVED', 'PAID')
  and not exists (
    select 1
    from public.campus_donation_allocations allocation
    where allocation.donation_id = donation.id
      and allocation.missionary_slug = 'amaury-padilla'
  )
order by donation.created_at desc;
