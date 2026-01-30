# Contabilidad - Exportes y OneDrive

Guia para exportar donaciones (Wompi, Stripe, Fisicas) y sincronizar a OneDrive con Power Automate.

## Variables requeridas

- `DONATIONS_EXPORT_SECRET`

## SQL requerido (Supabase)

- Ejecuta `docs/sql/donations.sql`
- Ejecuta `docs/sql/cumbre_bookings_extra.sql` (para datos de reservas manuales)

## Endpoints de export

- Wompi: `/api/contabilidad/donaciones/export?provider=wompi&token=TU_SECRET`
- Stripe: `/api/contabilidad/donaciones/export?provider=stripe&token=TU_SECRET`
- Fisicas: `/api/contabilidad/donaciones/export?provider=physical&token=TU_SECRET`

> Tip: En Vercel Cron no se pueden enviar headers, por eso usamos `token` en la URL.

## Power Automate (OneDrive)

1. Crea un flujo **Scheduled cloud flow**.
2. Agrega accion **HTTP**:
   - Method: `GET`
   - URL: usa uno de los endpoints arriba.
3. Agrega accion **Create file (OneDrive for Business)**:
   - Folder Path: `/Contabilidad/Donaciones/`
   - File Name: `donaciones_wompi.csv` (o stripe / fisicas)
   - File Content: contenido del paso HTTP.
4. Repite el bloque para Stripe y Fisicas, o crea 3 flujos separados.
5. Frecuencia sugerida: diario (08:00 Colombia).

## Notas

- Los CSV se abren en Excel y puedes separarlos por pestañas o archivos.
- Si quieres un solo archivo Excel con 3 tabs, se necesita un paso extra con Office Scripts.
- Asegura los webhooks de Stripe y Wompi para que el estado de pagos se actualice en `donations`.
