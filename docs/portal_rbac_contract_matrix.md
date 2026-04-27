# Portal RBAC Contract Matrix

Fecha: 2026-02-19  
Estado: Activo (fases 1-7 aplicadas en backend + auditoria SQL)

## Objetivo

Definir una fuente de verdad para permisos de roles del portal sin romper compatibilidad.
Este contrato se implementa principalmente en `src/lib/portalRbac.ts`.

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

## Reglas de creacion de rol (fase 1)

| Creador | Puede crear |
| --- | --- |
| `superadmin` | todos |
| `admin` | todos excepto `admin` y `superadmin` |
| `national_pastor` | `national_collaborator`, `regional_pastor`, `regional_collaborator`, `pastor`, `local_collaborator`, `leader`, `user` |
| `regional_pastor` | `regional_collaborator`, `pastor`, `local_collaborator`, `leader`, `user` |
| `pastor` | `local_collaborator`, `leader`, `user` |
| `national_collaborator` | ninguno |
| `regional_collaborator` | ninguno |
| `local_collaborator` | ninguno |
| `leader` | ninguno |

## Reglas de scope obligatorias

1. Todo rol `church` requiere `church_id` o `portal_church_id`.
2. Todo rol `region` requiere `region_id`.
3. Todo rol `country` requiere `country`.
4. Para creaciones desde pastor/regional/nacional, la entidad creada debe quedar dentro de su scope.
5. `admin` no crea `admin` ni `superadmin`; solo `superadmin` puede hacerlo.

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

## Siguientes fases

1. Unificar todos los endpoints de usuarios/eventos con este contrato.
2. Exponer validaciones de scope en UI de admin antes de enviar.
3. Automatizar ejecucion periodica de auditorias SQL (RBAC y eliminación).
