# Microsoft 365 y SharePoint - fase 1

Esta fase conecta el portal con un unico sitio privado de SharePoint mediante Microsoft Graph. No concede acceso a todos los OneDrive de la organizacion y no cambia el inicio de sesion del portal.

## Estado seguro inicial

- `MICROSOFT_GRAPH_ENABLED=false` mantiene toda la integracion apagada.
- Las credenciales viven solo en variables de servidor de Vercel.
- El diagnostico exige una cuenta individual con rol `superadmin`; la sesion administrativa compartida no sirve.
- El portal identifica el sitio por `MICROSOFT_SHAREPOINT_SITE_ID` y rechaza bibliotecas que no pertenezcan a ese sitio.
- El permiso recomendado de Microsoft Graph es `Sites.Selected` de tipo Application.

## Parte del administrador de Microsoft

1. Crear un sitio de equipo privado llamado `Portal Mana` en SharePoint.
2. En Microsoft Entra, registrar una aplicacion para este portal, de un solo tenant y sin Redirect URI.
3. Agregar el permiso Application `Sites.Selected` de Microsoft Graph y conceder consentimiento de administrador.
4. Conceder a esa aplicacion acceso `read` al sitio `Portal Mana`. Empezar en solo lectura; el permiso `write` se agrega despues de validar auditoria y roles.
5. Crear un secreto de cliente con expiracion controlada y registrar su fecha de renovacion.
6. Obtener `tenant_id`, `client_id` y el identificador compuesto del sitio de SharePoint.

No pegues secretos en SQL, GitHub, Supabase, capturas o conversaciones. El secreto se agrega directamente en Vercel.

## Variables de Vercel

Configurar solo en Production y Preview cuando correspondan:

```text
MICROSOFT_GRAPH_ENABLED=false
MICROSOFT_GRAPH_TENANT_ID=
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_CLIENT_SECRET=
MICROSOFT_SHAREPOINT_SITE_ID=
MICROSOFT_SHAREPOINT_DRIVE_ID=
MICROSOFT_SHAREPOINT_EVENTS_DRIVE_ID=
MICROSOFT_SHAREPOINT_EVENTS_WRITE_ENABLED=false
MICROSOFT_SHAREPOINT_EVENT_REGISTRATIONS_LIST_ID=
```

Primero se cargan los identificadores y el secreto manteniendo `MICROSOFT_GRAPH_ENABLED=false`. Al final se cambia a `true` y se prueba el endpoint de diagnostico.

## Diagnostico

Con sesion individual de superadmin:

```text
GET /api/portal/integrations/microsoft/status
GET /api/portal/integrations/microsoft/status?verify=1
```

La primera ruta informa si faltan variables sin contactar Microsoft. La segunda solicita un token de aplicacion, confirma que el sitio coincide y lista sus bibliotecas. Nunca devuelve el secreto ni el token.

## Siguiente fase

Despues de verificar lectura:

1. Crear bibliotecas o carpetas para Eventos, Iglesias, Regiones, Formacion, Administracion y Contabilidad.
2. Guardar en Supabase solo metadatos e identificadores externos, nunca archivos ni tokens de Microsoft.
3. Mapear cada recurso al alcance de los roles del portal.
4. Activar carga con permiso `write`, validacion de archivos, auditoria y papelera.

## Piloto seguro de documentos de Eventos

El portal puede guardar documentos operativos de cada evento en la biblioteca `Eventos`. La carga permanece apagada aunque Microsoft este conectado mientras:

```text
MICROSOFT_SHAREPOINT_EVENTS_WRITE_ENABLED=false
```

Antes de encenderla:

1. Ejecutar `docs/sql/event_documents_sharepoint.sql` en Supabase.
2. Ejecutar `docs/sql/event_payment_evidence_sharepoint.sql` para habilitar comprobantes privados de pagos manuales.
3. Agregar a la aplicacion Entra el permiso Application `Lists.SelectedOperations.Selected` y conceder consentimiento administrativo.
4. Conceder a la aplicacion el rol `write` exclusivamente sobre la biblioteca `Eventos` con `POST /sites/{site-id}/lists/{list-id}/permissions`.
5. No conceder `Sites.ReadWrite.All`, `Sites.Manage.All` ni `Sites.FullControl.All` a la aplicacion del portal.
6. Configurar `MICROSOFT_SHAREPOINT_EVENTS_DRIVE_ID` con el identificador exacto de la biblioteca Eventos.
7. Cambiar `MICROSOFT_SHAREPOINT_EVENTS_WRITE_ENABLED=true`, desplegar y probar con un archivo sin datos sensibles.

La API exige una cuenta individual, aplica la misma jerarquia del evento, limita a 4 MB por el limite de entrada de Vercel Functions, acepta solo PDF/JPG/PNG/WebP, sanea imagenes y registra cada intento en auditoria. Los archivos permanecen en SharePoint; Supabase guarda solo metadatos e identificadores externos.

### Comprobantes de pagos locales

- Se guardan en `Portal Eventos/{evento-id}/Comprobantes de pago` y se nombran con el nombre normalizado del asistente más un identificador corto de inscripción.
- Las capturas se reorientan, reducen a un máximo de 1600 × 1600, convierten a WebP y quedan por debajo de 1,5 MB. Los PDF se limitan a 2 MB.
- El enlace real de SharePoint nunca llega al navegador público. Solo una cuenta individual con alcance sobre el evento puede abrir el archivo mediante el portal.
- `retention_until` queda en `NULL`: esto impide un borrado automático accidental. Contabilidad debe aprobar primero qué evidencia se conserva y por cuánto tiempo; después se puede programar una limpieza auditada.

## Próxima conexión: inscripciones de Eventos

Las respuestas se guardan primero en Maná. El portal genera desde la operación de cada evento un Excel con los datos base y las preguntas configurables. Esto evita perder una inscripción si Microsoft no está disponible.

Para sincronización automática posterior, crear dentro del sitio privado `Portal Maná` una **Lista** llamada `Inscripciones de Eventos`, no un Excel. Sus columnas iniciales deben ser:

- `Evento` (texto), `IdentificadorEvento` (texto), `IdentificadorInscripcion` (texto único), `Nombre`, `Correo`, `Teléfono`, `Iglesia`, `Estado`, `Asistentes`, `Total`, `Moneda`, `FechaInscripción`.
- `RespuestasAdicionales` (varias líneas de texto): resumen legible de preguntas abiertas y opciones.
- `EnlaceOperación` (hipervínculo): enlace privado a la operación en Maná.

Una vez creada, registrar solo su identificador en `MICROSOFT_SHAREPOINT_EVENT_REGISTRATIONS_LIST_ID` y conceder a la aplicación el permiso mínimo de escritura sobre esa lista. No usar `Sites.ReadWrite.All`. La sincronización no reemplazará el Excel: el Excel seguirá siendo una exportación puntual y la lista será la vista operativa compartida.

### Limite con ImageKit

- ImageKit conserva galerias, portadas, fotografias y medios publicos optimizados para el sitio.
- SharePoint conserva documentos operativos privados. Las imagenes aceptadas aqui son comprobantes, codigos QR u otras evidencias internas, no fotografias para galerias.
- Supabase conserva metadatos, permisos y auditoria; no duplica los archivos.
