# Workboard - Ministerio Mana Web

**Source of Truth del estado del proyecto**

## Reglas (anti-confusión)
1) No empieces nada si no tiene ID (MANA-00X)
2) Todo trabajo debe tener: Owner + Branch + Scope
3) Si cambias el scope, lo escribes aquí antes de tocar archivos

---

## Backlog

- MANA-015 Cobro dual para eventos globales
  - Owner: Equipo web
  - Branch: `main`
  - Scope: pagos de Eventos, precios COP/USD y operación consolidada
  - Description: Permitir Wompi COP para Colombia y Stripe USD para otros países dentro del mismo evento global, sin mezclar monedas.

- MANA-004 Agregar más data attributes para animaciones
  - Owner: TBD
  - Scope: `src/components/home/**`
  - Description: Agregar `data-fade`, `data-stagger`, `data-scale` a componentes restantes

- MANA-005 Optimizar animaciones para mobile
  - Owner: TBD
  - Scope: `src/scripts/home-animations.ts`
  - Description: Simplificar pinning y parallax en viewports <768px

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

- MANA-007 Verificar build en producción
  - Owner: DELTA
  - Scope: CI/CD, Vercel deployment
  - Description: Confirmar que Lenis/GSAP funcionan en prod

---

## In Progress
- MANA-013 Finanzas por alcance
  - Owner: Equipo web
  - Branch: `main`
  - Scope: RBAC financiero local, regional, nacional y global; reportes y conciliación
  - Description: Separar visibilidad y operación financiera por iglesia, región y país. Wompi pertenece siempre al recaudo nacional; Stripe cubre recaudos internacionales/globales y campañas habilitadas.
  - Status: Contrato SQL, clasificación automática, filtros de API y matriz de permisos listos. Requiere ejecutar `docs/sql/finance_scopes_hierarchy.sql` y asignar el primer equipo financiero por correo.

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
  - Owner: DELTA
  - Branch: `feat/cumbre-ui`
  - Scope: `src/pages/api/cumbre2026/**`, `src/pages/api/cuenta/**`, `src/lib/cumbre*`, `src/lib/supabase*`
  - Description: Booking, pagos, webhooks, planes de cuotas, cuenta usuario, export CSV y contabilidad
  - Status: En curso (pendiente notificaciones, exportes contabilidad y verificacion end-to-end)


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
- ⏳ **Mobile optimization**: Pendiente (MANA-005)
- ⏳ **Production testing**: Pendiente (MANA-007)
