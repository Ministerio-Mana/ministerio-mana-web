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
- `docs/sql/update_churches_schema.sql`
- `docs/sql/churches_global_seed.sql` (nuevas sedes internacionales)

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

## Gestión de equipo (pastores y colaboradores)
- El bloque **Equipo** del portal permite invitar:
  - `church_admin` → Pastor (Admin)
  - `church_member` → Colaborador (Registrar)
- El colaborador puede crear registros manuales de participantes y abonos.
- El pastor mantiene permisos de gestión de su sede y del equipo local.

## Relación con directorio/mapa de iglesias
- El directorio público usa `src/data/churches.json`.
- El selector del portal usa la tabla `public.churches`.
- Para mantener consistencia entre ambos:
  1. Actualizar `src/data/churches.json`.
  2. Ejecutar `POST /api/portal/admin/seed-churches` (o correr seed SQL).
  3. Verificar selector de iglesias en modal de registro.

Referencia operativa: `docs/iglesias-mapas.md`.

## Perfil del usuario
- Teléfono, ciudad, país, relación con Maná (local/online/none) y nombre de sede.
