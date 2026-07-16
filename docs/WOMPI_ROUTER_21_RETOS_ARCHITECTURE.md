# Arquitectura Wompi: router 21 Retos

## Decisión vigente

La URL configurada en **Wompi Producción** pertenece al router central de **21 Retos**. Ese router recibe los eventos de Wompi y los distribuye a los sistemas que los necesitan.

No se debe reemplazar esa URL por un webhook directo de Ministerio Maná sin revisar y migrar previamente todos los consumidores del router.

## Integración de Ministerio Maná

El router debe reenviar a Ministerio Maná los eventos Wompi mediante:

`POST /api/wompi/events-forwarded`

El reenvío se autentica con una firma HMAC SHA-256 en la cabecera `x-internal-signature`, calculada con el secreto compartido `INTERNAL_WEBHOOK_SECRET`. No se envían credenciales en la URL.

El receptor de Ministerio Maná conserva el evento crudo para idempotencia y auditoría, y después enruta cada referencia al flujo correspondiente:

- `MM-EVT-*`: pagos de Eventos.
- referencias de Cumbre: reservas y cuotas de Cumbre.
- referencias de Campus o Donaciones: conciliación del aporte correspondiente.

## Reglas operativas

1. Mantener la URL de 21 Retos en Wompi Producción.
2. No duplicar webhooks directos sin una estrategia explícita de idempotencia.
3. El router debe reenviar el cuerpo original sin modificar montos, moneda, referencia, estado ni identificador de transacción.
4. Cada destino debe responder rápido; los errores deben poder reintentarse sin duplicar pagos.
5. Rotar el secreto compartido si se sospecha exposición y mantenerlo únicamente en variables de entorno protegidas.
6. Antes de cambiar el router, inventariar todos sus destinos y hacer una prueba controlada con estados `PENDING`, `APPROVED`, `DECLINED`, `VOIDED` y `ERROR`.

## Trabajo posterior

Cuando se retome el router 21 Retos, documentar su repositorio, responsables, lista de destinos, política de reintentos, alertas y procedimiento de recuperación. La migración o sustitución del router requiere una ventana coordinada y pruebas de punta a punta.
