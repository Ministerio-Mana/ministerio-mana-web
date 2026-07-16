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

## Cobertura de medios de pago

La conciliación no se diseña alrededor de PSE. Se aplica a cualquier transacción que Wompi entregue, independientemente del medio de pago: tarjeta, PSE, Nequi, transferencias o QR de Bancolombia y cualquier otro método que el comercio habilite posteriormente.

Las reglas comunes son:

1. Una transacción nueva se considera `PENDING` hasta que Wompi informe un estado final.
2. Nunca se confirma un aporte por el nombre del método ni por el regreso visual del checkout.
3. Se conservan el identificador de Wompi, la referencia interna, el monto, la moneda, el tipo de medio, las fechas y el evento crudo firmado.
4. El estado local solo cambia después de validar referencia, monto y moneda contra Wompi.
5. Los reintentos son idempotentes: recibir varias veces el mismo evento no duplica el aporte.
6. No se almacenan números de tarjeta, credenciales bancarias ni otros secretos del pagador.

El backend receptor ya trata el medio de forma genérica. La lista de métodos mostrados en el checkout es una configuración separada y debe ampliarse únicamente después de comprobar que el método está habilitado para la cuenta de Ministerio Maná y de ejecutar pruebas de `PENDING`, aprobación, rechazo, abandono y reintento.

## Arquitectura objetivo: Ministerio Maná como paraguas

La decisión de producto a largo plazo es que `ministeriomana.org` sea la base global de operaciones y el concentrador de identidad, agenda, iglesias, eventos y finanzas. El router de 21 Retos es la solución vigente, no el destino final.

Cuando el portal principal esté estable y auditado, el ingreso central de eventos de pago se migrará gradualmente a Ministerio Maná. Desde allí se distribuirán los movimientos a los productos autorizados, entre ellos:

- 21 Retos.
- Escuela Bíblica.
- Devocional.
- Agenda y eventos.
- Campus, donaciones y futuras campañas del ministerio.

La clasificación debe hacerse mediante espacios de referencia versionados y un registro central de destinos; no mediante búsquedas frágiles en textos libres. Cada producto conserva su operación, pero comparte contratos de seguridad, idempotencia, auditoría, conciliación y observabilidad.

## Orden seguro de migración futura

1. Terminar y auditar Ministerio Maná antes de mover consumidores productivos.
2. Inventariar el repositorio, responsables, secretos, destinos y reintentos del router 21 Retos.
3. Definir el catálogo central de productos y sus espacios de referencia.
4. Implementar el nuevo ingreso en modo sombra, sin escribir dos veces ni cambiar el flujo contable.
5. Comparar eventos recibidos, estados finales y totales contra el router vigente.
6. Migrar un producto por vez, empezando por un flujo controlado y reversible.
7. Mantener observación, alertas y procedimiento de reversión antes de retirar el router anterior.

## Reglas operativas

1. Mantener la URL de 21 Retos en Wompi Producción.
2. No duplicar webhooks directos sin una estrategia explícita de idempotencia.
3. El router debe reenviar el cuerpo original sin modificar montos, moneda, referencia, estado ni identificador de transacción.
4. Cada destino debe responder rápido; los errores deben poder reintentarse sin duplicar pagos.
5. Rotar el secreto compartido si se sospecha exposición y mantenerlo únicamente en variables de entorno protegidas.
6. Antes de cambiar el router, inventariar todos sus destinos y hacer una prueba controlada con estados `PENDING`, `APPROVED`, `DECLINED`, `VOIDED` y `ERROR`.

## Trabajo posterior

Cuando se retome el router 21 Retos, documentar su repositorio, responsables, lista de destinos, política de reintentos, alertas y procedimiento de recuperación. La migración o sustitución del router requiere una ventana coordinada y pruebas de punta a punta. No se iniciará hasta cerrar la fase prioritaria de Ministerio Maná.
