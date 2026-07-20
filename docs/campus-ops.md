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

## Pushpay

Cada misionero tiene un enlace corto oficial de Pushpay que redirige a un fondo
distinto y bloqueado. En la tarjeta individual, la alternativa `Donar con
Pushpay` solo se renderiza para visitas detectadas en Estados Unidos y se
mantiene visible mientras la persona usa USD. En Colombia no se envía ese
enlace al navegador, incluso si alguien cambia manualmente el selector a USD.
Wompi/COP y Stripe/USD mantienen su flujo actual sin cambios. El enlace se abre
en una pestaña nueva para que Pushpay gestione monto, recurrencia, identidad y
pago en su entorno seguro.

No se carga el fragmento genérico de Embedded Giving recibido inicialmente:
los seis fragmentos usan el mismo `handle` y el mismo `wgc`, por lo que no
evidencian el fondo de cada misionero. Tampoco se incrustan los enlaces cortos
en un `iframe`, porque Pushpay responde con `X-Frame-Options: SAMEORIGIN`.

Esta fase conserva la separación contable dentro de Pushpay, pero no afirma que
un pago completado allí haya quedado registrado en el Portal Maná. Para
conciliar pagos, donantes y recurrencias en el Portal se requiere el acceso de
lectura a Giving API, un webhook admitido por el plan o una importación
periódica de reportes. No se crea una donación local solo por abrir el enlace.

Los enlaces recibidos bloquean correctamente el fondo financiero de cada
misionero. Sin embargo, el formulario de Pushpay también muestra el campo
opcional `Socios de la Gran Comisión` sin un valor preseleccionado. El
administrador de Pushpay debe ocultarlo en estos fondos o entregarlo
preseleccionado y bloqueado con el mismo misionero para impedir reportes
contradictorios. Ese campo auxiliar no cambia el fondo financiero bloqueado,
pero no debe usarse como fuente canónica hasta corregirlo.

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
