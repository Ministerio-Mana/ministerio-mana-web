# Pendientes de activación y revisión

Fecha de corte: 13 de julio de 2026.

Este documento reemplaza el inventario operativo que estaba disperso entre la bitácora, el tablero y los mensajes de revisión. No contiene secretos ni valores de producción.

## Revisión programada para el 14 de julio de 2026

El usuario confirmó que realizará estas pruebas mañana. Permanecen pendientes y no bloquean el trabajo técnico autónomo. Orden recomendado:

### Primero: accesos y Finanzas

- [ ] Preparar nombre y correo del primer responsable financiero nacional de Colombia.
- [ ] Preparar nombre, correo y región de un responsable financiero regional.
- [ ] Preparar nombre, correo e iglesia de un responsable financiero local.
- [ ] Asignar los tres alcances desde `/portal/users` sin retirar los roles pastorales existentes.
- [ ] Entrar con cada cuenta de prueba y confirmar que ve solamente los movimientos de su alcance.
- [ ] Probar los filtros y descargar un CSV COP y otro USD; confirmar que nunca aparecen mezclados.

### Segundo: Eventos de punta a punta

- [ ] Crear y guardar un evento local gratuito con `Colombia · Bogotá` y modalidad `Presencial`.
- [ ] Probar una imagen horizontal, una cuadrada y una vertical; revisar tarjeta, invitación pública y celular.
- [ ] Crear un formulario Maná con una pregunta adicional obligatoria y otra opcional.
- [ ] Enviar una inscripción desde celular y revisar el consentimiento y enlace de WhatsApp.
- [ ] Crear un evento nacional Wompi/COP y comprobar que no ofrece USD ni pago manual simultáneo.
- [ ] Crear un evento global Wompi/COP + Stripe/USD y comprobar que muestra ambos precios sin conversión.
- [ ] Crear un evento local con QR o transferencia, adjuntar un comprobante pequeño y revisar su auditoría.

### Tercero: Excel web y OneDrive

- [ ] Abrir la operación de un evento que tenga inscripciones.
- [ ] Pulsar `Actualizar Excel en OneDrive` y abrir `Inscripciones.xlsx` desde Documentos internos.
- [ ] Confirmar que abre en Excel web sin instalar Microsoft 365.
- [ ] Revisar las hojas `Inscripciones` y `Resumen financiero`, las preguntas adicionales y la separación COP/USD.
- [ ] Ejecutar una segunda actualización y confirmar que cambia la hora de `Actualizado` y reemplaza el mismo archivo.
- [ ] Usar `Descargar una copia` una vez para validar la alternativa fuera de línea.

### Decisiones que debe dejar definidas el usuario

- [ ] Elegir el plazo de retención de comprobantes: 90, 180, 365 días u otro aprobado por Contabilidad.
- [ ] Definir quién puede aprobar y rechazar pagos manuales a nivel local, regional y nacional.
- [ ] Recopilar los datos bancarios, QR e instrucciones autorizadas de cada iglesia que operará pagos locales.
- [ ] Decidir si se agrega una Lista de SharePoint para inscripciones en tiempo real además del Excel.
- [ ] Definir si Cumbre Mundial 2026 continúa activa, entra en cierre contable o se archiva.
- [ ] Registrar el vencimiento del secreto de Microsoft Entra y confirmar biblioteca privada, permisos mínimos y variables de Vercel.

### Pendientes añadidos por la revisión técnica del 13 de julio

- [ ] En celular angosto —idealmente 320 px y 390 px— abrir `Eventos`, `Donaciones`, `Iglesias`, `Campus` y `Portal`; confirmar que el encabezado, el menú y los botones se pueden tocar sin desplazamiento horizontal.
- [ ] Confirmar en Vercel que `CRON_SECRET` existe en Producción. No copiar su valor; basta revisar que esté configurado.
- [ ] Revisar en los logs de Vercel una ejecución exitosa de cada tarea activa: recordatorios de Donaciones, suscripciones de Donaciones, suscripciones de Campus, alertas de seguridad, conciliación Wompi y retención de comprobantes.
- [ ] Hacer una suscripción Wompi de monto mínimo autorizado en modo de prueba y comprobar que una segunda ejecución simultánea no crea dos donaciones ni dos cobros.
- [ ] Reenviar una vez el mismo webhook de prueba Wompi y Stripe; confirmar que no aumenta otra cuota, no duplica el movimiento y no vuelve a enviar el aviso de pago recibido.
- [ ] Si Cumbre continúa activa, autorizar explícitamente la programación de cobros y recordatorios de cuotas; hasta esa decisión ambos procesos de Cumbre permanecen sin cron para evitar cobros o mensajes inesperados.
- [ ] Si Cumbre continúa activa, comprobar que `CUMBRE_CRON_SECRET` o `CRON_SECRET` está configurado y hacer una ejecución controlada sin pagos reales de alto valor.
- [ ] Desde el Centro de Soluciones de Cumbre, ejecutar la auditoría de paquetes en vista previa y revisar los casos marcados antes de autorizar cualquier corrección.
- [ ] Enviar un único aviso controlado de Cumbre por correo o WhatsApp y confirmar remitente, destinatario, texto y registro de auditoría; no hacer envío masivo durante QA.

No apareció ningún SQL adicional por ejecutar como resultado de esta revisión.

## 1. Lo primero que debe hacerse en casa

No ejecutar desde el celular. Usar el SQL Editor del proyecto correcto de Supabase y correr cada archivo por separado, esperando a que termine antes del siguiente.

- [x] 1. Ejecutar `docs/sql/event_documents_sharepoint.sql`.
  - Activa los metadatos y la auditoría para documentos privados de cada evento.
  - Resultado esperado: aparecen las tablas de documentos y auditoría indicadas al final del script.
- [x] 2. Ejecutar `docs/sql/event_payment_evidence_sharepoint.sql`.
  - Activa almacenamiento privado, revisión y retención controlada de comprobantes manuales.
  - Resultado esperado: existe `event_payment_evidence` con referencias de SharePoint y retención.
- [x] 3. Ejecutar `docs/sql/finance_scopes_hierarchy.sql`.
  - Separa Finanzas global, nacional, regional y local.
  - Wompi queda siempre como recaudo nacional de Colombia.
  - Stripe queda como recaudo global/internacional.
  - QR, transferencia o efectivo con iglesia quedan como recaudo local.
  - Resultado esperado: la consulta final no muestra Wompi fuera de `NATIONAL/colombia` ni Stripe fuera de `GLOBAL`.
- [x] 4. Ejecutar `docs/sql/events_dual_currency_payments.sql`.
  - Activa precio COP para Wompi y precio USD para Stripe dentro del mismo evento global.
  - Resultado esperado: existen `price_cop`, `price_usd` y los RPC seguros incluidos en el script.

Los cuatro scripts fueron ejecutados y verificados el 13 de julio de 2026. Los contratos finales devolvieron documentos, comprobantes, 27 movimientos Wompi nacionales de Colombia, 16 movimientos Stripe globales y las tres funciones de cobro dual esperadas.

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
- [x] Agregar filtros, periodos y exportes al panel de Finanzas sin mezclar COP y USD.
- [x] Identificar el Excel en línea y mostrar la hora real de su última actualización en la operación de Eventos.
- [ ] Conectar la Lista de SharePoint de inscripciones si se aprueba.
- [ ] Añadir la política de retención únicamente después de recibir el plazo aprobado.
- [x] Endurecer autenticación de tareas programadas y exportes de Cumbre sin exponer secretos en la URL.
- [x] Evitar cobros recurrentes duplicados por concurrencia en Donaciones y deduplicar reintentos/avisos de webhooks de Cumbre.
- [x] Probar por contrato que Campus mantiene COP/Wompi y USD/Stripe, incluyendo asignaciones por misionero.
- [ ] Completar QA y cierre contable de Cumbre según la decisión del punto 7.
- [x] Optimizar animaciones móviles y terminar los atributos pendientes del Home.
- [ ] Revisar copy final y consistencia visual de las páginas públicas.
- [x] Mantener pruebas automáticas de eventos, comprobantes, finanzas y roles.

## 11. Qué no debe hacerse

- No compartir secretos, tokens ni llaves en SQL, Git, capturas o conversaciones.
- No conceder permisos globales de SharePoint cuando basta una biblioteca o lista seleccionada.
- No aprobar pagos automáticos manualmente.
- No mezclar ni sumar COP con USD.
- No usar Wompi para recaudo local: Wompi pertenece siempre al recaudo nacional de Colombia.
- No eliminar comprobantes hasta tener una política de retención aprobada.
- No cambiar el rol pastoral principal para entregar un permiso financiero adicional.

## 12. Decisiones tuyas para la carta de calidad

La carta completa quedó consolidada en [`docs/UX_NON_NEGOTIABLES.md`](./UX_NON_NEGOTIABLES.md). Estas son únicamente las decisiones que requieren tu aprobación; la auditoría e implementación técnica corresponden al equipo web bajo MANA-025.

### Aprobar el estándar

- [ ] Aprobar WCAG 2.2 AA como línea base interna para todo el sitio y conservar 44 × 44 px como objetivo táctil propio, especialmente pensando en pastores mayores.
- [ ] Aprobar las excepciones de seguridad: no usar UI optimista ni `Deshacer` como única protección en pagos, permisos, aprobaciones financieras, mensajes masivos o borrados definitivos.
- [ ] Confirmar que la paleta de comandos y los atajos serán obligatorios en el Portal y herramientas de uso diario, pero no en las páginas públicas salvo necesidad comprobada.
- [ ] Confirmar que cualquier excepción a la carta debe registrar motivo, responsable y fecha de revisión en el Workboard.

### Definir prioridades de producto

- [ ] Elegir los primeros módulos para la auditoría formal. Orden recomendado: Portal/Eventos, Finanzas, Donaciones/Campus, Iglesias y páginas públicas.
- [ ] Decidir si las primeras funciones de personalización serán vistas guardadas y densidad del Portal; dejar temas para una fase posterior.
- [ ] Definir qué formularios necesitan autosave obligatorio. Recomendación inicial: creación/edición de Eventos, inscripción extensa y operaciones financieras manuales.
- [ ] Definir en qué procesos vale la pena trabajar con red inestable u offline. Recomendación inicial: borradores de formularios, listas de asistentes y revisión operativa; nunca almacenar secretos ni datos financieros completos sin protección adicional.

### Seguridad, privacidad y continuidad

- [ ] Definir qué roles tendrán 2FA obligatorio. Recomendación: superadmin, finanzas, administradores nacionales y cualquier rol que apruebe pagos o gestione permisos.
- [ ] Nombrar el responsable interno de privacidad y el canal para solicitudes de acceso, corrección, exportación y supresión de datos.
- [ ] Aprobar una matriz de retención para inscripciones, comprobantes, auditorías, notificaciones y respaldos; no asumir que “borrar” elimina de inmediato una obligación contable o legal.
- [ ] Confirmar con asesoría jurídica la política de tratamiento bajo Ley 1581 de 2012 y, si se ofrecen servicios cubiertos a personas en la Unión Europea, la aplicabilidad específica del European Accessibility Act.
- [ ] Definir objetivos de continuidad: cuánto dato se puede perder como máximo —RPO— y cuánto tiempo puede estar caído cada servicio —RTO—.
- [ ] Designar quién revisará trimestralmente restauración de respaldos, rotación de secretos, dependencias vulnerables y alertas de producción.

### Rendimiento y medición

- [ ] Aprobar el presupuesto recomendado: feedback local visible en menos de 100 ms; acciones de servidor por debajo de 400 ms en p75 cuando sea viable; si tardan más, progreso útil y trabajo preservado.
- [ ] Definir la matriz mínima de dispositivos y redes para QA. Recomendación: 320, 390 y 430 px; Android gama media; iPhone; escritorio 1366 y 1440 px; red lenta simulada.
- [ ] Confirmar si se habilitarán métricas continuas de rendimiento y errores en Vercel sin enviar datos personales a analítica.

### Estado actual frente a tus no negociables

- **Más sólido:** separación de monedas/proveedores, idempotencia, roles por alcance, auditoría de operaciones sensibles, exportes y responsive de páginas principales.
- **Parcial:** accesibilidad integral, tokens y escala tipográfica, recuperación universal de formularios, internacionalización completa, tablas homogéneas y privacidad autoservicio.
- **Pendiente de construir o medir:** paleta de comandos, vistas guardadas/densidad, presupuesto p75, restauración probada con RPO/RTO y auditoría WCAG 2.2 AA completa.

### Revisión visual del contrato de espaciado

- [ ] Después del próximo despliegue, revisar en celular y escritorio los botones, badges, tarjetas y gutters compartidos. Confirmar que el ritmo de múltiplos de 8 se siente cómodo y no demasiado amplio, especialmente para pastores mayores.
- [ ] En `/portal/events`, abrir “Nuevo evento” y recorrer el formulario completo; luego abrir la operación de un evento y revisar documentos, filtros, inscritos y el diálogo de pago manual. Confirmar que ningún bloque se siente amontonado ni excesivamente separado.
- [ ] En `/portal/finances`, revisar filtros, subtotales COP/USD, tabla en escritorio, tarjetas en celular y alertas de pago. Confirmar que sigue siendo fácil distinguir monedas, cuentas y acciones sin exceso de aire.
- [ ] Abrir una invitación pública en `/eventos/[slug]` con arte horizontal, cuadrado y vertical; revisar portada, franja de datos, bloque de ayuda y formulario en celular y escritorio. Confirmar que el arte no se deforma y que el ritmo visual se siente natural.
- [ ] Con una cuenta de prueba, recorrer `/portal/ingresar`, recuperación de contraseña, `/portal/registro` y un enlace real de `/portal/activar`. Confirmar que los errores conservan lo escrito, los correos llegan y ninguna cuenta real queda bloqueada.
- [ ] En `/portal`, recorrer las pestañas Resumen, Mis Eventos, Mis Aportes, Mi Perfil y Eventos a 390 px y en escritorio. Confirmar que el título cambia con claridad, que no aparece scroll horizontal y que los filtros siguen siendo fáciles de usar.
- [ ] En `/portal`, provocar un aviso, una confirmación y abrir el detalle de una reserva. Confirmar que `Escape` cierra, que el foco vuelve al botón anterior y que el formulario obligatorio de perfil no se cierra accidentalmente.
- [ ] Cuando exista un evento abierto y totalmente configurado, en la pestaña Eventos de `/portal` abrir “Registrar participante”, escribir datos de prueba y comprobar que un clic fuera o `Escape` no borra el formulario. Cerrarlo únicamente con su botón y confirmar que el foco regresa a “Registrar participante”. Hoy los expedientes operativos disponibles están cerrados o el evento próximo aún pide configuración, por lo que el botón no se forzó.
- [ ] Desde ese registro, abrir “Seleccionar iglesia”; buscar por nombre o ciudad, recorrer los resultados con teclado y cerrar con `Escape`. Confirmar que el foco vuelve al selector y que ninguna iglesia ajena al alcance permitido puede asignarse.
- [ ] Repetir `/portal` con cuentas de prueba de usuario, pastor, finanzas y administrador; confirmar que cada persona solo ve los datos y acciones que le corresponden.
- [ ] Reportar cualquier pantalla donde el contenido se vea amontonado o demasiado separado; indicar ruta y captura. La migración se hará por módulo sin aceptar valores aislados nuevos.

No necesitas ejecutar SQL para esta carta ni para el contrato de espaciado. Primero aprueba las decisiones anteriores; después el equipo web convertirá cada brecha en tickets pequeños, verificables y desplegables.
