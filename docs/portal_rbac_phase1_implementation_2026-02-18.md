# Portal RBAC Phase 1 - Implementacion Inicial (2026-02-18)

## Objetivo
Arrancar la convergencia al modelo de roles completo sin romper produccion.

## Cambios implementados

1. Motor de capacidades y jerarquia de roles:
- `src/lib/portalRbac.ts`
- Capabilities por rol (finanzas/campus/eventos/gestion usuarios).
- Jerarquia de `creatable roles` (admin no crea admin; superadmin si).
- Soporte de roles nuevos:
  - `regional_pastor`
  - `regional_collaborator`
  - `national_collaborator`

2. Portal auth actualizado:
- `src/lib/portalAuth.ts`
- Reconoce los roles nuevos en `PortalRole` y `resolveEffectivePortalRole`.

3. Contexto de acceso centralizado ampliado:
- `src/lib/portalAccess.ts`
- Incluye roles nacionales/regionales/leader.
- Mientras llega `region_id` productivo, regional opera en fallback por pais (country scope).

4. Session API con contrato RBAC unificado:
- `src/pages/api/portal/session.ts`
- Devuelve `effective_role`, `effective_church_id`, `scope` y `permissions` via `portalRbac`.

5. Eventos con permisos por capacidad:
- `src/pages/api/portal/events.ts`
- `GET/POST/PATCH` migrados a modelo por capacidades.
- Scope y validaciones ya no dependen de ifs aislados por rol.

6. Usuarios admin (create/list) alineados a jerarquia nueva:
- `src/pages/api/portal/admin/users/create.ts`
- `src/pages/api/portal/admin/users/list.ts`

7. Bootstrap SQL de scope regional (no destructivo):
- `docs/sql/portal_rbac_regions_bootstrap.sql`

## Nota de compatibilidad
Hasta ejecutar bootstrap regional y poblar `region_id`, los roles regionales usan fallback por pais para no dejar huecos de autorizacion.

## Siguientes pasos sugeridos
1. Ejecutar `docs/sql/portal_rbac_regions_bootstrap.sql`.
2. Poblar `regions`, `churches.region_id` y `user_profiles.region_id`.
3. Pasar de fallback por pais a enforcement por `region_id` en APIs de iglesia/eventos.
