# Portal Iglesias - Cumbre 2026

## Objetivo
Portal para pastores/encargados de iglesias que registran inscripciones y abonos sin pasarela.

## Acceso
- Ruta principal: `/portal` (alias legacy: `/cuenta`).
- Login por OTP (Supabase).
- Superadmines definidos en `PORTAL_SUPERADMIN_EMAILS`.
- Membresias por iglesia en `church_memberships`.

## SQL
Ejecutar:
- `docs/sql/portal_iglesias.sql`

## Roles
- `superadmin`: acceso total.
- `admin`: acceso global (sin superpoderes).
- `church_admin`: administra su iglesia.
- `church_member`: solo puede registrar.

## Flujo esperado
1. Pastor se registra (OTP).
2. Superadmin aprueba y asigna a iglesia.
3. Pastor registra participantes y pagos manuales.
4. Se reflejan en export de contabilidad como "donaciones físicas cumbre 2026".

## Perfil del usuario
- Teléfono, ciudad, país, relación con Maná (local/online/none) y nombre de sede.
