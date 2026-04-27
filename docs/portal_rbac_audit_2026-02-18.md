# Portal RBAC Audit (2026-02-18)

## Objetivo
- Auditar el estado real de roles y permisos sin romper produccion.
- Definir un modelo objetivo para: usuario, colaborador/pastor local, colaborador/pastor regional, colaborador/pastor nacional, admin y superadmin.
- Preparar una ruta de migracion por fases, compatible con datos actuales.

## Hallazgos Clave (Estado Actual)
1. El modelo de rol global no incluye roles regionales.
   - Hoy existen: `user`, `admin`, `superadmin`, `national_pastor`, `pastor`, `local_collaborator`, `campus_missionary`, `leader`.
   - Fuente: `src/lib/portalAuth.ts`.

2. Hay inconsistencia entre endpoints de usuarios:
   - Crear usuarios permite jerarquia amplia por rol creador.
   - Cambiar rol (`/api/portal/admin/role`) para no-superadmin casi solo permite bajar a `user`.
   - Fuentes: `src/pages/api/portal/admin/users/create.ts`, `src/pages/api/portal/admin/role.ts`.

3. El modulo Finanzas backend no coincide con la regla de negocio solicitada.
   - API de finanzas permite `pastor` y `leader`, pero el requerimiento es que solo admin/superadmin vean finanzas globales.
   - Fuente: `src/pages/api/portal/finances.ts`.

4. Scopes existentes:
   - Usuario gestion por iglesia/pais/global ya funciona en varias APIs.
   - No existe scope regional nativo (ni en `events` ni en `user_profiles/churches`).
   - Fuentes: `src/pages/api/portal/events.ts`, `docs/sql/events_schema.sql`, `docs/sql/portal_iglesias.sql`.

5. Reglas de acceso replicadas en multiples endpoints/scripts (riesgo de drift).
   - El rol efectivo (fallback por membership) se recalcula de forma local en muchos archivos.
   - Fuentes: `src/pages/api/portal/admin/users/list.ts`, `src/scripts/portal-dashboard.js`, `src/scripts/portal-users.js`.

6. Session de password de mantenimiento entra como `superadmin`.
   - Util para contingencia, pero debe quedar delimitada a uso operativo controlado.
   - Fuente: `src/pages/api/portal/session.ts`.

7. Cuenta del usuario final:
   - Ya existe pausa/reanudar/cancelar para suscripciones de donacion.
   - Ya existe pausar/reanudar plan de cumbre.
   - No existe endpoint de cambio de fecha para cuota ni endpoint de eliminacion de cuenta.
   - Fuentes: `src/pages/api/portal/donations/subscriptions.ts`, `src/pages/api/cuenta/planes/pause.ts`, `src/pages/api/cuenta/planes/resume.ts`.

8. Endpoint legado de registro de evento personal parece desalineado con schema actual de cumbre.
   - Fuente: `src/pages/api/portal/eventos/my-registration.ts`.

## Modelo Objetivo de Roles (Propuesto)
- `user`: solo su informacion (perfil, aportes, suscripciones, eventos propios).
- `local_collaborator`: scope iglesia local; puede ver usuarios de su iglesia e inscribir en eventos; no crea/edita eventos.
- `pastor` (pastor local): scope iglesia local; puede gestionar eventos locales, usuarios de su iglesia e inscripciones.
- `regional_collaborator` (nuevo): scope region; apoyo operativo sin crear/editar eventos.
- `regional_pastor` (nuevo): scope region; puede gestionar eventos regionales y usuarios de su region.
- `national_collaborator` (nuevo): scope pais; apoyo operativo sin crear/editar eventos.
- `national_pastor`: scope pais; puede gestionar eventos nacionales y usuarios de su pais.
- `campus_missionary`: modulo campus (sin finanzas globales).
- `admin`: alcance global operativo, finanzas, campus, gestion de casi todos los roles excepto crear admin/superadmin.
- `superadmin`: control total, incluido crear/gestionar admins.

## Reglas de Scope (No Negociables)
- Todo usuario de tipo pastoral/colaborador debe quedar ligado a scope explicito:
  - Local: `church_id`.
  - Regional: `region_id`.
  - Nacional: `country`.
- Creacion de usuarios siempre exige scope compatible con quien crea.
- Colaborador nunca debe tener scope mas amplio que su pastor asignador.

## Matriz Operativa (Resumen)
- Ver usuarios:
  - `user`: no.
  - `local_collaborator`: iglesia.
  - `pastor`: iglesia.
  - `regional_*`: region.
  - `national_*`: pais.
  - `admin/superadmin`: global.
- Crear usuarios:
  - `pastor`: local + colaboradores locales + users locales.
  - `regional_pastor`: regional + colaboradores regionales + users regionales.
  - `national_pastor`: nacional + colaboradores nacionales + users nacionales.
  - `admin/superadmin`: segun jerarquia completa.
- Gestion de eventos:
  - `local_collaborator`: no crea/edita.
  - `pastor`: LOCAL.
  - `regional_pastor`: REGIONAL.
  - `national_pastor`: NATIONAL.
  - `admin/superadmin`: GLOBAL + todos los scopes.
- Finanzas globales:
  - Solo `admin`, `superadmin`.
- Campus:
  - `campus_missionary`, `admin`, `superadmin`.

## Plan de Implementacion (Sin Romper Nada)
### Fase 0 - Observabilidad (inmediata)
- Ejecutar auditoria SQL profunda (`docs/sql/portal_rbac_deep_audit.sql`).
- Corregir datos inconsistentes primero, sin cambiar permisos aun.

### Fase 1 - Unificar autorizacion backend
- Crear helper unico de `effectiveRole + scope`.
- Reemplazar checks duplicados endpoint por endpoint.
- Alinear backend y frontend al mismo contrato.

### Fase 2 - Agregar scope regional (schema compatible)
- Nuevas tablas/columnas: `regions`, `churches.region_id`, `user_profiles.region_id`.
- No eliminar campos actuales; migracion incremental.

### Fase 3 - Roles nuevos
- Introducir `regional_pastor`, `regional_collaborator`, `national_collaborator`.
- Extender jerarquias de creacion/edicion de usuario.

### Fase 4 - Eventos por scope regional
- Extender `event_scope` con `REGIONAL`.
- Reglas de lectura/escritura por region.

### Fase 5 - UX financiera y suscripciones de usuario
- Endpoints para cambiar fecha (dentro de reglas de negocio).
- Mantener pause/resume/cancel + historial visible.

### Fase 6 - Eliminacion de cuenta (derecho del usuario)
- Flujo con confirmacion fuerte.
- Soft-delete funcional en app + politica de retencion contable/auditoria.

## Riesgos Si No Se Ejecuta Esta Ruta
- Inconsistencia entre lo que ve el frontend y lo que realmente permite backend.
- Regresiones al parchear un endpoint y no los demas.
- Escalamiento accidental de permisos por reglas duplicadas.

## Entregable Complementario
- Query pack de auditoria avanzada: `docs/sql/portal_rbac_deep_audit.sql`.
