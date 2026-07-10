# Biblioteca multimedia: despliegue seguro

## Distribución

- Vercel: código, logos, iconos y recursos fijos indispensables.
- ImageKit: imágenes públicas administradas desde el CMS.
- Supabase privado: QR, comprobantes y documentos sensibles.
- YouTube/Vimeo: videos públicos.

`CMS_MEDIA_PROVIDER` controla solamente las cargas nuevas. Las imágenes existentes no se mueven y continúan visibles.

## Variables

Configurar en Vercel, nunca en archivos versionados:

```text
CMS_MEDIA_PROVIDER=supabase
IMAGEKIT_URL_ENDPOINT=
IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
```

La llave privada debe ser una llave restringida de ImageKit con `Media management: Read and write` y los demás recursos en `None`. No usar prefijo `PUBLIC_`.

## Activación gradual

1. Ejecutar `docs/sql/cms_media_imagekit_upgrade.sql` en Supabase.
2. Agregar las tres variables `IMAGEKIT_*` solo al entorno Preview de Vercel.
3. Desplegar una rama Preview manteniendo `CMS_MEDIA_PROVIDER=supabase`.
4. En Preview, agregar `CMS_MEDIA_PROVIDER=imagekit` y redesplegar.
5. Probar con una imagen sin datos personales:
   - carga;
   - aparición en la biblioteca;
   - apertura de la URL pública;
   - copia de URL;
   - eliminación;
   - verificación de auditoría en `cms_audit_logs`.
6. Configurar las mismas variables en Production.
7. Activar `CMS_MEDIA_PROVIDER=imagekit` en Production y redesplegar.

## Reversión

Cambiar `CMS_MEDIA_PROVIDER=supabase` y redesplegar. Esto restaura las cargas nuevas al bucket anterior sin borrar archivos ni cambiar URLs ya publicadas.

## Controles implementados

- Solo administradores autenticados pueden solicitar una carga.
- Las sesiones administrativas heredadas por contraseña no pueden cargar ni borrar archivos de ImageKit.
- Token de carga de un solo uso con vencimiento de cinco minutos.
- Segundo token ligado al usuario, carpeta y nombre del archivo.
- Carga directa navegador a ImageKit, sin atravesar el límite de cuerpo de Vercel.
- Imágenes inicialmente no publicadas.
- Validación de tipo real, máximo 5 MB y dimensiones entre 160 y 5000 px.
- Publicación únicamente después de consultar el archivo directamente en ImageKit y registrarlo en Supabase.
- Limpieza automática si el registro o la publicación falla.
- Eliminación mediante backend, con autorización, rate limit, purga de caché y auditoría.

## Operación

- Crear alertas de consumo de ImageKit en 70 %, 85 % y 95 %.
- No alojar videos en la biblioteca del CMS.
- No subir comprobantes, documentos de identidad ni archivos privados a ImageKit público.
- Mantener logos críticos y una imagen de respaldo dentro del repositorio para que el sitio siga identificable si ImageKit alcanza su cuota.
- Revisar trimestralmente archivos sin uso y conservar una copia externa de los originales importantes.
