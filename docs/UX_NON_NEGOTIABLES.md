# Carta de calidad no negociable

Fecha base: 13 de julio de 2026.

Esta carta define el mínimo aceptable para páginas públicas, Portal, operaciones, pagos y herramientas internas de Ministerio Maná. Una excepción debe quedar documentada con motivo, responsable y fecha de revisión; no se aceptan excepciones silenciosas.

## Aclaraciones de medición — controles Q40-Q45

- **Q40 — Objetivo táctil:** el objetivo interno para controles táctiles es **44 × 44 CSS px**. WCAG 2.2 nivel AA exige un mínimo de 24 × 24 px con excepciones; 44 × 44 px corresponde al criterio mejorado AAA. Ministerio Maná conserva 44 px como estándar propio para facilitar el uso a personas mayores.
- **Q41 — Umbral de respuesta:** la percepción de respuesta debe comenzar en menos de 100 ms cuando la acción pueda resolverse localmente. Las operaciones que dependen del servidor deben buscar respuesta visible en menos de 400 ms en el percentil 75 o mostrar progreso útil, conservar el trabajo y permitir recuperación.
- **Q42 — Optimismo seguro:** la interfaz optimista se usa solo cuando la acción es reversible y de bajo riesgo. Pagos, permisos, aprobaciones financieras, eliminaciones definitivas y mensajes masivos requieren confirmación real del servidor.
- **Q43 — Deshacer seguro:** `Deshacer` reemplaza confirmaciones únicamente en acciones reversibles. Lo irreversible o sensible requiere contexto, confirmación explícita y auditoría.
- **Q44 — Alcance de atajos:** la paleta de comandos y los atajos son obligatorios en herramientas internas de uso frecuente cuando reduzcan trabajo repetitivo. No se agregan a páginas públicas sin una necesidad comprobada.
- **Q45 — Trabajo sin conexión:** el funcionamiento local u offline se prioriza donde perder conectividad pueda hacer perder trabajo. No se replica información sensible en el dispositivo sin cifrado, expiración y una razón operativa.

## Fundamentos

1. **Espacio y rejilla:** una escala base de 8 —preferentemente 8, 16, 24 y 32; siempre múltiplos de 8— con tokens desde el inicio. Un valor excepcional necesita nombre y justificación. El contrato ejecutable está en [`docs/SPACING_CONTRACT.md`](./SPACING_CONTRACT.md).
2. **Tipografía:** entre cuatro y seis tamaños funcionales, interlineado legible, líneas de 45 a 75 caracteres y ningún párrafo completo en mayúsculas.
3. **Color:** paleta limitada, un acento dominante, colores semánticos y contraste WCAG 2.2 AA. El color nunca comunica estado por sí solo.
4. **Jerarquía:** el contenido esencial aparece primero y cada pantalla tiene una acción primaria inequívoca.
5. **Consistencia:** el mismo componente conserva comportamiento y apariencia. Se reutilizan componentes; no se copian variantes de markup sin contrato.
6. **Controles:** jerarquía primaria/secundaria, objetivo táctil interno de 44 px y estados de hover, foco, carga, deshabilitado y error.
7. **Estados y feedback:** todo flujo cubre carga, vacío, error, éxito y reintento. Toda acción informa qué ocurrió.
8. **Densidad:** suficiente aire, detalle bajo demanda y ausencia de bloques amontonados.
9. **Accesibilidad:** teclado, foco visible y no oculto, labels, nombres accesibles, ARIA cuando corresponde, reflow, zoom y contraste.
10. **Responsive:** funciona en cualquier ancho soportado, sin scroll horizontal accidental; las tablas se adaptan o se presentan como tarjetas en móvil.
11. **Formularios:** labels persistentes, formatos indulgentes, validación junto al campo y conservación total de lo escrito ante cualquier error.
12. **Navegación:** estructura clara, ubicación visible y máximo tres niveles salvo justificación operativa.
13. **Rendimiento percibido:** contenido útil rápido, esqueletos solo cuando ayudan y ninguna pantalla en blanco durante una espera.

## Herramientas modernas

14. **Rendimiento como UX:** consultas independientes en paralelo, presupuestos medidos y eliminación de esperas en cascada.
15. **Sistema de diseño:** tokens y componentes compartidos antes que estilos aislados. Las excepciones quedan centralizadas.
16. **Paleta de comandos y atajos:** disponible en herramientas internas frecuentes, accesible por teclado y con ayuda visible.
17. **UI optimista segura:** solo para acciones reversibles; siempre reconcilia con servidor y revierte de forma comprensible si falla.
18. **Deshacer antes que confirmar:** para acciones reversibles; lo financiero, permisos y borrado definitivo nunca depende únicamente de `Deshacer`.
19. **Leyes de UX:** Fitts, Hick, Jakob y Aesthetic-Usability orientan decisiones, sin reemplazar pruebas con usuarios reales.
20. **Movimiento con propósito:** transiciones que explican cambio, sin bloquear; respeto obligatorio a `prefers-reduced-motion`.

## Frontera de producto

21. **La velocidad es parte del producto:** feedback local inmediato, cero spinners sin contexto y continuidad cuando la red es inestable.
22. **Funciones asistidas y supervisión humana:** cualquier sugerencia automatizada debe ser editable, identificable, explicable y confirmada por una persona antes de producir efectos sensibles.
23. **Interfaces calmadas:** menos ruido, alertas agrupadas y foco en la siguiente acción útil.
24. **Accesibilidad como política interna:** objetivo WCAG 2.2 AA para todos los módulos y estándar táctil interno de 44 px.
25. **Personalización:** vistas guardadas, densidad y tema cuando aporten valor real al trabajo frecuente, sin fragmentar la experiencia.
26. **Seguridad percibida y real:** sesión y usuario visibles, 2FA en roles sensibles, datos enmascarados, mínimo privilegio y confirmación contextual para pagos, permisos y borrados.
27. **Privacidad:** minimización, finalidad explícita, consentimiento previo e informado cuando aplique, acceso/corrección/supresión y exportación como capacidad del producto. La supresión respeta las obligaciones legales de conservación.
28. **Resiliencia:** nunca perder trabajo; borradores recuperables, operaciones idempotentes, degradación clara, reintentos seguros y ausencia de pantallas en blanco.
29. **Internacionalización:** monedas, fechas, números y zonas horarias localizadas; textos externalizados y layouts resistentes a textos largos y formatos flexibles.
30. **Datos complejos:** ordenar, filtrar, buscar, paginar o virtualizar; acciones en lote seguras; números alineados, totales claros, exportes operativos y carga independiente por sección.
31. **Prevención de errores:** restringir estados inválidos, usar defaults sensatos, aceptar formatos humanos y explicar con precisión cualquier acción irreversible.

## No negociables adicionales

32. **Autorización y aislamiento:** permisos validados en servidor y base de datos, denegación por defecto y separación estricta por iglesia, región, país y función. Ocultar un botón no constituye seguridad.
33. **Observabilidad y auditoría:** acciones sensibles con actor, fecha, alcance y resultado; logs estructurados sin secretos ni datos innecesarios; alertas accionables y trazabilidad entre interfaz, API y proveedor.
34. **Integridad financiera y temporal:** dinero con precisión segura, monedas nunca mezcladas, conciliación reproducible, referencias únicas, UTC para almacenamiento y zona IANA para presentación.
35. **Recuperación y continuidad:** copias de seguridad, restauración probada, objetivos RPO/RTO definidos y un procedimiento de incidentes comprensible por el equipo.
36. **Entrega segura:** pruebas antes de publicar, migraciones compatibles, despliegue gradual cuando el riesgo lo exija, rollback documentado y feature flags para cambios sensibles.
37. **Cadena de suministro y secretos:** dependencias revisadas, firmas de webhooks, CSP, análisis de vulnerabilidades, rotación de secretos y ninguna credencial en Git, URL, captura, log o analítica.
38. **Ciclo de vida de datos y contenido:** propietario, finalidad, fuente, vigencia, retención y eliminación definidos; contenido obsoleto identificado y datos de respaldo incluidos en la política.
39. **Operabilidad y soporte:** errores con código o referencia útil, herramientas de diagnóstico para el equipo autorizado y procedimientos para resolver cobros, permisos, sincronización y datos incompletos sin editar la base a ciegas.

## Estado preliminar del proyecto

Esta es una orientación inicial, no reemplaza la auditoría formal MANA-025.

| Área | Estado | Situación actual |
| --- | --- | --- |
| Pagos, monedas e idempotencia | Sólido con QA pendiente | Contratos Wompi/COP y Stripe/USD, conciliación y deduplicación implementados; faltan pruebas controladas con proveedores. |
| Roles y alcance financiero | Sólido con QA pendiente | Separación local, regional, nacional y global implementada; faltan cuentas reales de prueba por alcance. |
| Responsive y controles táctiles | Avanzado | Páginas principales sin desborde en la revisión móvil y controles principales ampliados; falta matriz completa de dispositivos. |
| Accesibilidad | Parcial | Foco, reducción de movimiento y mejoras semánticas presentes; falta auditoría WCAG 2.2 AA automatizada y manual de todo el sitio. |
| Tokens, rejilla y tipografía | Parcial | Existe identidad compartida, pero quedan valores arbitrarios, escalas y estilos históricos que deben consolidarse gradualmente. |
| Estados, formularios y recuperación | Parcial | Los flujos críticos manejan errores y borradores en varias áreas; no existe todavía un contrato universal de autosave/recuperación. |
| Rendimiento medido | Sin línea base | El build está optimizado, pero no hay presupuesto p75 por interacción ni tablero continuo de métricas de producto. |
| Datos complejos | Parcial | Finanzas tiene filtros, paginación y CSV; falta normalizar tablas, acciones en lote y carga independiente en todos los paneles. |
| Internacionalización | Parcial | Hay locale, COP/USD y zonas IANA; todavía existen textos no externalizados y formatos inconsistentes heredados. |
| Privacidad y derechos del titular | Parcial | Hay minimización y almacenamiento privado en flujos críticos; falta centro o procedimiento visible de acceso, exportación, corrección y supresión. |
| Paleta de comandos y personalización | Pendiente | No existe contrato transversal de comandos, vistas guardadas, densidad o temas para el Portal. |
| Recuperación operativa | Pendiente de evidencia | Faltan objetivos RPO/RTO y constancia periódica de restauración probada. |

## Referencias normativas base

- [WCAG 2.2 — W3C](https://www.w3.org/TR/WCAG22/)
- [European Accessibility Act — Comisión Europea](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en)
- [Ley Estatutaria 1581 de 2012 — SIC](https://sedeelectronica.sic.gov.co/transparencia/normativa/ley-estatutaria-1581-de-2012)

La aplicabilidad exacta de una ley depende del país, servicio y público objetivo. Esta carta adopta WCAG 2.2 AA como política interna aunque una obligación jurídica concreta deba confirmarse con asesoría legal.
