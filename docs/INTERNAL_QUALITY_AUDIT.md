# Auditoría de calidad de páginas internas

Fecha de inicio: 14 de julio de 2026.

Esta matriz aplica los 45 controles de la carta de calidad a cada ruta interna. Una ruta solo se marca como cerrada cuando tiene evidencia de código, pruebas y revisión real en escritorio y móvil. Ocultar una función en la interfaz nunca sustituye la validación de permisos en API y base de datos.

## Escala de resultado

- `Cumple`: existe evidencia suficiente y repetible.
- `Parcial`: la base está implementada, pero falta una prueba o una parte del contrato.
- `No cumple`: hay una brecha reproducible.
- `No aplica`: existe una justificación explícita para esa ruta.
- `Pendiente`: todavía no se ha revisado.

## Los 45 controles

| Grupo | Controles | Evidencia mínima |
| --- | --- | --- |
| Sistema visual | Q01-Q08 | Escala base 8, tipografía, color, jerarquía, consistencia, controles, estados y densidad. |
| Accesibilidad y adaptación | Q09-Q13 | Teclado, foco, nombres accesibles, reflow, formularios, navegación y rendimiento percibido. |
| Herramientas modernas | Q14-Q20 | Consultas paralelas, componentes compartidos, atajos cuando apliquen, optimismo seguro, deshacer seguro, leyes de UX y movimiento reducido. |
| Producto y confianza | Q21-Q31 | Velocidad, supervisión humana, calma, WCAG, personalización, seguridad, privacidad, resiliencia, localización, datos complejos y prevención de errores. |
| Contratos técnicos | Q32-Q39 | Autorización, auditoría, integridad financiera/temporal, continuidad, entrega segura, secretos, ciclo de vida y soporte. |
| Reglas de aplicación | Q40-Q45 | Objetivo táctil de 44 px, umbrales de respuesta, límites de UI optimista, límites de Deshacer, alcance de atajos y restricciones offline. |

Q40-Q45 corresponden a las seis aclaraciones obligatorias de medición de [`UX_NON_NEGOTIABLES.md`](./UX_NON_NEGOTIABLES.md). Por eso la carta contiene 39 principios numerados y 45 controles auditables.

## Inventario y fases

| Fase | Ruta o superficie | Riesgo principal | Estado |
| --- | --- | --- | --- |
| 1 | `BaseLayout`, modal global y navegación lateral | Teclado, foco, consistencia y permisos visibles | Cumple en código y producción; variación completa por roles pendiente |
| 1 | `/portal/ingresar` | Autenticación, recuperación y privacidad | Cumple en código y producción; ingreso y recuperación reales pendientes |
| 1 | `/portal/registro` | Datos personales, contraseña y validación | Cumple en código y producción; registro real pendiente |
| 1 | `/portal/activar` | Credencial nueva y enlace temporal | Cumple en código y producción; activación real pendiente |
| 2 | `/portal` | Resumen, perfil, aportes y eventos del usuario | Parcial avanzado: estructura, formularios, diálogos y controles dinámicos corregidos; producción y roles en revisión |
| 2 | `/portal/events` | Creación, imágenes, formularios, monedas y alcance | Cumple técnicamente en código y producción; creación real y variación por roles pendientes |
| 2 | `/portal/events/[id]` | Inscripciones, documentos y comprobantes | Parcial avanzado: base productiva revisada y estados dinámicos corregidos; prueba con inscripciones pendiente |
| 2 | `/portal/users` | Roles y finanzas adicionales por alcance | Parcial avanzado: lista y creación cumplen en producción; variación de roles y Finanzas pendiente |
| 2 | `/portal/regions` | Jerarquía territorial y autorización | Cumple técnicamente en código y producción; mutaciones reales y variación por roles pendientes |
| 3 | `/portal/finances` | Monedas, alcance, exportes y datos complejos | Cumple técnicamente en código y producción; exportes y variación real por alcance pendientes |
| 3 | `/portal/donations` | Wompi/Stripe, campañas y conciliación | Cumple técnicamente en código y producción; conciliación real y variación por alcance pendientes |
| 3 | `/portal/campus` | Misioneros, monedas y asignación de destino | Pendiente |
| 3 | `/portal/peticiones` | Privacidad pastoral y acceso mínimo | Pendiente |
| 4 | `/portal/content` | Publicación, imágenes, borradores y auditoría | Pendiente |
| 4 | `/portal/content-preview` | Vista previa segura y fidelidad visual | Pendiente |
| 4 | `/portal/integrations` | Secretos, Microsoft 365 y mínimo privilegio | Pendiente |
| 4 | `/admin/cumbre/manual` | Operación sensible, auditoría y cierre | Pendiente |

## Registro de la fase 1

### Evidencia transversal implementada

- Enlace visible al enfocar para saltar al contenido principal.
- Modal global con semántica de diálogo, foco inicial, encierro de foco, cierre con `Escape` y devolución del foco.
- Navegación lateral con objetivos táctiles de 44 px, `aria-current`, menú móvil anunciado y cierre con `Escape`.
- Ingreso, registro y activación migrados a la escala base 8 y bloqueados como archivos estrictos.
- Registro adaptable a una columna en anchos pequeños, explicación de uso de datos y requisitos de contraseña persistentes.
- Estados de autenticación conservan `aria-live`; los botones de mostrar contraseña informan su estado.
- Contrato automático `test:internal-quality` con cuatro verificaciones transversales.
- Revisión local a 320 px sin desborde horizontal, campos sin etiqueta ni controles táctiles menores a 44 px.
- Validación vacía comprobada: dos campos marcados, diálogo anunciado, foco en “Cerrar aviso”, cierre con `Escape` y retorno al botón de envío.

### Verificación de producción de la fase 1

- A 390 px, ingreso y registro no tienen desborde horizontal, campos sin etiqueta ni objetivos táctiles menores a 44 px.
- El diálogo de validación se anuncia, recibe el foco, cierra con `Escape` y devuelve el foco al control que lo abrió.
- Activación sin token presenta un estado seguro y mantiene inhabilitados los controles que no pueden ejecutarse.
- A 390 y 1280 px, la navegación lateral conserva ubicación, cierre con `Escape` y objetivos de 44 px.

### Cierre humano requerido para cada ruta de la fase 1

- Confirmación con cuenta real de que errores y carga preservan los datos escritos.
- Prueba real de ingreso, recuperación, registro y activación únicamente con cuentas autorizadas.

## Registro de la fase 2 — `/portal`

### Evidencia implementada

- Un solo `h1` para el panel; cada pestaña usa un título asociado a su región y actualiza `aria-hidden` al cambiar.
- Carga, error y datos parciales tienen estados anunciables y acciones de reintento sin eventos inline.
- Perfil, seguridad, onboarding, filtros operativos e invitaciones cuentan con nombres accesibles y ayuda persistente cuando aplica.
- Objetivos táctiles estáticos y dinámicos críticos migrados a 44 px; la deuda de espaciado de `src/pages/portal` bajó de 387 a 359 clases y la de `src/scripts` de 403 a 381.
- Onboarding, aviso, confirmación y detalle de reserva tienen semántica de diálogo, encierro de foco, cierre seguro con `Escape` y devolución del foco. El onboarding obligatorio no se descarta con `Escape`.
- El registro manual conserva el formulario ante clics accidentales o `Escape`; el selector de iglesia tiene diálogo accesible, filtros etiquetados, foco controlado y salida dinámica escapada.
- Paginación, filtros, asignación de iglesia, planes, pagos, donaciones, Campus y calendario generados dinámicamente tienen nombre accesible y objetivo táctil mínimo.
- Contrato automático ampliado de cuatro a ocho verificaciones.
- Producción verificada en `ministeriomana.org`: a 390 px la operación renderizó 110 controles y a 1280 px 123; en ambos casos hubo cero controles menores de 44 px, cero controles sin nombre, un solo `h1` y ningún desbordamiento horizontal.
- Los diálogos avanzados están desplegados con su contrato semántico. Su interacción completa permanece pendiente porque no existe actualmente un evento abierto y configurado que habilite “Registrar participante”; no se forzó el control deshabilitado de expedientes cerrados.

### Cierre técnico requerido para `/portal`

- Terminar la migración gradual de espaciado en `portal-dashboard.js`, `portal-user-event-view.js`, `RegistrationModal` y el resto del panel hasta poder marcarlos estrictos.
- Probar las cinco pestañas con roles usuario, pastor, finanzas y administrador, sin ampliar permisos visibles ni efectivos.
- Abrir en producción el registro manual y el selector de iglesia cuando exista un evento operativo habilitado; comprobar preservación de datos, `Escape` y devolución de foco sin guardar una inscripción.

## Registro de la fase 2 — `/portal/events`

### Evidencia implementada

- La lista mantiene un solo `h1`, filtros con nombre accesible, estados de carga/vacío/error y presentación adaptable de artes horizontales, cuadrados y verticales.
- Los filtros de estado usan un grupo de botones con `aria-pressed`; filtros, acciones, campos y botones críticos tienen objetivo táctil mínimo de 44 px.
- El formulario de evento anuncia su diálogo con `aria-hidden`, encierra y devuelve el foco, y no descarta el trabajo por `Escape` ni por un clic accidental en el fondo.
- Cerrar o cancelar con cambios exige una decisión explícita, y salir de la página con el formulario modificado activa la protección del navegador.
- El calendario conserva el botón “Listo” y lleva días, navegación, hora y confirmación a objetivos táctiles de 44 px.
- El contrato automático de calidad interna suma nueve verificaciones.
- Producción verificada en `ministeriomana.org`: la lista, el formulario y los 48 controles del calendario quedaron sin objetivos menores de 44 px ni desbordamiento a 390 px; a 1280 px hubo cero controles pequeños o sin nombre, un solo `h1` y ningún desbordamiento.
- Con un título temporal no guardado, `Escape` y el clic de fondo conservaron el texto; el cierre explícito mostró la decisión de descarte y devolvió el foco a “Nuevo evento”.

### Cierre técnico requerido para `/portal/events`

- Probar creación y edición con alcances local, regional, nacional y global usando cuentas autorizadas, sin guardar datos de prueba innecesarios.
- Revisar el flujo de archivar/restaurar y definir el mecanismo de deshacer antes de sustituir la confirmación actual.

## Registro de la fase 2 — `/portal/events/[id]`

### Evidencia implementada

- La operación conserva un solo `h1`, navegación actual, resumen, documentos privados, filtros, carga, vacío, error y paginación anunciables.
- Enlace de regreso, actualización de archivos, filtros, paginación y acciones dinámicas de documentos, comprobantes, revisión y asistencia tienen objetivo táctil mínimo de 44 px.
- El diálogo sensible de aprobar o rechazar pago anuncia título y resumen, encierra y devuelve el foco, y protege la nota ante `Escape`, clic de fondo o salida accidental.
- Nombres, referencias, respuestas adicionales y URLs interpoladas por las tarjetas dinámicas se escapan antes de renderizarse.
- El contrato automático de calidad interna suma diez verificaciones.
- Producción verificada en `ministeriomana.org`: 11 controles visibles a 390 px y 24 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1` y ningún desbordamiento. El diálogo sensible llegó cerrado con título, descripción y `aria-hidden`. El evento disponible tenía cero inscripciones, por lo que los estados dinámicos permanecen cubiertos por contrato hasta disponer de un registro de prueba autorizado.

### Cierre técnico requerido para `/portal/events/[id]`

- Repetir la revisión productiva con una inscripción manual bajo revisión y un comprobante privado de prueba, sin aprobar ni rechazar pagos reales.
- Verificar la devolución del foco y preservación de la nota del diálogo abierto.
- Diseñar una corrección o deshacer seguro para check-in antes de reemplazar la confirmación actual.

## Registro de la fase 2 — `/portal/users`

### Evidencia implementada

- La lista conserva un solo `h1`, ubicación actual, búsqueda, filtros, resumen, tabla adaptable, paginación y estados de carga o vacío.
- Filtros, paginación y acciones dinámicas de acceso, rol, ciclo de vida y Finanzas tienen objetivo táctil mínimo de 44 px. La regla compartida de tablas del Portal dejó de anular este mínimo con un valor heredado de 40 px.
- El formulario de creación anuncia título y descripción, asocia cada etiqueta con su campo, usa ayudas persistentes y devuelve el foco al control que lo abrió.
- `Escape` y el clic de fondo conservan el formulario; el cierre explícito advierte antes de descartar datos y salir de la página con cambios activa la protección del navegador.
- El diálogo de alcances financieros anuncia el usuario seleccionado, encierra el foco y no cierra accidentalmente con `Escape` ni con un clic de fondo. No se modificó la autorización de API ni la separación del rol pastoral principal.
- El contrato automático de calidad interna suma once verificaciones.
- Producción verificada en `ministeriomana.org`: 39 controles visibles a 390 px y 52 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1` y ningún desbordamiento horizontal.
- Con un nombre temporal no guardado, `Escape` y el fondo conservaron el texto; el cierre explícito mostró la advertencia, limpió el formulario sin enviarlo y devolvió el foco a “Nuevo Usuario”.

### Cierre técnico requerido para `/portal/users`

- Abrir el diálogo de Finanzas con una cuenta superadmin autorizada y recorrerlo por teclado sin guardar cambios; confirmar alcance global, nacional, regional y local.
- Repetir la pantalla con cuentas de administración nacional, regional y local para confirmar que las acciones visibles y efectivas respetan el alcance.
- Probar una creación real únicamente con una cuenta y correo autorizados, confirmando invitación, error recuperable y auditoría sin exponer credenciales.

## Registro de la fase 2 — `/portal/regions`

### Evidencia implementada

- La ruta mantiene un solo `h1`, ubicación actual, validación administrativa antes de mostrar datos y carga en paralelo de regiones, ciudades y liderazgos.
- Los nueve campos tienen etiqueta persistente, asociación programática, ayuda contextual y objetivo táctil mínimo de 44 px. Errores y éxitos se anuncian por separado.
- Las tres tablas usan el componente adaptable del Portal: en anchos pequeños cada fila se convierte en una tarjeta con etiquetas visibles, sin desplazamiento horizontal.
- Editar una región ya no depende de un `prompt`: el formulario conserva el país y código como solo lectura, enfoca el nombre, permite cancelar y advierte antes de perder cambios.
- Crear, asignar ciudades y asignar liderazgo preservan lo escrito ante errores, bloquean envíos duplicados y protegen la salida con cambios pendientes.
- Asignar un rol regional, quitar una región de ciudades y revocar liderazgo exigen confirmación contextual; activar o desactivar permanece reversible desde la misma lista y lo informa al usuario.
- Datos dinámicos y atributos se escapan antes de insertarse; las acciones de editar, activar, desactivar y revocar tienen 44 px.
- `regions.astro` y `portal-regions.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. La deuda del módulo `src/pages/portal` bajó de 359 a 341 clases fuera de escala.
- El contrato automático de calidad interna suma doce verificaciones.
- Producción verificada en `ministeriomana.org`: 31 controles visibles a 390 px y 44 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1`, ningún desbordamiento horizontal y cero errores de consola.
- La edición de una región se abrió sin guardar: país y código quedaron protegidos, el foco llegó al nombre y el descarte solicitó confirmación. No se llamó a una operación de escritura durante QA.

### Cierre humano requerido para `/portal/regions`

- Crear, renombrar, desactivar y reactivar una región de prueba autorizada, comprobando el registro esperado sin alterar regiones reales.
- Asignar y revocar un liderazgo regional de prueba; confirmar el cambio de rol principal y el alcance efectivo con esa cuenta.
- Repetir acceso con administrador, pastor regional y colaborador regional para comprobar que solo admin y superadmin pueden administrar la jerarquía.

## Registro de la fase 3 — `/portal/finances`

### Evidencia implementada

- La ruta mantiene un solo `h1`, secciones con `h2`, alcance financiero visible y estados anunciables de carga, error, vacío y paginación.
- Filtros por período, fechas, cuenta/proveedor y moneda conservan COP y USD separados. Los exportes exigen una moneda explícita y no se ejecutaron durante QA.
- COP se presenta sin decimales y USD con dos centavos. Se eliminó el acumulador interno de totales mixtos por categoría, incluso aunque no se mostraba en pantalla.
- Una revisión de datos invalida respuestas antiguas de filtros y cargas paginadas; así una solicitud lenta no puede reemplazar una vista más reciente.
- Aplicar o limpiar filtros bloquea envíos repetidos, conserva feedback y devuelve el foco al botón que inició la actualización.
- Exportes, paginación, reintento y acciones de correo, WhatsApp y copiar mensaje tienen objetivo táctil mínimo de 44 px; los enlaces externos usan aislamiento de pestaña.
- Tabla y alertas se adaptan a celular sin desplazamiento horizontal, y los montos, cuentas, estados y subtotales mantienen jerarquía separada.
- El contrato automático de calidad interna suma trece verificaciones. Los archivos de Finanzas continúan estrictos respecto al contrato de espaciado.
- Producción verificada en `ministeriomana.org`: 41 controles visibles a 390 px y 54 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1`, ningún desbordamiento horizontal y cero errores de consola.
- El filtro de solo USD mostró `$1,188.00` y COP en cero; después “Limpiar” restauró `COP y USD separados`. Ambos controles recuperaron el foco tras la carga.

### Cierre humano requerido para `/portal/finances`

- Descargar un CSV COP y otro USD con un período acotado; comprobar encabezados, alcance, moneda única y apertura correcta en Excel web.
- Repetir con responsables global, nacional, regional y local para confirmar que interfaz, API y exportes entregan únicamente movimientos autorizados.
- Abrir un único correo y WhatsApp de prueba desde una alerta autorizada, sin envío masivo, y revisar destinatario y texto antes de enviar.

## Registro de la fase 3 — `/portal/donations`

### Evidencia implementada

- La ruta mantiene un solo `h1`, alcance financiero visible, filtros anunciables, estados de carga, error y vacío, paginación y tabla adaptable a tarjetas en celular.
- Los acumulados explican que corresponden únicamente a donaciones aprobadas visibles. COP se presenta sin decimales y USD con dos centavos, sin sumar monedas distintas.
- Cada fila muestra proveedor y moneda juntos. Wompi espera COP y Stripe espera USD; una combinación distinta recibe una advertencia visible para revisión, sin corregir datos silenciosamente.
- Respuestas antiguas de filtros o paginación ya no pueden reemplazar una vista más reciente. El control que inicia un filtro recupera el foco cuando termina la carga.
- La conciliación de Wompi pasó de cuadros nativos a un diálogo con título, descripción, referencia, campo etiquetado, foco inicial y encierro de foco. La interfaz explica que consulta un pago existente y no crea cobros ni mueve dinero.
- `Escape` conserva un ID escrito y el clic de fondo no cierra accidentalmente. El cierre explícito advierte antes de descartarlo y devuelve el foco a la referencia que abrió el diálogo.
- La aprobación manual excepcional solo aparece si el servidor confirma que está habilitada, exige ID de transacción y una confirmación explícita de revisión en el panel oficial de Wompi. La API conserva la validación administrativa, unicidad de referencia y comprobación de proveedor, monto y moneda cuando Wompi responde.
- El fallback de esquema ya no ignora silenciosamente un filtro por concepto que no puede aplicar; falla cerrado con una indicación operativa.
- Todos los controles visibles y dinámicos tienen objetivo táctil mínimo de 44 px. `donations.astro` y `portal-donations.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos.
- El contrato automático de calidad interna suma catorce verificaciones. Los contratos de operaciones confirmaron nuevamente COP/Wompi, USD/Stripe e idempotencia de cobros recurrentes.
- Producción verificada en `ministeriomana.org`: 14 controles visibles a 390 px y 27 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1` y ningún desbordamiento horizontal. No aparecieron combinaciones proveedor/moneda inconsistentes en la carga revisada.
- El diálogo se abrió sobre una referencia pendiente sin enviar la operación. Un ID temporal se conservó con `Escape`, el foco pasó al cierre, y al limpiar y cerrar volvió a “Sincronizar Wompi”. Los filtros recuperaron el foco y mostraron USD con centavos.

### Cierre humano requerido para `/portal/donations`

- Repetir con responsables financieros global, nacional, regional y local para confirmar que cada alcance recibe únicamente registros autorizados.
- Conciliar una sola referencia pendiente autorizada después de compararla con el panel oficial de Wompi; confirmar que no se genera un cobro nuevo y que el estado y la auditoría local se actualizan una sola vez.
- Si la aprobación manual excepcional está habilitada, probarla únicamente con una referencia controlada y evidencia oficial de Wompi. No aprobar manualmente una referencia que no coincida en monto, moneda y titular.
- Revisar “Cargar más” con un filtro acotado y comprobar que conteo y acumulados aprobados visibles crecen sin duplicar filas.

## Regla de actualización

Cada fase debe dejar: archivos estrictos cuando lleguen a cero, pruebas ejecutadas, hallazgos pendientes con responsable y una revisión en producción. Las decisiones humanas se copian a `PENDIENTES_USUARIO_2026-07-13.md`; las brechas técnicas permanecen en MANA-025 hasta cerrarse.
