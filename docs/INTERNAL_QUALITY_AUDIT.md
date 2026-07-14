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
| 2 | `/portal/events/[id]` | Inscripciones, documentos y comprobantes | Auditoría funcional avanzada; cierre de los 45 pendiente |
| 2 | `/portal/users` | Roles y finanzas adicionales por alcance | Pendiente |
| 2 | `/portal/regions` | Jerarquía territorial y autorización | Pendiente |
| 3 | `/portal/finances` | Monedas, alcance, exportes y datos complejos | Auditoría funcional avanzada; cierre de los 45 pendiente |
| 3 | `/portal/donations` | Wompi/Stripe, campañas y conciliación | Pendiente |
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

## Regla de actualización

Cada fase debe dejar: archivos estrictos cuando lleguen a cero, pruebas ejecutadas, hallazgos pendientes con responsable y una revisión en producción. Las decisiones humanas se copian a `PENDIENTES_USUARIO_2026-07-13.md`; las brechas técnicas permanecen en MANA-025 hasta cerrarse.
