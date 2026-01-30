# Checklist QA - Cumbre 2026 (End-to-End)

Guia rapida para validar reservas, cuotas, cron y export.

## 0) Pre-requisitos

- Variables en Vercel: ver `docs/cumbre-ops.md`.
- SQL ejecutado en Supabase: `docs/sql/cumbre_installments.sql`.
- Llaves sandbox de Wompi/Stripe en Preview (recomendado).

## 1) Crear una reserva (COP o USD)

En produccion el captcha esta activo. Para QA usa el flujo UI o un Preview sin Turnstile.

Ejemplo JSON (COP):

```bash
curl -X POST "https://TU-DOMINIO/api/cumbre2026/booking/create" \
  -H "content-type: application/json" \
  -d '{
    "contactName": "QA COP",
    "email": "qa+cop@ministeriomana.org",
    "phone": "3000000000",
    "countryGroup": "CO",
    "participants": [
      {"fullName": "QA COP", "packageType": "lodging", "relationship": "Responsable"}
    ]
  }'
```

Ejemplo JSON (USD): cambia `countryGroup` a `INT` y `email`.

Guarda `bookingId` del response.

## 2) Crear plan de cuotas

```bash
curl -X POST "https://TU-DOMINIO/api/cumbre2026/installments/create" \
  -H "content-type: application/json" \
  -d '{"bookingId": "BOOKING_ID", "frequency": "MONTHLY"}'
```

Respuesta:
- `provider: wompi` (COP) con `url` de checkout.
- `provider: stripe` (USD) con `url` de checkout.

## 3) Pagar primera cuota

- Abre el `url` de checkout.
- Completa pago en sandbox.
- Verifica en Supabase:
  - `cumbre_payments`: nuevo pago `APPROVED`.
  - `cumbre_installments`: cuota 1 en `PAID`.
  - `cumbre_payment_plans`: `next_due_date` actualizado.
  - Wompi: `provider_payment_method_id` debe quedar seteado para auto-debito.

## 4) Probar cron de auto-debito (Wompi)

Forza una cuota pendiente a hoy:

```sql
update cumbre_installments
set due_date = current_date
where id = (
  select id
  from cumbre_installments
  where plan_id = 'PLAN_ID'
    and status = 'PENDING'
  order by installment_index asc
  limit 1
);
```

Ejecuta cron:

```bash
curl -X POST "https://TU-DOMINIO/api/cumbre2026/installments/run?token=TU_CUMBRE_CRON_SECRET"
```

Luego revisa:
- `cumbre_payments`: nuevo registro en `PENDING/APPROVED`.
- `cumbre_installments`: pasa a `PROCESSING` y luego `PAID` cuando llegue el webhook.

## 5) Probar Stripe (USD)

- El pago en cuotas usa suscripcion. Stripe maneja los cobros.
- Verifica en Stripe Dashboard:
  - Subscription creada.
  - Invoice pagado.
- Webhook Stripe debe actualizar `cumbre_installments` a `PAID`.

## 6) Export CSV

```bash
curl -L "https://TU-DOMINIO/api/cumbre2026/installments/export?token=TU_CUMBRE_EXPORT_SECRET" \
  -o cumbre_installments.csv
```

## 7) Cuenta del usuario

- Entra a `/cuenta/ingresar` y usa el mismo email.
- Verifica que salgan reservas, cuotas y pagos.
- Prueba pausar/reanudar plan (botones en el panel).

## Notas

- Si el cron encuentra planes sin `provider_payment_method_id`, registra evento y omite el cobro.
- Para pruebas rapidas, usa Preview en Vercel con llaves sandbox.
