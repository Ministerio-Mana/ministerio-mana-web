# Operacion Campus Mana

Guia corta para siembras mensuales Campus con Stripe y Wompi.

## Variables requeridas

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `WOMPI_PUBLIC_KEY`
- `WOMPI_PRIVATE_KEY`
- `WOMPI_INTEGRITY_KEY`
- `WOMPI_WEBHOOK_SECRET`
- `CAMPUS_CRON_SECRET`
- `CRON_SECRET` con el mismo valor de `CAMPUS_CRON_SECRET` para que Vercel
  envie el header automatico del cron

## SQL

Ejecutar en Supabase:

- `docs/sql/campus_donation_subscriptions.sql`
- `docs/sql/campus_donation_allocations.sql`
- `docs/sql/campus_missionary_slugs_seed.sql`
- `docs/sql/wompi_reliability_upgrade.sql`

## Stripe

Las siembras mensuales en USD usan Stripe Checkout en modo `subscription`.
Stripe hace los cobros recurrentes y el webhook `/api/stripe/webhook` actualiza
`campus_donation_subscriptions`.

Desde el portal, el donante puede:

- Pausar
- Reactivar
- Cancelar cobros futuros
- Abrir el portal de Stripe para metodo de pago

## Wompi

Las siembras mensuales en COP empiezan con un pago inicial en Wompi. Si el pago
fue con tarjeta y Wompi entrega `payment_source_id` o `payment_method.token`, el
webhook guarda una fuente de pago para cobros posteriores.

Si el pago inicial fue por PSE, Nequi u otro metodo sin fuente automatica, la
suscripcion queda en `PENDING_SETUP` y requiere seguimiento manual.

Configura en el Dashboard Wompi de **Producción** una sola URL de eventos:

- `https://ministeriomana.org/api/wompi/events-forwarded`

El valor de `WOMPI_WEBHOOK_SECRET` debe ser el **Secreto de Eventos** de ese mismo
ambiente, no la llave privada ni el secreto de integridad. Sandbox debe usar su
propia URL y sus propias llaves.

Wompi agrega el parámetro `id` al regreso del checkout. Las páginas de gracias lo
usan para consultar el estado actual y conciliar el pago aunque el webhook se
retrase. La conciliación manual del portal queda únicamente como contingencia.

## Cron Wompi Campus

Endpoint:

- `POST /api/campus/subscriptions/run`
- `GET /api/campus/subscriptions/run` para Vercel Cron
- Header requerido: `x-cron-secret: <CAMPUS_CRON_SECRET>`
- Header Vercel Cron: `Authorization: Bearer <CRON_SECRET>`
- Alternativa: `?token=<CAMPUS_CRON_SECRET>`

Programacion sugerida:

- Diario a las 08:30 America/Bogota (13:30 UTC).
- Schedule UTC: `30 13 * * *`.
- En `vercel.json`: `/api/campus/subscriptions/run`.

Este cron envia los cobros Wompi vencidos. Tambien intenta reconciliar
suscripciones en `PENDING_SETUP` cuando el webhook inicial guardo el evento crudo
de Wompi en la donacion inicial.

Además, `/api/wompi/reconcile-pending` corre cada 10 minutos y recupera eventos
que fallaron y donaciones `PENDING` que ya tengan un ID de transacción Wompi.

Ejemplo manual:

```bash
curl -X POST "https://TU-DOMINIO/api/campus/subscriptions/run" \
  -H "x-cron-secret: TU_SECRETO"
```

## Cancelaciones y devoluciones

Cancelar aplica a cobros futuros. En Wompi, si existe fuente de pago, el portal
intenta anularla con `/payment_sources/:id/void`. Los pagos ya aprobados no se
devuelven automaticamente; cualquier devolucion se revisa caso por caso.
