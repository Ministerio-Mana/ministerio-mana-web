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
| 1 | `BaseLayout`, modal global y navegación lateral | Teclado, foco, consistencia y permisos visibles | Cumple en código y prueba local; verificación de permisos en producción pendiente |
| 1 | `/portal/ingresar` | Autenticación, recuperación y privacidad | Cumple en código y prueba local; acceso real pendiente |
| 1 | `/portal/registro` | Datos personales, contraseña y validación | Cumple en código y prueba local; registro real pendiente |
| 1 | `/portal/activar` | Credencial nueva y enlace temporal | Cumple en código y prueba local; enlace real pendiente |
| 2 | `/portal` | Resumen, perfil, aportes y eventos del usuario | Pendiente |
| 2 | `/portal/events` | Creación, imágenes, formularios, monedas y alcance | Auditoría funcional avanzada; cierre de los 45 pendiente |
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

### Cierre requerido para cada ruta de la fase 1

- Verificación de producción a 390 px y escritorio después del despliegue.
- Confirmación con cuenta real de que errores y carga preservan los datos escritos.
- Prueba real de ingreso, recuperación, registro y activación únicamente con cuentas autorizadas.

## Regla de actualización

Cada fase debe dejar: archivos estrictos cuando lleguen a cero, pruebas ejecutadas, hallazgos pendientes con responsable y una revisión en producción. Las decisiones humanas se copian a `PENDIENTES_USUARIO_2026-07-13.md`; las brechas técnicas permanecen en MANA-025 hasta cerrarse.
