# Pendientes de activación y revisión

Fecha de corte: 13 de julio de 2026.

Este documento reemplaza el inventario operativo que estaba disperso entre la bitácora, el tablero y los mensajes de revisión. No contiene secretos ni valores de producción.

## 1. Lo primero que debe hacerse en casa

No ejecutar desde el celular. Usar el SQL Editor del proyecto correcto de Supabase y correr cada archivo por separado, esperando a que termine antes del siguiente.

- [ ] 1. Ejecutar `docs/sql/event_documents_sharepoint.sql`.
  - Activa los metadatos y la auditoría para documentos privados de cada evento.
  - Resultado esperado: aparecen las tablas de documentos y auditoría indicadas al final del script.
- [ ] 2. Ejecutar `docs/sql/event_payment_evidence_sharepoint.sql`.
  - Activa almacenamiento privado, revisión y retención controlada de comprobantes manuales.
  - Resultado esperado: existe `event_payment_evidence` con referencias de SharePoint y retención.
- [ ] 3. Ejecutar `docs/sql/finance_scopes_hierarchy.sql`.
  - Separa Finanzas global, nacional, regional y local.
  - Wompi queda siempre como recaudo nacional de Colombia.
  - Stripe queda como recaudo global/internacional.
  - QR, transferencia o efectivo con iglesia quedan como recaudo local.
  - Resultado esperado: la consulta final no muestra Wompi fuera de `NATIONAL/colombia` ni Stripe fuera de `GLOBAL`.
- [ ] 4. Ejecutar `docs/sql/events_dual_currency_payments.sql`.
  - Activa precio COP para Wompi y precio USD para Stripe dentro del mismo evento global.
  - Resultado esperado: existen `price_cop`, `price_usd` y los RPC seguros incluidos en el script.

Si algún script falla, detenerse en ese punto, guardar el mensaje completo y no continuar con el siguiente hasta corregirlo.

## 2. Activar el primer equipo financiero

Después de ejecutar el tercer SQL:

- [ ] Entrar con una cuenta individual de superadmin en `/portal/users`.
- [ ] Buscar a cada responsable por nombre o correo.
- [ ] Abrir `Finanzas` y agregar el alcance correspondiente.
- [ ] Configurar como mínimo:
  - [ ] Un responsable nacional de Colombia.
  - [ ] Un responsable por cada región que ya vaya a operar.
  - [ ] Un responsable por cada iglesia que vaya a revisar pagos locales.
- [ ] Confirmar con una cuenta de prueba que cada responsable ve únicamente lo que le compete.

Información que debe prepararse:

- [ ] Nombre y correo del responsable nacional.
- [ ] Nombre, correo y región de cada responsable regional.
- [ ] Nombre, correo e iglesia de cada responsable local.

El permiso de Finanzas es adicional. Un pastor no pierde su rol pastoral cuando recibe este acceso.

## 3. Revisión completa de Eventos

### Constructor y diseño

- [ ] Crear un borrador local gratuito y guardarlo.
- [ ] Confirmar que `Colombia · Bogotá` y `Presencial` se guardan sin rechazo.
- [ ] Probar imagen horizontal, cuadrada y vertical.
- [ ] Confirmar que ninguna imagen se recorta y que la tarjeta del panel se ve proporcionada.
- [ ] Revisar en celular la página pública, el encabezado, la jerarquía tipográfica, el arte, el contenido y el footer.
- [ ] Confirmar que los calendarios se cierran con una acción clara de confirmación.

### Formularios

- [ ] Crear un evento con formulario Maná.
- [ ] Añadir al menos una pregunta adicional.
- [ ] Probar campos obligatorios y opcionales.
- [ ] Enviar una inscripción desde celular.
- [ ] Confirmar mensaje de éxito, estado de la inscripción y consentimiento de WhatsApp.
- [ ] Verificar el enlace automático del WhatsApp de información.

### Cobros

- [ ] Crear un evento nacional de prueba con Wompi y precio COP.
- [ ] Confirmar que no permite USD ni pago manual simultáneo.
- [ ] Crear un evento global de prueba con Wompi COP + Stripe USD.
- [ ] Confirmar que muestra los dos precios por separado y nunca convierte ni suma monedas.
- [ ] Crear un evento local con QR o transferencia manual.
- [ ] Enviar un comprobante pequeño y verificar que solo el equipo autorizado puede abrirlo.
- [ ] Confirmar que aprobar o rechazar el comprobante deja auditoría.

No hacer un cobro real de valor alto durante QA. Usar los modos de prueba o un monto mínimo previamente autorizado.

## 4. Excel en línea y SharePoint

Después de ejecutar los dos primeros SQL:

- [ ] Abrir la operación de un evento con inscripciones.
- [ ] Pulsar `Actualizar Excel en OneDrive`.
- [ ] Abrir `Inscripciones.xlsx` desde Documentos internos.
- [ ] Confirmar que se abre en Excel web sin necesitar Microsoft 365 instalado.
- [ ] Confirmar que una segunda actualización reemplaza el mismo archivo y no crea copias sin control.
- [ ] Revisar las hojas `Inscripciones` y `Resumen financiero`.
- [ ] Confirmar que las preguntas adicionales aparecen como columnas.
- [ ] Confirmar que Wompi/COP y Stripe/USD permanecen separados.
- [ ] Probar `Descargar una copia` solo como opción secundaria fuera de línea.

Verificación administrativa de Microsoft, sin volver a crear lo que ya funciona:

- [ ] Registrar la fecha de vencimiento del secreto de Microsoft Entra.
- [ ] Confirmar que la aplicación usa permisos seleccionados sobre el sitio/biblioteca, no `Sites.ReadWrite.All`.
- [ ] Confirmar que la biblioteca `Eventos` es privada.
- [ ] Confirmar que las variables de Microsoft están configuradas en Vercel sin exponer valores.

Mejora posterior opcional:

- [ ] Decidir si además del Excel se necesita una Lista de SharePoint llamada `Inscripciones de Eventos` para vista operativa en tiempo real.
- [ ] Si se aprueba, crear la lista y entregar únicamente su identificador. El equipo web conectará la sincronización sin reemplazar el Excel.

## 5. Decisiones de Finanzas que requieren aprobación humana

- [ ] Definir cuánto tiempo se conservan comprobantes después de cerrar un evento.
  - Hasta aprobar una política, `retention_until = NULL` y no se borra nada automáticamente.
  - Definir si serán 90, 180, 365 días u otro plazo con Contabilidad.
- [ ] Definir quién puede aprobar, rechazar y corregir pagos manuales en cada nivel.
- [ ] Recopilar por iglesia los medios locales autorizados:
  - [ ] Nombre del banco o billetera.
  - [ ] Tipo y número de cuenta.
  - [ ] Titular autorizado.
  - [ ] Imagen QR vigente.
  - [ ] Instrucciones para el asistente.
  - [ ] Si exige comprobante o admite efectivo sin archivo.
- [ ] Definir quién concilia los recaudos nacionales de Wompi.
- [ ] Definir quién concilia los recaudos globales de Stripe.
- [ ] Confirmar que ningún equipo local recibe acceso a las cuentas nacionales o globales.

## 6. Pagos, notificaciones y seguridad de producción

Estas tareas son de verificación; no copiar ni enviar las llaves por mensajes.

- [ ] Verificar un pago Wompi de prueba y su webhook firmado.
- [ ] Verificar un pago Stripe de prueba y su webhook firmado.
- [ ] Confirmar que reintentar un webhook no duplica pagos ni inscripciones.
- [ ] Confirmar que `CRON_SECRET` está activo y que los crons de Vercel responden correctamente.
- [ ] Revisar conciliación de pagos Wompi pendientes.
- [ ] Verificar SMTP/SendGrid para invitaciones, recuperación y notificaciones.
- [ ] Confirmar la lista vigente de `PORTAL_SUPERADMIN_EMAILS`.
- [ ] Confirmar fecha de rotación de secretos de Microsoft, Stripe, Wompi, Supabase y correo.
- [ ] Revisar el Security Advisor de Supabase después de aplicar migraciones.

Opcional, solo si se van a usar:

- [ ] Configurar Google y Facebook como proveedores OAuth en Supabase y validar redirects.
- [ ] Activar el webhook de WhatsApp y hacer un envío controlado.

## 7. Cumbre Mundial 2026

Primero decidir si el módulo sigue operativo o ya entra en cierre contable.

- [ ] Confirmar estado: operación activa, cierre o archivo.
- [ ] Si sigue activo, ejecutar QA de Wompi, Stripe, menores, internacionales y cuotas.
- [ ] Revisar el Centro de Soluciones: incompletos, pendientes, descuadres, duplicados y sin iglesia.
- [ ] Ejecutar la auditoría de paquetes en modo de vista previa.
- [ ] Revisar manualmente cada caso `TOTAL_NO_CUADRA_CON_PAQUETES`.
- [ ] Aplicar una corrección histórica únicamente con participante confirmado y `dryRun` revisado.
- [ ] Verificar notificaciones y exportes contables finales.
- [ ] Confirmar que reservas sin pago se conservan, archivan o eliminan según la política aprobada.

## 8. Campus, Donaciones e Iglesias

### Campus y donaciones

- [ ] Probar una donación Campus con cada proveedor habilitado.
- [ ] Confirmar asignación al misionero correcto y visibilidad financiera correcta.
- [ ] Verificar suscripciones y cron de cobro/recordatorio.
- [ ] Validar motivos reales de pagos pendientes y fallidos en Finanzas.
- [ ] Definir el flujo de certificados y si se pedirá documento en aportes internacionales.

### Iglesias

- [ ] Confirmar coordenadas exactas de Ecuador y México.
- [ ] Entregar el consolidado de nuevas iglesias de México cuando esté listo.
- [ ] Revisar que cada iglesia tenga región, país, correo institucional y datos de contacto correctos.
- [ ] Confirmar qué personas pueden crear colaboradores y eventos en cada iglesia.

## 9. Contenido, Home y experiencia móvil

- [ ] Aprobar el copy final de los capítulos del Home.
- [ ] Revisar animaciones y scroll en celular, especialmente dispositivos de gama media.
- [ ] Confirmar que no hay mareo, saltos ni bloqueos de scroll.
- [ ] Revisar Home, Eventos, Donaciones, Iglesias, Campus y Portal en móvil.
- [ ] Decidir si se activará el CMS para edición pública de Home/Eventos/Noticias.
- [ ] Si se activa, validar el SQL del CMS, preview, publicación, ImageKit y permisos editor/admin.

## 10. Trabajo que continúa a cargo del equipo web

- [x] Terminar y desplegar la administración visual de equipos financieros por alcance. Completado en `13d9cad`.
- [ ] Agregar filtros, periodos y exportes al panel de Finanzas sin mezclar COP y USD.
- [ ] Conectar la Lista de SharePoint de inscripciones si se aprueba.
- [ ] Añadir la política de retención únicamente después de recibir el plazo aprobado.
- [ ] Completar QA y cierre contable de Cumbre según la decisión del punto 7.
- [ ] Optimizar animaciones móviles y terminar data attributes pendientes del Home.
- [ ] Revisar copy final y consistencia visual de las páginas públicas.
- [ ] Mantener pruebas automáticas de eventos, comprobantes, finanzas y roles.

## 11. Qué no debe hacerse

- No compartir secretos, tokens ni llaves en SQL, Git, capturas o conversaciones.
- No conceder permisos globales de SharePoint cuando basta una biblioteca o lista seleccionada.
- No aprobar pagos automáticos manualmente.
- No mezclar ni sumar COP con USD.
- No usar Wompi para recaudo local: Wompi pertenece siempre al recaudo nacional de Colombia.
- No eliminar comprobantes hasta tener una política de retención aprobada.
- No cambiar el rol pastoral principal para entregar un permiso financiero adicional.
