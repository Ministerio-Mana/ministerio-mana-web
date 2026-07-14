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
| 3 | `/portal/campus` | Misioneros, monedas y asignación de destino | Cumple técnicamente en código y producción; cuentas reales por alcance y misionero pendientes |
| 3 | `/portal/peticiones` | Privacidad pastoral y acceso mínimo | Cumple técnicamente en código y producción; decisiones reales y variación por roles pendientes |
| 4 | `/portal/content` | Publicación, imágenes, borradores y auditoría | Cumple técnicamente en código y producción; mutaciones controladas, ImageKit y variación por roles pendientes |
| 4 | `/portal/church-page` | Páginas locales, plantillas, ImageKit y alcance territorial | Cumple técnicamente en código; SQL, publicación controlada y variación por roles pendientes |
| 4 | `/portal/content-preview` | Vista previa segura y fidelidad visual | Parcial avanzado: contrato, despliegue y acceso privado verificados; bloques reales y roles pendientes |
| 4 | `/portal/integrations` | Secretos, Microsoft 365 y mínimo privilegio | Parcial avanzado: contrato, despliegue y acceso restringido verificados; lectura real con superadmin individual pendiente |
| 4 | `/admin/cumbre/manual` | Operación sensible, auditoría y cierre | Cumple técnicamente en código y producción; SQL, sesión individual y escritura controlada pendientes |

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

## Registro de la fase 3 — `/portal/campus`

### Evidencia implementada

- La ruta mantiene un solo `h1`, alcance visible, estadísticas, filtros por relación y misionero, búsqueda, carga progresiva local y estados de carga, error y vacío anunciables.
- El permiso adicional de Finanzas ahora se resuelve igual en navegación y API. Un pastor u otro rol principal con una asignación financiera válida puede entrar sin reemplazar su rol pastoral.
- La vista administrativa aplica en servidor el alcance financiero global, nacional, regional o local. Si las columnas de separación no existen para un alcance limitado, la API falla cerrada en lugar de entregar el libro global.
- El misionero Campus sin permiso financiero conserva una vista personal construida por asignaciones, identificador y respaldo legado. Si además recibe Finanzas, la vista administrativa respeta únicamente el alcance financiero asignado.
- Estadísticas y texto ya no prometen un total histórico ilimitado: hablan de donantes y aportes aprobados visibles. Cuando la consulta alcanza su límite, una nota indica cuántos registros se cargaron y remite al histórico contable de Finanzas.
- COP se presenta sin decimales y USD con dos centavos. Cada aporte administrativo muestra proveedor y moneda; Wompi espera COP y Stripe espera USD, con advertencia visible ante una combinación distinta.
- El conteo de misioneros usa primero el `slug` canónico y solo recurre a identificador o nombre cuando no existe, evitando contar a la misma persona dos veces.
- Búsqueda y filtro por misionero consideran todos los destinos del donante, no solo la asignación más reciente. “Mostrar más” enfoca la primera tarjeta nueva para no perder la posición de teclado.
- Correo y WhatsApp tienen objetivo táctil de 44 px; WhatsApp abre aislado en otra pestaña. No se abrió ni envió ninguna comunicación durante QA.
- Todos los filtros, campos, reintento, contactos y carga progresiva respetan 44 px. Las etiquetas de misionero y búsqueda son visibles y están asociadas a sus controles.
- `campus.astro` y `portal-campus.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. El contrato automático de calidad interna suma quince verificaciones.
- Producción verificada en `ministeriomana.org`: 17 controles visibles a 390 px y 30 a 1280 px, con cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1` y ningún desbordamiento horizontal. Los cinco donantes visibles mostraron seis misioneros canónicos y cero alertas proveedor/moneda.
- Los filtros “Recurrentes” y misionero, la búsqueda sin resultados y su restauración se probaron sin escrituras. El foco permaneció en las acciones locales y la vista regresó a “Todos”.

### Cierre humano requerido para `/portal/campus`

- Entrar con una cuenta de misionero Campus y confirmar que solo aparecen sus donantes, sin montos administrativos ni contactos ajenos.
- Repetir con responsables financieros global, nacional, regional y local; comparar una muestra contra Finanzas y confirmar que el alcance visible coincide.
- Abrir un único correo y WhatsApp de prueba sin enviar inmediatamente; revisar destinatario, nombre del donante y texto pastoral antes de autorizar el mensaje.
- Probar un aporte Campus controlado con Wompi/COP y otro con Stripe/USD; confirmar asignaciones por misionero, monto por misionero y total contable sin duplicados.
- Cuando el histórico supere el límite visible, confirmar que aparece la nota de cobertura y que Finanzas conserva el histórico completo.

## Registro de la fase 3 — `/portal/peticiones`

### Evidencia implementada

- El acceso de lectura reconoce el rol principal y la asignación adicional de intercesión. El cliente usa el permiso consolidado de sesión y el API valida nuevamente identidad, rol e IP autorizada.
- `intercessor` quedó limitado a lectura pastoral. Solo `admin` y `superadmin` pueden publicar, conservar privada o rechazar una petición; la regla coincide en interfaz y servidor.
- El listado aplica paginación de 50 registros, totales globales y cobertura visible por filtro. Consultas de filas y conteos se ejecutan en paralelo y una respuesta tardía no reemplaza una vista más reciente.
- El API entrega únicamente los campos necesarios. No expone correo del revisor ni fechas internas de revisión; la nota administrativa solo se incluye para quienes pueden moderar. Las respuestas sensibles usan `private, no-store`.
- Publicar, conservar privada y rechazar pasaron de `prompt` y `alert` nativos a un diálogo contextual con propósito, resumen, foco inicial, encierro de foco, `Escape` y devolución del foco.
- Antes de publicar se recuerda revisar teléfonos, correos, direcciones e información sensible. La nota de rechazo es interna, tiene límite de 320 caracteres y no se envía a la persona.
- Una nota escrita se conserva ante `Escape` o clic de fondo. El descarte exige una segunda acción explícita y el formulario guardado ya no activa un falso aviso de trabajo pendiente.
- La actualización del servidor vuelve a comprobar visibilidad y estado en la misma operación. Si otra persona ya moderó la petición, responde conflicto y evita una segunda decisión silenciosa.
- Filtros, actualización, carga progresiva, reintento y acciones dinámicas respetan 44 px. Las etiquetas son visibles, los estados se anuncian y la tarjeta nueva recibe foco al paginar.
- `peticiones.astro` y `portal-prayers.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. El contrato automático de calidad interna suma dieciséis verificaciones.
- Producción verificada en `ministeriomana.org` a 390 px: cinco controles visibles, cero objetivos menores de 44 px, cero controles sin etiqueta, un solo `h1` y ningún desbordamiento horizontal. El filtro sin resultados y “Actualizar” restauraron correctamente el foco.
- La bandeja productiva mostró un registro publicado, un total coherente y ninguna petición pendiente. Por seguridad no se alteró el registro real ni se forzó el diálogo con datos inventados.

### Cierre humano requerido para `/portal/peticiones`

- Crear tres peticiones públicas de prueba, sin nombres completos, teléfonos, correos, direcciones ni información pastoral real; usar una para cada decisión: publicar, conservar privada y rechazar.
- Con una cuenta de intercesión principal o adicional, confirmar que puede leer las peticiones autorizadas pero no ve controles de moderación ni notas administrativas.
- Con `admin` y `superadmin`, recorrer los tres diálogos sin confirmar primero. En rechazo, escribir una nota temporal y comprobar que `Escape` y el fondo la conservan; descartarla únicamente mediante la acción explícita.
- Confirmar que dos revisores no pueden decidir la misma petición: la segunda sesión debe recibir el mensaje de que la petición cambió y actualizar la bandeja.
- Antes de publicar una petición de prueba, revisar manualmente que el texto no permita identificar a la persona ni revele datos sensibles.

## Registro de la fase 4 — `/portal/content`

### Evidencia implementada

- El CMS productivo está activo y conserva tres páginas en borrador: Inicio, Eventos y Noticias. La auditoría no creó, publicó ni eliminó contenido real.
- Las ediciones de página, secciones y los formularios “Nueva página” y “Nueva sección” se conservan como borradores de sesión en la pestaña. Cambiar de página no los elimina y una recarga puede recuperarlos.
- Los formularios largos advierten antes de abandonar la pestaña. `Escape` y el fondo conservan lo escrito; descartar exige una segunda acción explícita y devuelve el foco al control que abrió el diálogo.
- Crear página, crear sección y confirmar acciones sensibles usan diálogos con propósito, descripción, resumen, foco inicial, encierro de foco, estados anunciados y controles de 44 px.
- Guardar página o sección incluye la fecha de versión esperada. Si otra persona editó primero, el servidor responde conflicto y no sobrescribe silenciosamente el cambio reciente.
- Publicar o despublicar exige una confirmación contextual y bloquea la acción mientras existan borradores locales. La actualización de página usa control de concurrencia; si fallan las secciones, intenta restaurar el estado anterior y no registra una publicación incompleta como exitosa.
- Archivar una sección dejó de ser un borrado definitivo: el contenido permanece guardado, puede restaurarse y ofrece “Deshacer”. El reordenamiento compensa el primer movimiento si el segundo no puede completarse.
- Eliminar un medio dejó de usar `confirm` nativo. El diálogo identifica archivo y proveedor, advierte revisar referencias publicadas y no ejecuta nada hasta la confirmación explícita. ImageKit, su token de carga y el registro de auditoría existentes no se modificaron.
- Las respuestas tardías al cambiar de página o carpeta multimedia ya no reemplazan una vista reciente. Cargas largas conservan progreso útil y los fallos por archivo permanecen listos para reintentar.
- `content.astro` y `portal-content.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. El contrato automático de calidad interna suma diecisiete verificaciones. La deuda global bajó a 1.329 clases fuera de escala.
- Producción final verificada en `ministeriomana.org`: a 390 × 844 hubo 22 controles visibles, cero objetivos menores de 44 px, cero controles sin nombre, un solo `h1`, ningún desbordamiento horizontal y cero errores de consola. El mismo diseño se comprobó a 1280 px antes del último ajuste, que únicamente añadió el nombre accesible del selector técnico de carpetas.
- Se escribió y descartó un borrador temporal sin enviarlo. `Escape` conservó sus tres campos; “Borrar borrador y cerrar” limpió el formulario y devolvió el foco. La confirmación de publicación mostró “Inicio · /”, cerró con `Escape`, devolvió el foco a “Publicar” y la página permaneció en borrador.

### Cierre humano requerido para `/portal/content`

- Crear una página de prueba en una ruta no pública, editarla, recargar la misma pestaña y confirmar que el borrador local se recupera antes de guardar.
- Abrir la misma página con dos cuentas administrativas de prueba; guardar un cambio en la primera y comprobar que la segunda recibe el conflicto sin sobrescribirlo.
- Crear una sección de prueba, guardarla, archivarla, usar “Deshacer” y confirmar en el historial que el contenido nunca fue eliminado.
- Abrir la vista previa y comparar texto, imágenes, orden y responsive sin publicar primero. Después publicar y despublicar únicamente la página controlada.
- Subir una imagen pequeña autorizada a ImageKit, usarla en la página de prueba y confirmar que no se elimina mientras esté referenciada. Luego retirar la referencia, eliminar el medio controlado y revisar su auditoría.
- Entrar con `admin`, `superadmin` y una cuenta sin administración; confirmar que solo las dos primeras acceden al CMS y a sus API. Decidir aparte si el producto necesita un rol editorial nuevo antes de ampliar permisos.

### Ampliación no-code de `/portal/content` — 14 de julio de 2026

- La configuración principal muestra título y descripción; ruta, idioma, nombre interno y SEO quedan bajo revelado progresivo.
- Cada bloque presenta tipo y estado como información protegida. El orden se cambia con controles visuales y ya no acepta una posición numérica manual.
- `Historia Maná` ofrece campos guiados, presets cerrados y entre dos y ocho escenas; no expone JSON ni parámetros de animación.
- El selector de ImageKit evita copiar y pegar URLs, conserva búsqueda, foco y objetivos táctiles, y aplica el medio elegido al borrador correcto.
- El servidor normaliza todo el documento, elimina propiedades desconocidas, rechaza URLs inseguras y exige una historia completa antes de publicar.
- La publicación pública del CMS quedó conectada por ruta, respetando prioridad de las páginas Astro existentes y sirviendo únicamente estados publicados.
- Compilación y contrato de espaciado pasan sin aumentar deuda. Falta la prueba autenticada con medios reales y las tres orientaciones.

## Registro de la fase 4 — `/portal/church-page`

### Evidencia implementada

- El editor ofrece tres plantillas protegidas: `Esencial`, `Historia` y `Mosaico`. Los pastores completan información, escenas e imágenes sin editar CSS, JSON ni parámetros libres de animación.
- Los permisos se vuelven a comprobar en cada API. Administración conserva alcance global; equipos nacionales, regionales y locales reciben únicamente las iglesias que les corresponden. La sesión compartida por contraseña no puede escribir.
- Borrador y publicación están separados. Guardar no modifica la página pública; publicar copia una instantánea validada y usa versión esperada para impedir que una sesión sobrescriba silenciosamente a otra.
- Slug, correo, WhatsApp, textos, escenas, galería y URLs se normalizan en servidor. La publicación exige portada con texto alternativo, horarios, descripción, contacto y escenas completas cuando la plantilla las necesita.
- ImageKit usa carga directa firmada, verificación posterior en servidor y carpeta estable por iglesia. Una página solo puede guardar imágenes registradas en la biblioteca de su propia sede.
- La galería admite seis imágenes en la interfaz y el relato entre dos y seis escenas. Horizontal, cuadrada y vertical se adaptan con `cover`, `contain`, punto focal o composición editorial según la plantilla; no se deforman.
- Los borradores se conservan durante la sesión, salir de la pestaña activa la recuperación local y los fallos de API no limpian lo escrito. La versión pública anterior permanece intacta hasta una publicación válida.
- El diálogo de medios anuncia propósito, encierra el foco, cierra con `Escape`, devuelve el foco y permite abrir el selector de archivos con teclado. Los controles críticos mantienen al menos 44 px.
- La ruta pública `/iglesias/{slug}` solo lee estados `PUBLISHED` y su `published_snapshot`; integra horarios, liderazgo, galería, WhatsApp, correo, mapa y los próximos eventos públicos de esa sede.
- `church-page.test.ts` y el contrato interno cubren normalización, requisitos de publicación, carpeta estable, alcance de medios, concurrencia, RLS e instantánea pública. Compilación y contrato de espaciado pasan sin agregar deuda.

### Cierre humano requerido para `/portal/church-page`

- Ejecutar `docs/sql/church_public_pages.sql` y confirmar las dos tablas indicadas al final del archivo.
- Entrar con una cuenta individual de una iglesia autorizada, cargar una imagen horizontal, una cuadrada y una vertical, y revisar el editor a 390 px y escritorio.
- Guardar un borrador y confirmar que la página pública anterior no cambia. Luego publicar una página controlada y comprobar directorio, mapa, contacto y evento local.
- Repetir con pastor o colaborador local, regional y nacional; cada cuenta debe ver únicamente sus sedes. Una cuenta sin alcance debe quedar bloqueada en navegación y API.
- Abrir el mismo borrador en dos sesiones y confirmar que la segunda recibe el conflicto de versión en vez de sobrescribir el cambio reciente.

## Registro de la fase 4 — `/portal/content-preview`

### Evidencia implementada

- La vista previa dejó de anidar un segundo `main` dentro del layout y ahora mantiene un único `h1` con el título de la página, estado editorial anunciado y retorno táctil de 44 px al CMS.
- El cliente valida sesión y rol antes de pedir datos. Solo `admin` y `superadmin` continúan; el nuevo API vuelve a comprobar el permiso en servidor.
- El API dedicado entrega únicamente página, estado, versión y campos necesarios de las secciones. No expone ajustes completos, SEO, usuarios creadores ni otros metadatos administrativos; página y secciones se consultan en paralelo.
- Secciones archivadas quedan fuera de la respuesta. La vista maneja portada, texto, galería, video, tarjetas, llamados a la acción y un estado básico para bloques avanzados.
- YouTube usa el dominio sin cookies, Vimeo conserva proveedor autorizado y los `iframe` aplican carga diferida y política de referencia estricta.
- Los enlaces muestran destino y estilo, pero el clic se intercepta y anuncia sin navegar. Esto evita salir accidentalmente o activar una acción externa mientras se revisa contenido privado.
- Estados de carga, vacío, error y reintento son explícitos. La solicitud vence a los quince segundos y una respuesta tardía no reemplaza un reintento más reciente.
- Las imágenes tienen textos alternativos y un estado “Imagen no disponible” ante fallos. Galerías pasan a una columna en móvil y todos los llamados mantienen 44 px.
- El botón del editor abre la ruta privada directamente desde el clic, evitando que el navegador bloquee la pestaña después de esperar una solicitud intermedia.
- `content-preview.astro` y `portal-content-preview.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. El contrato automático de calidad interna suma dieciocho verificaciones; la deuda global bajó a 1.308 clases fuera de escala.
- Producción desplegada como `dpl_Cp2rYxkfjrQ6YBe7SwwgCx4um4q1`. La página entrega CSP, HSTS, `SAMEORIGIN`, política de permisos restrictiva y el API respondió `401` sin sesión. La revisión visual autenticada no se forzó después de cerrar la sesión de QA anterior.

### Cierre humano requerido para `/portal/content-preview`

- Desde una página controlada, pulsar “Vista previa” y confirmar que la pestaña abre sin aviso de ventana bloqueada.
- Con bloques de prueba, revisar portada, texto, galería, video, tarjetas y llamados a la acción a 390 px y escritorio. Confirmar un solo `h1`, cero desbordamiento y ausencia de errores de consola.
- Pulsar cada enlace de prueba y confirmar que muestra el destino sin abandonar la vista previa ni ejecutar la acción externa.
- Probar una imagen retirada o URL inválida y confirmar el estado “Imagen no disponible” sin pantalla en blanco.
- Repetir con `admin`, `superadmin` y una cuenta sin administración; la última debe regresar al Portal y el API debe rechazarla.

## Registro de la fase 4 — `/portal/integrations`

### Evidencia implementada

- La ruta dejó de anidar un segundo `main`, mantiene un único `h1` visible incluso cuando el acceso es rechazado y explica que el diagnóstico pertenece a una configuración privada.
- Navegación, cliente y API aplican mínimo privilegio: el enlace solo aparece a `superadmin`, la pantalla exige una cuenta individual y el servidor vuelve a rechazar roles distintos o sesiones compartidas por contraseña.
- El diagnóstico nunca entrega credenciales, secretos ni tokens. La respuesta de verificación también dejó de exponer identificadores internos de sitio o biblioteca; el cliente recibe únicamente nombre del sitio, enlace público seguro y nombres de bibliotecas.
- Los errores técnicos de Microsoft permanecen en el registro privado con una referencia de soporte. La interfaz recibe un mensaje genérico accionable y la respuesta usa caché privada desactivada.
- Sitio y bibliotecas se consultan en paralelo. La interfaz impide acciones simultáneas, vence la solicitud a los quince segundos y descarta respuestas tardías para que una comprobación antigua no reemplace la más reciente.
- “Actualizar” y “Probar conexión de lectura” preservan sus íconos, anuncian progreso, éxito o error y devuelven el foco al terminar. La hora de actualización se presenta en Bogotá y la configuración incompleta solo muestra el número de variables protegidas faltantes, nunca sus valores.
- La pantalla declara de forma visible que la comprobación es de solo lectura y no crea, modifica ni elimina archivos. El enlace a SharePoint solo se habilita para una URL `https` y abre aislado en otra pestaña.
- `integrations.astro` y `portal-integrations.js` llegaron a cero deuda de espaciado y quedaron como archivos estrictos. El contrato automático de calidad interna suma diecinueve verificaciones; la deuda global bajó a 1.290 clases fuera de escala.
- Producción desplegada como `dpl_3thjezSDjGyTUZ1jbZMQy7MC7fmi`. A 390 × 844 y 1280 × 720 hubo un solo `h1`, cero objetivos menores de 44 px, cero controles sin nombre y ningún desbordamiento horizontal. La sesión no individual utilizada en QA quedó bloqueada y no mostró el enlace lateral; el API respondió “No autorizado” sin sesión.
- La ruta productiva entrega CSP, HSTS, `SAMEORIGIN`, política de referencia estricta, política de permisos restrictiva y protección contra interpretación de contenido.

### Cierre humano requerido para `/portal/integrations`

- Entrar con una cuenta Supabase individual cuyo rol efectivo sea `superadmin`; confirmar que aparecen los cuatro estados y la hora de Bogotá.
- Pulsar “Actualizar” y “Probar conexión de lectura”. Confirmar el mensaje de éxito, que el foco vuelve al botón y que ningún archivo cambia en SharePoint.
- Comparar el nombre del sitio y las bibliotecas visibles contra Portal Maná en SharePoint. Confirmar que la biblioteca de Eventos y la bandera de carga reflejan la configuración aprobada.
- Repetir el acceso con `admin`, una cuenta sin administración y una sesión por contraseña; ninguna debe ver el diagnóstico ni recibir datos del API.
- Revisar en Microsoft Entra que la aplicación conserva permisos mínimos sobre el sitio autorizado y registrar la fecha de rotación del secreto sin copiarlo al Portal, Git ni conversaciones.

## Registro de la fase 4 — `/admin/cumbre/manual`

### Evidencia implementada

- La herramienta dejó de aceptar `CUMBRE_MANUAL_SECRET` en URL o formularios. La interfaz exige una sesión Supabase individual con rol efectivo `superadmin`; la sesión compartida por contraseña y los demás roles se bloquean en cliente y servidor. El secreto se conserva únicamente como compatibilidad para clientes técnicos que lo envían en `x-admin-secret`.
- La página usa un solo `h1`, no anida otro `main`, oculta navegación pública, aplica `noindex`, `noarchive` y caché privada desactivada. La operación queda escondida hasta que termina la validación individual y muestra qué cuenta está actuando.
- Todos los campos visibles tienen etiqueta, los controles táctiles mantienen 44 px, los estados anuncian progreso y errores, y los formularios preservan lo escrito ante fallos o salida accidental. Tras un éxito, el botón permanece bloqueado hasta elegir explícitamente “Limpiar para otra…”.
- Participantes se construyen con nodos y `textContent`, sin interpolar nombres en HTML. Se exige nombre, edad entera entre 0 y 120, máximo veinte personas y confirmación explícita antes de guardar.
- COP acepta enteros con formato colombiano, por ejemplo `300000` o `300.000`; USD admite hasta dos decimales. El servidor deriva la moneda del expediente para abonos, impide montos negativos, formatos ambiguos, sobrepagos y abonos sobre reservas totalmente pagadas.
- Los planes de depósito y cuotas se cierran al vencer `CUMBRE_INSTALLMENT_DEADLINE` tanto en interfaz como en servidor. Esto evita crear cronogramas ya vencidos mientras se decide si Cumbre sigue activa, entra en cierre o se archiva.
- Reserva y abono usan llaves estables de idempotencia. El abono registra `provider_tx_id`, falla cerrado ante errores y distingue `pending`, `complete` y `error` de la conciliación secundaria. Si el pago ya quedó escrito pero falla plan, total o donación, responde “registrado, no reenviar” en vez de invitar a duplicarlo.
- `docs/sql/cumbre_manual_payment_idempotency.sql` añade restricciones únicas de transacción y referencia. Se detiene sin modificar datos si detecta duplicados históricos; hasta ejecutarlo, la interfaz y el servidor cubren reintentos secuenciales, pero la garantía completa frente a concurrencia depende de esas restricciones.
- El pago, el plan y la donación aún viven en tablas separadas. El estado explícito evita reenvíos y deja el caso conciliable, pero una futura función transaccional en base de datos sigue siendo la mejora recomendada para atomicidad completa.
- `manual.astro` y `cumbre-manual-auth.js` llegaron a cero deuda de espaciado y quedaron estrictos. El contrato automático suma veinte verificaciones; la deuda global bajó a 1.231 clases fuera de escala, 10 arbitrarias y 1.171 declaraciones CSS heredadas.
- Producción final `dpl_7nz8gh5DFipzFsHYN4WqrUxBXaC5` quedó `READY` y asociada a `ministeriomana.org`. La lectura directa devolvió `200`, título y compuerta esperados, CSP, HSTS, `no-store`, `noarchive`, ninguna llave o campo legado; ambos API rechazaron sin sesión antes de consultar o escribir datos.

### Cierre humano requerido para `/admin/cumbre/manual`

- Ejecutar `docs/sql/cumbre_manual_payment_idempotency.sql`. Si se detiene por duplicados, no borrar ni corregir pagos sin una conciliación caso por caso.
- Definir si Cumbre Mundial 2026 continúa activa, entra en cierre contable o se archiva antes de autorizar nuevas reservas, cronogramas o mensajes.
- Entrar sin parámetros en la URL con una cuenta individual `superadmin` y revisar la pantalla a 390 px y escritorio. Repetir con sesión compartida, `admin` y usuario común; todos deben quedar bloqueados.
- Si Cumbre sigue operativa, realizar una única escritura controlada con reserva, soporte y monto reales previamente autorizados. Verificar una sola fila de pago, una sola donación vinculada, totales y conciliación completa; no repetir una operación marcada para revisión.
- Confirmar que cualquier integración técnica que aún use esta ruta envía el secreto solo por encabezado. Retirar enlaces, favoritos, documentación o registros históricos que lo hayan incluido en la URL.

## Pasada autenticada de solo lectura — 14 de julio de 2026

- Se recorrieron en producción `/portal`, `/portal/events`, `/portal/finances`, `/portal/donations`, `/portal/peticiones`, `/portal/content`, `/portal/church-page`, `/portal/campus`, `/portal/users` y `/portal/regions` con una sesión autorizada, sin abrir ni enviar operaciones de escritura.
- Las diez rutas mantuvieron un solo `h1`, cero desbordamiento horizontal, cero campos visibles sin etiqueta y cero objetivos táctiles menores de 44 px en la vista de escritorio revisada.
- Los dos supuestos errores de imagen de Eventos pertenecían a vistas previas ocultas todavía sin `src`; no son imágenes visibles rotas. La auditoría repetible ahora descarta elementos ocultos al contar fallos de carga.
- Contenido dejó de mostrar carga visible después del tiempo de estabilización. La página de iglesia conserva su compuerta de activación hasta que se ejecute `church_public_pages.sql` y exista una sede controlada; no se forzó una publicación.
- La matriz productiva previa ya cubre 390 px y 1280 px para los módulos internos principales. Siguen pendientes las variaciones reales por rol y las mutaciones controladas descritas en cada cierre humano.

## Regla de actualización

Cada fase debe dejar: archivos estrictos cuando lleguen a cero, pruebas ejecutadas, hallazgos pendientes con responsable y una revisión en producción. Las decisiones humanas se copian a `PENDIENTES_USUARIO_2026-07-13.md`; las brechas técnicas permanecen en MANA-025 hasta cerrarse.
