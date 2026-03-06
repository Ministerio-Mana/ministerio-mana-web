-- Supabase Security Advisor - Remediacion segura (sin romper)
-- Fecha: 2026-02-25
-- Uso: SQL Editor (produccion) con rol admin/postgres.
-- Objetivo:
-- 1) Corregir los hallazgos del Security Advisor con riesgo minimo.
-- 2) Ejecutar por fases para poder validar entre cada paso.
-- 3) Mantener compatibilidad con APIs server-side (service_role).
--
-- Hallazgos objetivo (captura usuario):
-- - SECURITY DEFINER VIEW:
--   public.v_wompi_platform_daily_gross
--   public.v_wompi_bank_reconciliation_daily
--   public.v_wompi_platform_transactions
-- - RLS Disabled in Public:
--   public.regions
--   public.wompi_bank_settlement_lines
--   public.region_leadership_assignments
--   public.portal_profile_bootstrap_queue
--   public.portal_profile_bootstrap_queue_backup

-- =========================================================
-- FASE 0) Diagnostico SOLO lectura (ejecutar primero)
-- =========================================================

-- 0.1) Estado de vistas (security_invoker)
select
  n.nspname as schema_name,
  c.relname as view_name,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in (
    'v_wompi_platform_daily_gross',
    'v_wompi_bank_reconciliation_daily',
    'v_wompi_platform_transactions'
  )
order by c.relname;

-- 0.2) Estado RLS de tablas reportadas
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'regions',
    'wompi_bank_settlement_lines',
    'region_leadership_assignments',
    'portal_profile_bootstrap_queue',
    'portal_profile_bootstrap_queue_backup'
  )
order by c.relname;

-- 0.3) Grants actuales de anon/authenticated/service_role
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'v_wompi_platform_daily_gross',
    'v_wompi_bank_reconciliation_daily',
    'v_wompi_platform_transactions',
    'regions',
    'wompi_bank_settlement_lines',
    'region_leadership_assignments',
    'portal_profile_bootstrap_queue',
    'portal_profile_bootstrap_queue_backup'
  )
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;


-- =========================================================
-- FASE 1) Vistas Wompi: quitar SECURITY DEFINER (bajo riesgo)
-- Ejecutar y validar en Security Advisor antes de seguir.
-- =========================================================

-- 1.1) Cambiar a security_invoker=true
alter view if exists public.v_wompi_platform_transactions set (security_invoker = true);
alter view if exists public.v_wompi_platform_daily_gross set (security_invoker = true);
alter view if exists public.v_wompi_bank_reconciliation_daily set (security_invoker = true);

-- 1.2) Endurecer grants (solo backend con service_role)
do $$
begin
  if to_regclass('public.v_wompi_platform_transactions') is not null then
    execute 'revoke all on table public.v_wompi_platform_transactions from anon, authenticated';
    execute 'grant select on table public.v_wompi_platform_transactions to service_role';
  end if;

  if to_regclass('public.v_wompi_platform_daily_gross') is not null then
    execute 'revoke all on table public.v_wompi_platform_daily_gross from anon, authenticated';
    execute 'grant select on table public.v_wompi_platform_daily_gross to service_role';
  end if;

  if to_regclass('public.v_wompi_bank_reconciliation_daily') is not null then
    execute 'revoke all on table public.v_wompi_bank_reconciliation_daily from anon, authenticated';
    execute 'grant select on table public.v_wompi_bank_reconciliation_daily to service_role';
  end if;
end
$$;

-- 1.3) Cerrar grants peligrosos en tablas sensibles (sin depender solo de RLS)
do $$
begin
  if to_regclass('public.wompi_bank_settlement_lines') is not null then
    execute 'revoke all on table public.wompi_bank_settlement_lines from anon, authenticated';
    execute 'grant all on table public.wompi_bank_settlement_lines to service_role';
  end if;

  if to_regclass('public.portal_profile_bootstrap_queue') is not null then
    execute 'revoke all on table public.portal_profile_bootstrap_queue from anon, authenticated';
    execute 'grant all on table public.portal_profile_bootstrap_queue to service_role';
  end if;

  if to_regclass('public.portal_profile_bootstrap_queue_backup') is not null then
    execute 'revoke all on table public.portal_profile_bootstrap_queue_backup from anon, authenticated';
    execute 'grant all on table public.portal_profile_bootstrap_queue_backup to service_role';
  end if;

  if to_regclass('public.region_leadership_assignments') is not null then
    execute 'revoke all on table public.region_leadership_assignments from anon, authenticated';
    execute 'grant all on table public.region_leadership_assignments to service_role';
  end if;

  if to_regclass('public.regions') is not null then
    execute 'revoke all on table public.regions from anon, authenticated';
    execute 'grant all on table public.regions to service_role';
    -- Se conserva lectura autenticada de catalogo de regiones (con RLS en FASE 3).
    execute 'grant select on table public.regions to authenticated';
  end if;
end
$$;


-- =========================================================
-- FASE 2) Activar RLS en tablas privadas/operativas (bajo riesgo)
-- NOTA: service_role bypassa RLS, pero igual dejamos policy explicita.
-- =========================================================

alter table if exists public.wompi_bank_settlement_lines enable row level security;
alter table if exists public.portal_profile_bootstrap_queue enable row level security;
alter table if exists public.portal_profile_bootstrap_queue_backup enable row level security;

-- Policy helper (idempotente)
do $$
begin
  if to_regclass('public.wompi_bank_settlement_lines') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'wompi_bank_settlement_lines'
        and policyname = 'service_role_all_wompi_bank_settlement_lines'
    ) then
      create policy service_role_all_wompi_bank_settlement_lines
        on public.wompi_bank_settlement_lines
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;

  if to_regclass('public.portal_profile_bootstrap_queue') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'portal_profile_bootstrap_queue'
        and policyname = 'service_role_all_portal_profile_bootstrap_queue'
    ) then
      create policy service_role_all_portal_profile_bootstrap_queue
        on public.portal_profile_bootstrap_queue
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;

  if to_regclass('public.portal_profile_bootstrap_queue_backup') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'portal_profile_bootstrap_queue_backup'
        and policyname = 'service_role_all_portal_profile_bootstrap_queue_backup'
    ) then
      create policy service_role_all_portal_profile_bootstrap_queue_backup
        on public.portal_profile_bootstrap_queue_backup
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;
end
$$;


-- =========================================================
-- FASE 3) Activar RLS en tablas RBAC (validar despues de cada tabla)
-- =========================================================

alter table if exists public.regions enable row level security;
alter table if exists public.region_leadership_assignments enable row level security;

do $$
begin
  if to_regclass('public.regions') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'regions'
        and policyname = 'service_role_all_regions'
    ) then
      create policy service_role_all_regions
        on public.regions
        for all
        to service_role
        using (true)
        with check (true);
    end if;

    -- Opcional: lectura publica autenticada de catalogo de regiones
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'regions'
        and policyname = 'authenticated_read_regions'
    ) then
      create policy authenticated_read_regions
        on public.regions
        for select
        to authenticated
        using (is_active = true);
    end if;
  end if;

  if to_regclass('public.region_leadership_assignments') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'region_leadership_assignments'
        and policyname = 'service_role_all_region_leadership_assignments'
    ) then
      create policy service_role_all_region_leadership_assignments
        on public.region_leadership_assignments
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;
end
$$;


-- =========================================================
-- FASE 4) Verificacion final
-- =========================================================

-- 4.1) Verificar que Advisor deberia quedar limpio para estos items
select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind,
  c.reloptions,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'v_wompi_platform_daily_gross',
    'v_wompi_bank_reconciliation_daily',
    'v_wompi_platform_transactions',
    'regions',
    'wompi_bank_settlement_lines',
    'region_leadership_assignments',
    'portal_profile_bootstrap_queue',
    'portal_profile_bootstrap_queue_backup'
  )
order by c.relkind, c.relname;

-- 4.2) Policies creadas
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'regions',
    'wompi_bank_settlement_lines',
    'region_leadership_assignments',
    'portal_profile_bootstrap_queue',
    'portal_profile_bootstrap_queue_backup'
  )
order by tablename, policyname;


-- =========================================================
-- ROLLBACK RAPIDO (usar solo si detectas impacto)
-- =========================================================
-- alter table public.regions disable row level security;
-- alter table public.region_leadership_assignments disable row level security;
-- alter table public.wompi_bank_settlement_lines disable row level security;
-- alter table public.portal_profile_bootstrap_queue disable row level security;
-- alter table public.portal_profile_bootstrap_queue_backup disable row level security;
--
-- alter view public.v_wompi_platform_transactions set (security_invoker = false);
-- alter view public.v_wompi_platform_daily_gross set (security_invoker = false);
-- alter view public.v_wompi_bank_reconciliation_daily set (security_invoker = false);
