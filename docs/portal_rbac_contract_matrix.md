# Portal RBAC Contract Matrix

Fecha: 2026-07-15
Estado: Activo; catálogo compartido por backend y directorio de usuarios

## Objetivo

Definir una fuente de verdad para permisos de roles del portal sin romper compatibilidad.
Este contrato se implementa en `src/lib/portalRbac.ts`. `PORTAL_ROLE_DEFINITIONS` es la fuente de verdad para orden, etiqueta, alcance y modalidad de asignación. No se deben crear listas manuales de roles en páginas o scripts.

## Scope por rol

| Rol | Scope |
| --- | --- |
| `user` | `self` |
| `campus_missionary` | `self` |
| `pastor` | `church` |
| `local_collaborator` | `church` |
| `leader` | `church` |
| `regional_pastor` | `region` |
| `regional_collaborator` | `region` |
| `national_pastor` | `country` |
| `national_collaborator` | `country` |
| `finance` | `global` por rol principal; alcance efectivo mediante asignaciones global/nacional/regional/local |
| `intercessor` | `global` como responsabilidad adicional compatible |
| `admin` | `global` |
| `superadmin` | `global` |

## Capacidades por rol (fase 1)

| Rol | Gestiona usuarios scoped | Crea usuarios de plataforma | Invita/inscribe personas | Eventos local | Eventos regional | Eventos nacional | Eventos global | Finanzas | Campus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `user` | no | no | no | no | no | no | no | no | no |
| `campus_missionary` | no | no | no | no | no | no | no | no | si |
| `local_collaborator` | si | no | si | no | no | no | no | no | no |
| `leader` | si | no | si | no | no | no | no | no | no |
| `pastor` | si | si | si | si | no | no | no | no | no |
| `regional_collaborator` | si | no | si | no | no | no | no | no | no |
| `regional_pastor` | si | si | si | si | si | no | no | no | no |
| `national_collaborator` | si | no | si | no | no | no | no | no | no |
| `national_pastor` | si | si | si | si | si | si | no | no | no |
| `admin` | si | si | si | si | si | si | si | si | si |
| `superadmin` | si | si | si | si | si | si | si | si | si |
| `finance` | no | no | no | no | no | no | no | si, según asignaciones | si, según asignaciones |
| `intercessor` | no | no | no | no | no | no | no | no | no |

## Reglas de creacion de rol (fase 1)

| Creador | Puede crear |
| --- | --- |
| `superadmin` | todos los roles activos; `leader` queda solo para compatibilidad histórica |
| `admin` | todos los roles activos excepto `admin` y `superadmin`; Finanzas requiere además superadmin en la operación sensible |
| `national_pastor` | `national_collaborator`, `regional_pastor`, `regional_collaborator`, `pastor`, `local_collaborator`, `user` |
| `regional_pastor` | `regional_collaborator`, `pastor`, `local_collaborator`, `user` |
| `pastor` | `local_collaborator`, `user` |
| `national_collaborator` | ninguno |
| `regional_collaborator` | ninguno |
| `local_collaborator` | ninguno |
| `leader` | ninguno |

## Reglas de scope obligatorias

1. Todo rol `church` requiere `church_id` o `portal_church_id`.
2. Todo rol `region` requiere `region_id`.
3. Todo rol `country` requiere `country`.
4. El país se selecciona del catálogo derivado de iglesias y regiones activas; no se admite texto libre.
5. La selección territorial sigue país → región → iglesia y cada paso filtra el siguiente.
6. Para creaciones desde pastor/regional/nacional, la entidad creada debe quedar dentro de su scope.
7. `admin` no crea `admin` ni `superadmin`; solo `superadmin` puede hacerlo.
8. Finanzas puede coexistir con el rol pastoral mediante `portal_role_assignments`; no se reemplaza el rol pastoral para conceder acceso financiero.

## Cambios aplicados en fase 1 (backend)

1. Colaboradores y `leader` ya no pueden crear usuarios de plataforma.
2. Invitaciones/inscripciones se controlan con permiso de registro de personas (`can_register_people`), no con permiso de crear usuarios de plataforma.
3. Endpoints endurecidos:
   - `src/pages/api/portal/admin/users/create.ts`
   - `src/pages/api/portal/iglesia/invite.ts`

## Cambios aplicados en fase 7 (eliminacion de cuenta)

1. Endpoint de autoservicio: `src/pages/api/cuenta/eliminar.ts`.
2. Sesiones bloqueadas para usuarios baneados en `getUserFromRequest`.
3. Estado diferenciado `deleted` en listado de usuarios para distinguirlo de `blocked`.
4. Guardrail: no reenviar recovery automático a cuentas eliminadas por autoservicio.
5. Auditoria operativa: `docs/sql/portal_account_deletion_audit.sql`.

## Reglas visuales transversales

1. El espaciado usa `docs/SPACING_CONTRACT.md` y tokens base 8.
2. `npm run test:spacing` impide agregar deuda nueva de `padding`, `margin` o `gap`.
3. La jerarquía de filtros reutilizable es país → región → iglesia; no se muestran listas planas interminables.

## Siguientes fases

1. Migrar filtros secundarios restantes al catálogo compartido.
2. Convertir tablas operativas extensas en una lista reutilizable con filtros, paginación y tarjetas móviles.
3. Automatizar ejecución periódica de auditorías SQL de RBAC y eliminación.
