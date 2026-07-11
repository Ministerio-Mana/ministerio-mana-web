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
