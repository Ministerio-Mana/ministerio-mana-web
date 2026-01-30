# Log diario - Ministerio Mana Web

**Registro histórico corto. Para estado actual ver: `WORKBOARD.md`**

---

## 2026-01-25
**Hoy**
- NOVA: Implementó mejoras masivas en UI Cumbre (MANA-009):
  - Fix stepper overlap (pb-10 + relative)
  - Pricing logic por país (COP/USD)
  - Modo "Voy solo" vs "Grupo"
  - Opciones de pago (50%, Cuotas)
  - Detección de edad para tipos de asistente
- NOVA: Implementó nueva Identidad Visual "Ven y Ayúdanos" (feat/cumbre-ui):
  - Nuevo componente `NetOverlay` (red animada)
  - Paleta de colores: Golden, Deep Void, Ocean Teal
  - Hero Parallax con capas y branding final
- NOVA: Pusheado a la rama `feat/cumbre-ui`
- DELTA: Estructura inicial de WORKBOARD y LOG
- DELTA: Backend Cumbre Mundial 2026 (booking/pagos/webhooks base)
- DELTA: Cuenta de usuario + cron cuotas/export + guia operativa (MANA-008)
- DELTA: Checklist QA end-to-end Cumbre 2026
- DELTA: Contabilidad (donaciones + exportes) + formulario manual Cumbre + admin export

**Decisiones**
- Sistema de tickets MANA-XXX implementado
- WORKBOARD = source of truth del estado
- LOG = registro histórico diario (corto)

**Riesgos**
- N/A

**Próximo**
- Usuario debe ejecutar `npm install` para Lenis/GSAP
- Probar animaciones en dev server
- Si funciona, mover MANA-001 a Done
- Ejecutar SQL de Cumbre en Supabase y probar endpoints

---

## 2026-01-24
**Hoy**
- NOVA: Implementó parallax (Lenis + GSAP) en componentes existentes (MANA-001)
- NOVA: Revirtió Cosmic Design por eliminar contenido original (MANA-003)
- DELTA: Creó docs de equipo y bitácora (MANA-002)

**Decisiones**
- ✅ Smooth scroll: Lenis
- ✅ Animaciones: GSAP ScrollTrigger
- ❌ Cosmic Design: Rechazado
- ✅ Paleta: Mantener beige/navy

**Riesgos**
- Mobile: animaciones pueden ser pesadas

**Próximo**
- Instalar deps y probar
- Optimizar mobile si necesario

---

## 2026-01-23
**Hoy**
- DELTA: Rediseño Home Storytelling
- DELTA: Fix tailwind.config PostCSS error

**Próximo**
- Validar build en CI

---

## 2026-01-22
**Hoy**
- DELTA: Iteraciones hero/header/nav
- DELTA: Historia con timeline + globo

**Próximo**
- Ajustar estilo final

---

_Para historial completo desde 2025-11-02, ver `bitacora.md`_
