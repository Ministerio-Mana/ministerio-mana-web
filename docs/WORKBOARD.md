# Workboard - Ministerio Mana Web

**Source of Truth del estado del proyecto**

## Reglas (anti-confusión)
1) No empieces nada si no tiene ID (MANA-00X)
2) Todo trabajo debe tener: Owner + Branch + Scope
3) Si cambias el scope, lo escribes aquí antes de tocar archivos

---

## Backlog

- MANA-006 Copy final para capítulos del home
  - Owner: ATLAS
  - Scope: Contenido de `src/components/home/**`
  - Description: Refinar textos con tono espiritual/moderno

---

## Ready

- MANA-011 Revisión en vivo del constructor de formularios de Eventos
  - Owner: Usuario
  - Scope: `/portal/events` y página pública del evento
  - Description: Crear una pregunta adicional, publicar el evento y enviar una inscripción de prueba desde celular.
  - Notes: Pendiente para cuando el usuario tenga acceso; no bloquea el avance técnico.

- MANA-012 Revisión de Excel en línea para Eventos
  - Owner: Usuario
  - Scope: `/portal/events/:id` → Operación del evento
  - Description: Usar “Actualizar Excel en OneDrive”, abrir `Inscripciones.xlsx` desde Documentos internos y comprobar que las respuestas del formulario aparecen en columnas.
  - Notes: “Descargar una copia” queda disponible solo para trabajo fuera de línea. Requiere haber ejecutado `docs/sql/event_documents_sharepoint.sql` y tener habilitada la escritura de Eventos en Microsoft 365.

---

## In Progress
- MANA-025 Carta de calidad y auditoría UX transversal
  - Owner: Equipo web
  - Branch: `main`
  - Scope: sistema visual, accesibilidad, rendimiento, formularios, navegación, datos, privacidad, resiliencia y seguridad percibida
  - Description: Convertir los no negociables del producto en criterios medibles, pruebas de aceptación y una auditoría gradual sin romper flujos operativos existentes.
  - Status: Carta base consolidada y matriz interna de 45 controles activa. Gestión/Operación de Eventos, Finanzas, Donaciones, Campus, Peticiones, invitación pública y fase 1 interna llegaron a cero infracciones en sus archivos estrictos. Ingreso, registro, activación, navegación y modal global tienen contratos de teclado, foco, 44 px y responsive. En `/portal` ya se corrigieron jerarquía, estados, etiquetas, diálogos y controles dinámicos; producción pasó a 390 y 1280 px sin desbordamiento, objetivos pequeños ni controles sin nombre. El registro manual y el selector de iglesia preservan datos y foco por contrato; su prueba interactiva espera un evento operativo abierto. `/portal/events` pasó en producción a 390 y 1280 px: lista, formulario largo y calendario sin objetivos pequeños, nombres faltantes ni desbordamiento; además preserva datos y restaura foco. En `/portal/events/[id]` la base productiva pasa responsive y el contrato cubre 44 px, foco y protección de notas para documentos, comprobantes, revisión y asistencia; falta repetir con una inscripción autorizada. `/portal/users` pasó en producción a 390 y 1280 px sin controles pequeños, nombres faltantes ni desbordamiento; creación protege datos y foco, y la regla compartida de tablas respeta 44 px. `/portal/regions` pasó producción en ambos anchos con tablas convertidas a tarjetas móviles, formularios etiquetados, edición segura y cero errores de consola; sus archivos quedaron estrictos. `/portal/finances` pasó producción en ambos anchos con 44 px, jerarquía correcta, USD con centavos, separación COP/USD y filtros que conservan el foco; respuestas tardías ya no reemplazan vistas recientes. `/portal/donations` pasó producción en ambos anchos con proveedor/moneda visibles, acumulados aprobados separados, filtros resistentes a respuestas tardías y conciliación Wompi contextual que preserva datos y foco; la prueba no ejecutó una conciliación real. `/portal/campus` pasó producción en ambos anchos con vista personal de misionero, permiso financiero adicional, alcance financiero aplicado en servidor, proveedor/moneda visibles, conteo canónico y controles de 44 px; falta probar cuentas reales por alcance y no se abrieron comunicaciones. `/portal/peticiones` separa lectura de intercesión y moderación administrativa, minimiza campos privados, pagina con totales honestos y protege decisiones concurrentes; producción pasó a 390 px sin objetivos pequeños, etiquetas faltantes ni desbordamiento. Faltan exportes autorizados, mutaciones reales y variación por roles. Quedan creación real y diseño de deshacer para archivar/check-in. Continúan la migración de espaciado y la prueba por roles. La deuda global bajó de 1.906 a 1.424 clases fuera de escala y de 1.212 a 1.171 declaraciones CSS.

- MANA-021 Revisión visual y móvil de páginas públicas
  - Owner: Equipo web
  - Branch: `main`
  - Scope: Eventos públicos, Donaciones, Iglesias, Campus, Portal y estilos compartidos
  - Description: Corregir inconsistencias verificables de jerarquía, responsive, accesibilidad, navegación y footer sin reemplazar la identidad visual vigente.
  - Status: Correcciones compartidas listas: encabezado sin desborde a 320 px, objetivos táctiles de 44 px y jerarquía semántica de Donaciones. Pendiente revisión visual final en producción.

- MANA-022 Confiabilidad de pagos y tareas programadas
  - Owner: Equipo web
  - Branch: `main`
  - Scope: Webhooks Wompi/Stripe, idempotencia, conciliación, crons y pruebas automatizadas
  - Description: Confirmar mediante contratos repetibles que los reintentos no duplican movimientos ni inscripciones y que las tareas programadas fallan de forma segura.
  - Status: Autenticación de crons centralizada y sin tokens en URL de producción; reclamación atómica de suscripciones Wompi y deduplicación de fallos/avisos de webhooks implementadas. Contratos automáticos listos; pendiente QA controlado de proveedores y logs.

- MANA-023 Contratos financieros de Campus y Donaciones
  - Owner: Equipo web
  - Branch: `main`
  - Scope: Donaciones, Campus, misioneros, suscripciones, proveedores y visibilidad financiera
  - Description: Auditar y probar la asignación del destino, la separación Wompi/Stripe y el comportamiento de cobros recurrentes sin realizar transacciones reales.
  - Status: Contrato COP/Wompi y USD/Stripe extraído y probado, incluyendo asignación individual por misionero. Pendiente una transacción de prueba autorizada por proveedor.

- MANA-024 Auditoría operativa de Cumbre Mundial 2026
  - Owner: Equipo web
  - Branch: `main`
  - Scope: Backend, exportes, notificaciones, auditoría y Centro de Soluciones de Cumbre
  - Description: Identificar y corregir brechas técnicas seguras; cualquier corrección histórica o cierre contable requiere confirmación humana.
  - Status: Exportes, Centro de Soluciones, notificaciones y corrección con vista previa auditados. Se reforzaron secretos de exportación y webhooks idempotentes. Los crons de cobro/recordatorio siguen desactivados hasta definir si Cumbre está activa, en cierre o archivada.

- MANA-015 Cobro dual para eventos globales
  - Owner: Equipo web
  - Branch: `main`
  - Scope: pagos de Eventos, precios COP/USD y operación consolidada
  - Description: Permitir Wompi COP para Colombia y Stripe USD para otros países dentro del mismo evento global, sin mezclar monedas.
  - Status: Interfaz, API, RPC, página pública, checkout, consolidación operativa/Excel y SQL activos. Stripe queda limitado a USD y Wompi a COP. Pendiente revisión del usuario en un evento global de prueba.

- MANA-013 Finanzas por alcance
  - Owner: Equipo web
  - Branch: `main`
  - Scope: RBAC financiero local, regional, nacional y global; reportes y conciliación
  - Description: Separar visibilidad y operación financiera por iglesia, región y país. Wompi pertenece siempre al recaudo nacional; Stripe cubre recaudos internacionales/globales y campañas habilitadas.
  - Status: Contrato SQL, clasificación automática, matriz de permisos, administración visual de equipos y cuenta responsable en transacciones activos. En curso filtros por período/cuenta/moneda y exportes separados; después se asigna el primer equipo y se realiza QA con cuentas reales.

- MANA-014 Comprobantes privados para pagos manuales de Eventos
  - Owner: Equipo web
  - Branch: `main`
  - Scope: carga, revisión, auditoría y retención controlada de comprobantes en SharePoint
  - Description: El asistente adjunta un comprobante limitado; el pastor autorizado lo revisa desde la operación. La retención queda sin vencimiento automático hasta que Contabilidad apruebe la política aplicable.
  - Status: Carga privada, optimización, nombres por asistente, revisión y limpieza auditada listas. La tarea diaria solo elimina archivos con `retention_until` aprobado; `NULL` conserva el comprobante.

- MANA-010 Operación de inscripciones de Eventos
  - Owner: Equipo web
  - Branch: `main`
  - Scope: exportación Excel y futura sincronización segura con SharePoint
  - Description: Entregar registros con preguntas configurables sin alterar cobros, ImageKit, Campus ni los permisos actuales.
  - Status: En curso — Excel generado y respuestas visibles en la operación. “Actualizar Excel en OneDrive” reemplaza el mismo archivo en la biblioteca del evento; “Descargar una copia” es secundaria. La activación requiere `docs/sql/event_documents_sharepoint.sql`; una Lista de SharePoint autorizada sigue siendo el siguiente paso para una vista compartida en tiempo real.

- MANA-008 Backend Cumbre Mundial 2026
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `src/pages/api/cumbre2026/**`, `src/pages/api/cuenta/**`, `src/lib/cumbre*`, `src/lib/supabase*`
  - Description: Booking, pagos, webhooks, planes de cuotas, cuenta usuario, export CSV y contabilidad
  - Status: Backend, notificaciones controladas, exportes contables, auditoría de paquetes y corrección segura con `dryRun` disponibles. Pendiente verificación end-to-end y decisión operativa de cierre; seguimiento en MANA-024.


---

- MANA-009 UI Cumbre Mundial 2026 (landing + inscripcion + registro)
  - Owner: NOVA
  - Branch: `feat/cumbre-ui`
  - Scope: `src/pages/eventos/cumbre-mundial-2026/**`, `src/components/cumbre2026/**`
  - Status: ✅ Finalizado (Mejoras Visuales "Ven y Ayúdanos")
  - Notes: Identidad visual aplicada (Red, Colores Dorados/Navy, Hero Parallax). Landing, inscripción y registro completos.
  - Owner: NOVA
  - Branch: `ui/home-storytelling`
  - Scope: 
    - `src/scripts/lenis.ts` (nuevo)
    - `src/scripts/home-animations.ts` (nuevo)
    - `src/layouts/BaseLayout.astro`
    - `src/components/home/HeroChapter.astro`
    - `src/components/home/HistoryChapter.astro`
    - `package.json`
  - Status: ✅ Implementado, pusheado, **pendiente `npm install` y pruebas**
  - Commits: `57ee5ee` (revert), `f4799a7` (final)
  - Notes: Requiere instalación de Lenis y GSAP

---

## Done
- MANA-020 Visibilidad del Excel en línea de Eventos
  - Owner: Equipo web
  - Branch: `main`
  - Scope: Documentos internos de `/portal/events/:id`, API de documentos y pruebas
  - Completed: 2026-07-13
  - Notes: `Inscripciones.xlsx` queda identificado como Excel en línea, usa su fecha real de actualización y sube al inicio después de cada reemplazo. Los documentos genéricos conservan su presentación y privacidad.

- MANA-007 Verificar build en producción
  - Owner: Equipo web
  - Branch: `main`
  - Scope: CI/CD, portada y Vercel Production
  - Completed: 2026-07-13
  - Notes: Producción verificada a 390 × 844 y en escritorio. El flujo móvil quedó estático y navegable; el escritorio conserva paneles, transiciones y temas. No hubo errores de consola.

- MANA-005 Optimizar animaciones para mobile
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `src/scripts/cumbre-welcome-story.js`, `src/lib/storyMotion.ts`, `src/components/ven-ayudanos/VenAyudanosExperience.astro`
  - Completed: 2026-07-13
  - Notes: La portada activa usa flujo estático bajo 768 px, sin Lenis, pinning ni refrescos de ScrollTrigger. Los revelados móviles usan IntersectionObserver, tienen espera máxima de 225 ms y respetan reducción de movimiento.

- MANA-004 Completar atributos de animación de la portada activa
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `src/components/ven-ayudanos/VenAyudanosExperience.astro`
  - Completed: 2026-07-13
  - Notes: Los cinco paneles activos de `/` quedaron agrupados para revelado adaptable. No se modificaron los componentes históricos que ya no renderiza la portada.

- MANA-019 Reportes financieros filtrados y exportación por moneda
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `/portal/finances`, API financiera y CSV contable
  - Completed: 2026-07-13
  - Notes: Filtros por período, fechas, proveedor, nivel de cuenta y moneda respetan el alcance financiero. Los exportes exigen COP o USD y generan archivos independientes con límite seguro de registros; el histórico sin moneda explícita o con mayúsculas/minúsculas distintas usa Wompi=COP y Stripe=USD.

- MANA-016 Activar SQL de Eventos y Finanzas en Supabase
  - Owner: Usuario
  - Scope: Supabase SQL Editor
  - Completed: 2026-07-13
  - Notes: Activos documentos internos, comprobantes privados, jerarquía financiera y cobro dual. Verificación final: Wompi `NATIONAL/colombia`, Stripe `GLOBAL` y RPC seguros disponibles.

- MANA-018 Administración visual de equipos financieros por alcance
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `/portal/users`, API administrativa y asignaciones financieras secundarias
  - Completed: 2026-07-13
  - Notes: Superadmin puede agregar o retirar Finanzas global, nacional, regional o local sin reemplazar el rol pastoral. Requiere la migración MANA-016 para activarse.

- MANA-017 Inventario integral de activación y QA
  - Owner: Equipo web
  - Branch: `main`
  - Scope: `docs/PENDIENTES_USUARIO_2026-07-13.md`, integraciones y revisiones en vivo
  - Completed: 2026-07-13
  - Notes: El worklog original no existe en el árbol ni en el historial; el inventario se reconstruyó desde tablero, bitácora, SQL, rutas y configuración.

- MANA-002 Documentación de equipo y reglas
  - Owner: DELTA
  - Branch: `ui/home-storytelling`
  - Scope: `docs/contrato-equipo.md`, `docs/bitacora.md`
  - Completed: 2026-01-24
  - Notes: Define roles (Nova/Delta/Atlas) y reglas de trabajo

- MANA-003 Revert de Cosmic Design
  - Owner: NOVA
  - Branch: `ui/home-storytelling`
  - Scope: Múltiples archivos (revert completo de commit `c0e75ca`)
  - Completed: 2026-01-24
  - Notes: Se revirtió tema oscuro cósmico por eliminar contenido original

---

## Blocked
_Ningún ticket bloqueado actualmente_

---

## Decisiones Técnicas Activas
- ✅ **Smooth scroll**: Lenis (aprobado)
- ✅ **Animaciones**: GSAP ScrollTrigger (aprobado)
- ✅ **Paleta de colores**: Beige/Navy original (mantener, NO cosmic)
- ✅ **Mobile optimization**: Flujo estático y revelado ligero completados (MANA-005)
- ✅ **Production testing**: Portada verificada en móvil y escritorio (MANA-007)
