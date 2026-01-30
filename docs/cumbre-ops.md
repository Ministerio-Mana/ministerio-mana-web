# Operacion Cumbre 2026

Guia corta para cron de cuotas, export CSV y acceso de cuenta.

## Variables requeridas

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `CUMBRE_CRON_SECRET`
- `CUMBRE_EXPORT_SECRET`
- `CUMBRE_INSTALLMENT_DEADLINE` (por defecto `2026-05-15`)
- `CUMBRE_ADMIN_EXPORT_SECRET`
- `CUMBRE_MANUAL_SECRET`
- `CUMBRE_TEST_MODE` (opcional, solo preview)
- `CUMBRE_TEST_AMOUNT_COP` (opcional, default 5000)
- `CUMBRE_TEST_AMOUNT_USD` (opcional, default 1)
- `CUMBRE_EMAIL_FROM` (opcional, default `info@ministeriomana.org`)
- `WHATSAPP_WEBHOOK_URL` (opcional para recordatorios por WhatsApp)
- `WHATSAPP_WEBHOOK_TOKEN` (opcional, si tu webhook requiere auth)

> Nota: puedes reutilizar `SUPABASE_URL` y `SUPABASE_ANON_KEY` como `PUBLIC_*`.
> El modo prueba solo se permite fuera de produccion.

## Cron de cuotas (auto-debito)

Endpoint:
- `POST /api/cumbre2026/installments/run`
- Header requerido: `x-cron-secret: <CUMBRE_CRON_SECRET>`
- Alternativa: `?token=<CUMBRE_CRON_SECRET>`

Ejemplo manual:

```bash
curl -X POST "https://TU-DOMINIO/api/cumbre2026/installments/run" \
  -H "x-cron-secret: TU_SECRETO"
```

Programacion sugerida:
- Diario a las 08:00 America/Bogota (13:00 UTC).
- Si usas un servicio externo, elige un schedule tipo `0 13 * * *` (UTC).

## Cron recordatorios cuotas (manual PSE/Nequi)

Este cron envia recordatorios 3 dias antes, 2 dias antes y el mismo dia del vencimiento.
Solo aplica para planes sin auto-debito (sin payment_source_id).
Requiere un proveedor de email (SendGrid o Resend) y/o un webhook de WhatsApp si deseas ese canal.
Los recordatorios incluyen un link interno tipo `/cumbre2026/pagar/<token>` que genera el cobro al abrirse.

### Autodebito Wompi (tarjeta)

Cuando el usuario paga la primera cuota con tarjeta, el webhook intenta **tokenizar** y guardar\n+`provider_payment_method_id` para que el cron de cuotas pueda cobrar automaticamente.
Si el pago inicial fue por PSE/Nequi, no hay autodebito y se usan recordatorios.

Endpoint:
- `POST /api/cumbre2026/installments/reminders/run`
- Header requerido: `x-cron-secret: <CUMBRE_CRON_SECRET>`
- Alternativa: `?token=<CUMBRE_CRON_SECRET>`

Ejemplo manual:

```bash
curl -X POST "https://TU-DOMINIO/api/cumbre2026/installments/reminders/run" \
  -H "x-cron-secret: TU_SECRETO"
```

Programacion sugerida:
- Diario a las 08:00 America/Bogota (13:00 UTC).
- Si usas Vercel Cron o externo, usa `0 13 * * *` (UTC).

## Export CSV (Excel)

Endpoint:
- `GET /api/cumbre2026/installments/export`
- Header requerido: `x-export-secret: <CUMBRE_EXPORT_SECRET>`
- Alternativa: `?token=<CUMBRE_EXPORT_SECRET>`

Ejemplo:

```bash
curl -L "https://TU-DOMINIO/api/cumbre2026/installments/export?token=TU_SECRETO" \
  -o cumbre_installments.csv
```

Abre el CSV en Excel/Sheets para el control de pagos.

## Export Admin (participantes + pagos)

Endpoint:
- `GET /api/cumbre2026/admin/export`
- Header requerido: `x-export-secret: <CUMBRE_ADMIN_EXPORT_SECRET>`
- Alternativa: `?token=<CUMBRE_ADMIN_EXPORT_SECRET>`

Ejemplo:

```bash
curl -L "https://TU-DOMINIO/api/cumbre2026/admin/export?token=TU_SECRETO" \
  -o cumbre-admin.csv
```

## Formulario manual (pagos físicos)

Ruta:
- `/admin/cumbre/manual?token=TU_CUMBRE_MANUAL_SECRET`

El formulario crea reservas manuales y permite registrar abonos.

## Supabase Auth (cuentas)

1. En Supabase -> Auth, habilita Email OTP.
2. En Auth -> URL Configuration, agrega el Site URL de produccion.
3. Agrega un Redirect URL valido: `https://TU-DOMINIO/cuenta`.
4. Configura `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` en el entorno.

## SQL extra (manual)

- Ejecuta `docs/sql/cumbre_bookings_extra.sql` para campos adicionales de reservas manuales.
- Ejecuta `docs/sql/cumbre_installment_reminders.sql` para recordatorios de cuotas.
- Ejecuta `docs/sql/cumbre_installment_links.sql` para links de pago por cuota.
  - Nota: la tabla de links tiene RLS habilitado y sin policies públicas.
