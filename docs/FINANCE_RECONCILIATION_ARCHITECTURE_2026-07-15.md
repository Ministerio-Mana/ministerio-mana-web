# Conciliación financiera Wompi y Stripe

Fecha: 15 de julio de 2026.

## Decisión

El Portal no calculará el neto aplicando una tarifa supuesta. Guardará y mostrará por separado:

1. valor bruto cobrado;
2. comisión reportada por el proveedor;
3. impuestos o retenciones reportados;
4. ajustes;
5. valor neto del proveedor;
6. valor consignado en el banco;
7. diferencia pendiente de conciliación.

Los importes se almacenan en unidades menores enteras y conservan moneda y exponente. COP y USD nunca se suman ni se convierten automáticamente.

## Por qué no se puede usar una tarifa fija

Wompi publica para su plan Agregador una tarifa pública, pero también ofrece Gateway con comisión negociada con Bancolombia. El contrato real de la iglesia puede no coincidir con el precio público. La fuente oficial para conciliar es el reporte de desembolsos, que indica el neto transferido después de comisiones e impuestos.

Stripe sí expone en cada `Balance Transaction` los campos `amount`, `fee`, `fee_details` y `net`. Además, su conciliación de `Payouts` permite asociar el depósito bancario con las transacciones de saldo incluidas.

Fuentes oficiales:

- [Wompi: reportes de ventas y desembolsos](https://wompi.com/es/co/beneficios/reportes)
- [Wompi: planes y tarifas](https://wompi.com/es/co/planes-tarifas/)
- [Wompi: plan Gateway](https://wompi.com/es/co/planes-tarifas/plan-gateway)
- [Wompi: transacciones, referencia e ID](https://docs.wompi.co/docs/colombia/transacciones/)
- [Stripe: Balance Transactions](https://docs.stripe.com/api/balance_transactions)
- [Stripe: conciliación de Payouts](https://docs.stripe.com/payouts/reconciliation)
- [Stripe: reporte de conciliación de Payouts](https://docs.stripe.com/reports/payout-reconciliation)

## Flujo contable

### Wompi

1. El webhook o la consulta de transacción aporta ID, referencia, moneda y bruto.
2. La referencia enlaza el pago con Campus, Evento, Donación, Primicia u otro concepto.
3. El reporte oficial de ventas/desembolsos completa comisión, impuestos, neto, lote y referencia bancaria.
4. El extracto bancario confirma cuánto ingresó realmente.
5. La conciliación queda completa únicamente cuando bruto, distribución, neto y depósito coinciden.

La API pública de transacciones no se toma como fuente de comisión o neto. Hasta cargar el reporte, el movimiento queda `NEEDS_PROVIDER_VALUES`; no se muestra un neto estimado como si fuera real.

### Stripe

1. El pago conserva su `PaymentIntent` o `Charge` y el `Balance Transaction` asociado.
2. `Balance Transaction` aporta bruto, comisión y neto exactos en unidades menores.
3. El `Payout` agrupa los movimientos enviados al banco.
4. El depósito bancario se compara con el neto del `Payout`.

## Distribución por concepto y alcance

Cada transacción se distribuye mediante `finance_transaction_allocations`. Los dominios iniciales son Campus, Evento, Donación, Primicias, Peregrinación, Escuela Bíblica, Devocional, Diezmo, Ofrenda, Misiones y Otros.

La distribución conserva el alcance financiero:

- Wompi: recaudo nacional de Colombia cuando el Portal procesa el cobro;
- Stripe: recaudo global/internacional;
- QR, transferencia, PayPal, Zelle, cuenta bancaria o enlace externo: alcance del evento o de la iglesia responsable, con revisión manual cuando aplique.

Una responsable financiera recibe solamente movimientos dentro de sus asignaciones globales, nacionales, regionales o locales. Las tablas base son privadas y no se consultan directamente desde el navegador.

## Estructura de datos

El script `docs/sql/finance_provider_reconciliation.sql` crea:

- lotes de importación con hash para no cargar dos veces el mismo archivo;
- transacciones del proveedor;
- desembolsos o `Payouts`;
- distribución de cada transacción por concepto y alcance;
- auditoría;
- vistas de diferencias por transacción y por desembolso.

No guarda llaves, números completos de tarjeta ni archivos financieros dentro de las tablas. Los archivos de origen permanecen en el almacenamiento privado aprobado y la base conserva su hash y trazabilidad.

## Importación operativa

El panel de Finanzas incorpora una carga en dos pasos:

1. `Revisar archivo` detecta Wompi o Stripe, valida UTF-8, encabezados, fechas, monedas, ecuaciones y transacciones repetidas, y presenta bruto, comisión y neto antes de guardar.
2. `Importar reporte` exige la misma huella SHA-256 de la vista previa y llama una única función transaccional. Si una fila contradice bruto, moneda o valores exactos ya guardados, se revierte el lote completo.

Límites iniciales: CSV oficial, 4 MB y 10.000 movimientos. Las columnas personales se reconocen para informar que fueron omitidas, pero no forman parte del JSON normalizado ni de las tablas de conciliación.

Contratos:

- `src/lib/providerReportImport.ts`: parser y normalización sin datos personales;
- `src/pages/api/portal/finance-reconciliation-import.ts`: autenticación, alcance y confirmación de huella;
- `docs/sql/finance_provider_report_import.sql`: guardado atómico exclusivo de `service_role`.

Finanzas Global puede importar Stripe y Wompi. Finanzas Nacional Colombia puede importar Wompi. Los demás alcances no reciben el control de carga.

## Comprobantes manuales de eventos

Los comprobantes siguen esta ruta privada en la biblioteca `Eventos` de SharePoint:

`Portal Eventos/{evento-id}/Comprobantes de pago/{persona-inscripción-pago}/{archivo}`

El nombre ayuda a la operación, mientras los identificadores cortos evitan confundir homónimos. La base conserva las relaciones completas con evento, inscripción y pago. La eliminación automática permanece desactivada hasta que Contabilidad apruebe el plazo de retención.

## Resultado esperado para Finanzas

La pantalla final debe permitir:

- filtrar por fecha, proveedor, moneda, concepto, país, región e iglesia;
- abrir una transacción y ver bruto → descuentos reportados → neto → depósito;
- localizarla por referencia, ID del proveedor, correo autorizado o documento enmascarado;
- identificar movimientos sin clasificar, sin neto oficial o sin depósito;
- exportar Excel general y por concepto manteniendo COP y USD separados;
- ver la fuente y fecha de cada valor, sin confundir un cálculo con un dato oficial.
