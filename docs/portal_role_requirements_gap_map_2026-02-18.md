# Portal Roles: Requerimiento Completo y Gap Map (2026-02-18)

## Alcance
Este documento traduce el requerimiento funcional completo de roles/permisos, UX de usuario, eventos y suscripciones a un modelo tecnico implementable sin romper produccion.

## Modelo Canonico de Roles (Objetivo)
Roles base:
- `user`
- `local_collaborator`
- `pastor` (pastor local)
- `regional_collaborator` (nuevo)
- `regional_pastor` (nuevo)
- `national_collaborator` (nuevo)
- `national_pastor`
- `campus_missionary`
- `admin`
- `superadmin`

## Reglas de Scope (Obligatorias)
- `user`: self scope.
- `local_collaborator`, `pastor`: `church_id` obligatorio.
- `regional_collaborator`, `regional_pastor`: `region_id` obligatorio.
- `national_collaborator`, `national_pastor`: `country` obligatorio.
- `admin`, `superadmin`: global.
- Todo usuario creado por un rol pastoral/colaborador debe quedar vinculado a ciudad + iglesia.
- Un colaborador no puede tener scope mayor al del pastor que lo delega.

## Matriz de Permisos (Objetivo)
| Rol | Ver su perfil/aportes | Ver usuarios | Crear usuarios | Gestionar eventos | Inscribir personas en eventos | Finanzas globales | Campus |
| --- | --- | --- | --- | --- | --- | --- | --- |
| user | Si | No | No | No | Solo su propia inscripcion | No | Solo sus propios datos si aplica |
| local_collaborator | Si | Iglesia | Iglesia (solo `user`) | No | Iglesia | No | No |
| pastor | Si | Iglesia | Iglesia (`user`, `local_collaborator`) | LOCAL | Iglesia | No | No |
| regional_collaborator | Si | Region | Region (solo `user`) | No | Region | No | No |
| regional_pastor | Si | Region | Region (`user`, `regional_collaborator`, locales) | REGIONAL | Region | No | No |
| national_collaborator | Si | Pais | Pais (solo `user`) | No | Pais | No | No |
| national_pastor | Si | Pais | Pais (`user`, `national_collaborator`, regional/local) | NATIONAL | Pais | No | No |
| campus_missionary | Si | No (excepto modulo campus) | No | No | No | No | Si (scope campus) |
| admin | Si | Global | Global (excepto crear admin/superadmin) | GLOBAL + todos | Global | Si | Si |
| superadmin | Si | Global | Global total | GLOBAL + todos | Global | Si | Si |

## Diferencias Clave Pedidas por Negocio
- Pastores y colaboradores no deben ver modulo `finanzas` global ni modulo `campus`.
- `admin` si puede ver y gestionar `finanzas` + `campus`.
- `superadmin` puede crear/gestionar admins.
- `admin` no puede crear admins.

## Flujo de Usuarios Creados desde Eventos (Cumbre y otros)
Objetivo:
- Si se inscribe alguien en Cumbre/Evento y aun no tiene cuenta, se crea/actualiza perfil base con datos de identidad.
- Queda en estado "perfil listo, cuenta por activar".
- Se envia email de activacion para que configure contraseña.
- En siguientes eventos, si usuario esta autenticado, usar datos existentes y evitar re-pedir documento/telefono.

## Reutilizacion de Identidad (Fallback)
Orden de resolucion recomendado:
1. `user_id` autenticado.
2. `document_type + document_number`.
3. `email` normalizado.
Si hay match, se reusa perfil existente y se autocompleta.

## Suscripciones y Pagos Recurrentes (Objetivo UX)
Para `user`:
- Ver estado actual, proximo cobro y historial.
- `pause`, `resume`, `cancel`.
- Re-activar una suscripcion cancelada con confirmacion.
- Modificar monto al reactivar (diezmo/campus).
- Mover fecha de cobro cuando aplique.

Regla Cumbre:
- Permitir mover fecha de cuota solo dentro de ventana permitida (hasta fecha limite del evento).

## Eliminacion de Cuenta (Objetivo)
- Flujo con doble confirmacion.
- Requerir escribir `ELIMINAR` para confirmar.
- Soft delete funcional en producto.
- Mantener datos requeridos por retencion contable/auditoria segun politica.

## Estado Actual vs Objetivo (Gap)
| Tema | Estado actual | Gap |
| --- | --- | --- |
| Roles regionales (`regional_*`) | No existen | Missing |
| Scope regional en schema | No existe | Missing |
| Eventos `REGIONAL` | No existe (`GLOBAL/NATIONAL/LOCAL`) | Missing |
| Rol efectivo por membership fallback | Existe en multiples endpoints | Partial (duplicado/inconsistente) |
| Finanzas bloqueadas para pastores | Backend permite pastor/leader | Gap critico |
| Campus restringido a roles correctos | Parcialmente correcto | Partial |
| Crear usuarios con jerarquia | Existe | Partial (sin regional y con reglas dispersas) |
| Cambiar rol consistente con creacion | Inconsistente | Gap |
| Pausar/reanudar suscripciones | Existe | Partial (falta reprogramar fecha) |
| Pausar/reanudar cuotas Cumbre | Existe | Partial (falta mover fecha usuario) |
| Eliminar cuenta | No existe | Missing |
| Reuso de identidad entre eventos y pagos | Parcial por email | Partial |

## Plan de Implementacion por Fases (Sin Romper)
Fase 0:
- Mantener auditorias SQL activas y baseline de seguridad/logs.

Fase 1:
- Centralizar autorizacion (`effectiveRole + scope`) en helper unico.
- Alinear checks backend/frontend al helper.

Fase 2:
- Migracion schema no destructiva:
  - `regions`.
  - `churches.region_id`.
  - `user_profiles.region_id`.
- Sin quitar columnas actuales.

Fase 3:
- Introducir roles `regional_*` y `national_collaborator`.
- Actualizar create/list/update role con jerarquia final.

Fase 4:
- Extender eventos con scope `REGIONAL`.
- Aplicar filtros por region/pais/iglesia en lectura/escritura.

Fase 5:
- Flujo de "perfil preparado" para inscritos sin cuenta.
- Activacion por email y autocompletado por identidad en eventos futuros.

Fase 6:
- UX de suscripciones: pause/resume/cancel/reprogramacion (con guardrails por producto).

Fase 7:
- Eliminacion de cuenta (soft-delete + politica de retencion).

## Criterios de Aceptacion Minimos
- Ningun pastor/colaborador ve finanzas globales.
- Colaborador local no puede crear/editar eventos.
- Pastor local solo puede gestionar su iglesia.
- Pastor regional solo su region.
- Pastor nacional solo su pais.
- Admin no crea admin; superadmin si.
- Usuario no reingresa documento si ya existe perfil validado.
