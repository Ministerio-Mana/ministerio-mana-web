# Fondos contables en Stripe

## Objetivo

Cada cobro nuevo de Stripe debe indicar, sin depender del nombre del donante, qué concepto recibió el dinero y quién es su beneficiario contable. Esta clasificación no mueve el depósito a otra cuenta bancaria: todos los fondos siguen liquidándose en la cuenta Stripe configurada. Para separar cuentas receptoras reales se necesitaría un proyecto distinto con Stripe Connect o Transfers.

## Taxonomía

| Origen | `payment_domain` | `concept_code` | `fund_code` / producto |
| --- | --- | --- | --- |
| Primicias | `PRIMICIAS` | `OFFERING` | `PRIMICIAS` |
| Diezmos | `DONATION` | `TITHE` | `DONATION_TITHE` |
| Ofrendas | `DONATION` | `OFFERING` | `DONATION_OFFERING` |
| Misiones | `DONATION` | `MISSIONS` | `DONATION_MISSIONS` |
| Donación general | `DONATION` | `GENERAL` | `DONATION_GENERAL` |
| Campus general | `CAMPUS` | `CAMPUS` | `CAMPUS_GENERAL` |
| Campus con destinatario | `CAMPUS` | `CAMPUS` | `CAMPUS_<SLUG>` |
| Evento creado en el portal | `EVENT` | `EVENT` | `EVENT_<ID_DEL_EVENTO>` |
| Cumbre Mundial 2026 | `EVENT` | `EVENT` | `EVENT_CUMBRE_2026` |

Una donación Campus repartida entre varias personas genera una línea de Checkout por destinatario. El cobro total conserva `CAMPUS_SPLIT`, mientras que el detalle de la factura muestra el producto y monto de cada asignación.

## Dónde aparece

La misma identificación se escribe en:

- Product y línea de Checkout;
- Checkout Session;
- PaymentIntent y Charge en pagos únicos;
- Customer y Subscription en pagos recurrentes;
- Invoice, PaymentIntent y Charge de cada renovación procesada por el webhook;
- registro interno de la donación y logs operativos.

Los campos comunes son `mana_schema=mana_fund_v1`, `payment_domain`, `concept_code`, `concept_label`, `fund_code`, `fund_label`, `beneficiary_type`, `beneficiary_code`, `beneficiary_label` y `source`. Los identificadores propios del pago —referencia, evento, registro, iglesia o asignación Campus— permanecen como metadatos adicionales. No se copian correo, documento, teléfono ni nombre del donante a estos metadatos contables.

## Operación en Stripe

No hay que crear manualmente el catálogo. En el primer Checkout de cada fondo, la aplicación busca un producto activo por `mana_fund_code`; si no existe, lo crea con una llave idempotente. Si la búsqueda o creación temporalmente falla, el pago puede continuar con un producto inline que conserva la misma clasificación.

Solo los destinos controlados por la aplicación crean productos. El campo libre “Destino / proyecto” del formulario queda como información adicional del pago, pero no puede crear productos arbitrarios en la cuenta Stripe.

Para conciliar en el Dashboard:

1. Abrir el Payment o Charge y revisar la descripción `Ministerio Maná · <fondo>`.
2. Consultar `fund_code`, `beneficiary_label` y `payment_domain` en Metadata.
3. En Campus repartido, abrir la factura o la sesión de Checkout para ver cada producto y monto.
4. En exportaciones internas, filtrar también por proveedor `stripe`, dominio y concepto.

El endpoint de webhook debe recibir al menos `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded` y `payment_intent.payment_failed`.

## Alcance temporal

La clasificación se aplica a Checkouts creados después del despliegue. Los pagos históricos no se modifican automáticamente. Cualquier backfill sobre objetos históricos de Stripe debe ejecutarse aparte, primero en modo de lectura y con una muestra aprobada por contabilidad.

Referencias: [metadata de Stripe](https://docs.stripe.com/metadata), [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [PaymentIntents](https://docs.stripe.com/payments/payment-intents), [facturas de suscripciones](https://docs.stripe.com/billing/invoices/subscription) y [búsqueda de Products](https://docs.stripe.com/api/products/search).
