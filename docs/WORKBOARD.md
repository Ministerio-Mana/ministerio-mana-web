# Workboard - Ministerio Mana Web

**Source of Truth del estado del proyecto**

## Reglas (anti-confusión)
1) No empieces nada si no tiene ID (MANA-00X)
2) Todo trabajo debe tener: Owner + Branch + Scope
3) Si cambias el scope, lo escribes aquí antes de tocar archivos

---

## Backlog


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
- MANA-007 Verificar build en producción
  - Owner: DELTA
  - Scope: CI/CD, Vercel deployment
  - Description: Confirmar que Lenis/GSAP funcionan en prod

---

## In Progress
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
