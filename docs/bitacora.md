# Bitacora de trabajo - Ministerio Mana Web

## Roles clave
- Antigravity: UI/UX Lead
- Codex: Backend/Security Lead
- Cloud/Claude: Copywriting

## Formato de entrada
- Fecha:
- Responsable:
- Cambios:
- Pruebas:
- Pendientes:

## Entradas

### 2026-01-28 (Portal logout fiable)
- Responsable: Codex
- Cambios:
  - Portal Maná: cierre de sesión ahora limpia siempre la sesión local de Supabase (scope local), incluso en modo contraseña.
  - Mantiene limpieza del cookie de fallback en `/api/portal/password-logout`.
- Pruebas: N/A
- Pendientes: Verificar en Preview que al cerrar sesión siempre redirija a `/portal/ingresar`.

### 2026-01-28 (Portal Admin y equipos por iglesia)
- Responsable: Codex
- Cambios:
  - Portal Maná: panel Admin/Superadmin para listar usuarios, asignar roles y resetear contraseñas.
  - Portal Iglesias: listado de colaboradores por iglesia + invitaciones para delegados/líderes.
  - API Admin: endpoints para listar usuarios, invitar cuentas y cambiar roles con permisos.
- Pruebas: N/A
- Pendientes:
  - Validar envío de correos Supabase (SMTP SendGrid) para invitaciones y reset.
  - Confirmar `PORTAL_SUPERADMIN_EMAILS` con los superadmins activos.

### 2026-01-28 (Portal fallback sin sesión Supabase)
- Responsable: Codex
- Cambios:
  - Portal Maná: modo contraseña ahora muestra el dashboard aunque no haya sesión Supabase.
  - En modo fallback, el resumen usa datos mínimos y no bloquea acceso a admin/iglesia.
- Pruebas: N/A

### 2026-01-28
- Responsable: Codex
- Cambios:
  - Portal Maná: agregado botón "Volver al inicio" en el dashboard.
  - Portal Iglesias: formulario manual + listado por iglesia (backend + frontend).
  - Registro Cumbre: se ajusta RegistroFlow para leer booking/participants del endpoint real.
  - Auth Portal: login por contraseña usa Supabase (mismo rol que magic link) y página de activación de cuenta.
  - Autosave en nube: drafts para registro post-pago y formulario manual de iglesias.
  - Delegación: invitación de colaboradores por iglesia (church_admin/admin) con creación de usuario.
- Pruebas: N/A
- Pendientes: Validar flujo de registro post‑pago con bookingId + token reales.

### 2026-01-28 (Portal activación + control post‑pago)
- Responsable: Codex
- Cambios:
  - Portal: se agrega rol visible en perfil y se ajusta etiqueta de “Iglesia” para admins.
  - Portal Login: se habilita scroll suave (sin bloquear overflow) y link de regreso a la Cumbre.
  - Activación: guard para evitar activar sin enlace (requiere sesión), y toggle de contraseña en confirmación.
  - Registro Cumbre: gating por activación (CTA de enlace) + autosave continúa activo.
  - Estado Cumbre: CTA de activación y botón “Completar datos” solo si hay sesión.
- Pruebas: N/A
- Pendientes:
  - Configurar `PUBLIC_SUPABASE_ANON_KEY` en Preview/Prod para habilitar auth en frontend.

### 2026-01-25/26 (Branding Corporativo & Sistema de Cuentas)
- Responsable: Antigravity
- Cambios:
  - **Branding Corporativo:**
    - Migración de tema "Cosmic/Espacial" a identidad corporativa Navy/Gold del Ministerio
    - Actualización completa de `/cuenta/ingresar` y `/cuenta/` (dashboard) con paleta institucional
    - Cambio de fondo oscuro a light mode (`bg-slate-50`) para mejor legibilidad
    - Sidebar del dashboard ahora usa Navy Blue (`#293C74`) como color principal
  - **Integración de Logos SVG:**
    - Recepción y procesamiento de logos oficiales del Ministerio y Cumbre 2026
    - Renombrado de archivos SVG para compatibilidad web (eliminación de espacios y acentos):
      - `Logo Ministerio Maná.svg` → `logo-ministerio-mana.svg`
      - `-Cumbre Maná 2026 ven y ayúdanos.svg` → `cumbre-2026-logo-white.svg`
      - Y otros archivos similares
    - Actualización de todas las referencias en código
    - Reemplazo de favicon y logo principal del sitio
  - **Sistema de Acceso a Cuenta:**
    - Creación de `AccountButton.astro` con detección automática de sesión Supabase
    - Integración en header principal (desktop y mobile)
    - Estados dinámicos:
      - Sin sesión: "Iniciar sesión" → `/cuenta/ingresar`
      - Con sesión: Nombre + iniciales + dropdown con "Mi Cuenta" y "Cerrar sesión"
    - Creación de `src/scripts/account-button.ts` para lógica bundleada (fix CSP)
- Pruebas:
  - Verificación de logos en producción (Vercel)
  - Debugging de errores CSP y module resolution
  - Fix de Internal Server Error por uso de `Astro.resolve()` deprecado
- Pendientes:
  - Verificar que el botón de cuenta funcione correctamente en producción
  - Considerar reducir items en header desktop para evitar overflow

### 2026-01-26 (Cuentas, cuotas y contabilidad)
- Responsable: Delta (Codex)
- Cambios:
  - Se agregaron cuentas de usuario con Supabase OTP: `/cuenta/ingresar` y `/cuenta/`.
  - Se implemento cron de cuotas y export CSV de cuotas para Cumbre.
  - Se agregaron planes de pago (cumbre_payment_plans) e installments (cumbre_installments) + SQL extra.
  - Se agrego ledger de donaciones (tabla donations) con campos contables completos.
  - Se actualizo checkout de donaciones (Wompi/Stripe) para capturar datos contables.
  - Se agregaron webhooks para actualizar estado de donaciones.
  - Se agrego generador de referencia de donaciones con prefijo configurable.
  - Se creo export contabilidad por proveedor (wompi/stripe/physical).
  - Se agrego export admin de Cumbre con participantes, pagos y estado.
  - Se agrego formulario manual de Cumbre para pagos fisicos y abonos.
  - Se agregaron secretos/env para exports y formularios manuales de Cumbre.
  - Se normalizo ciudad/iglesia para estandarizar registros.
  - Se agrego inbox de eventos Wompi reenviados para no perder webhooks.
  - Se actualizo `/api/wompi/events-forwarded` para guardar evento crudo y seguir el flujo Cumbre cuando aplica.
  - Se agrego SQL de `mm_wompi_event_inbox` en `docs/sql/wompi_event_inbox.sql`.
  - Se agrego Turnstile en la inscripcion de Cumbre y se envio token en booking.
  - Se ajusto validacion Turnstile en pagos Cumbre para evitar bloqueo sin token.
  - Se habilito modo Cumbre-only: home redirige por env var, header/footer ocultos en Cumbre.
  - CTA de Cumbre actualizado para inscripcion via WhatsApp.
  - Se conecto registro post-pago para guardar datos de asistentes en base de datos.
  - Se ajusto registro post-pago: tipo de menu (tradicional/vegetariano) en lugar de alergias.
  - CTA de Cumbre condicionado por env `PUBLIC_CUMBRE_WHATSAPP_ONLY` (WhatsApp en prod, inscripcion en preview).
  - Se evito error JS en Inscripcion al avanzar (null checks en totales).
  - Se actualizo subtotal en paso 1 al cambiar nombre/reserva del responsable.
  - Se desactivo validacion Turnstile en preview para pruebas de Cumbre (solo se valida en production).
  - Fix build: ruta de `AccountButton` resuelta con `Astro.resolve`.
  - Fix export admin: cabeceras completas aun sin datos.
  - Se agregaron guias operativas: `docs/cumbre-ops.md`, `docs/cumbre-qa.md`, `docs/contabilidad-ops.md`.
- Pruebas: N/A (pendiente QA end-to-end)
- Pendientes:
  - Configurar Wompi/Stripe en produccion.
  - Validar webhooks y flujos reales de pago.

### 2026-01-27 (Recordatorios cuotas + links de pago)
- Responsable: Delta (Codex)
- Cambios:
  - Se agrego cron de recordatorios para cuotas manuales (D-3, D-2, D0).
  - Se genera link de pago por cuota (Wompi COP o Stripe USD) para enviar por email/WhatsApp.
  - Se agrego tabla `cumbre_installment_reminders` para evitar duplicados.
  - Se actualizo mailer con plantilla de recordatorio de cuota.
  - Se actualizo webhook Stripe para marcar cuotas pagadas desde links manuales.
  - Se intento tokenizar tarjeta Wompi desde webhook (si viene token) para autodebito.
  - Se actualizo `docs/cumbre-ops.md` con nuevo cron de recordatorios.
- Pruebas: N/A (pendiente QA cron)
- Pendientes:
  - Ejecutar SQL `docs/sql/cumbre_installment_reminders.sql` en Supabase.
  - Configurar `WHATSAPP_WEBHOOK_URL` (si aplica) y validar envio.

### 2026-01-27 (Ajustes precios y condiciones)
- Responsable: Delta (Codex)
- Cambios:
  - Se actualizo copy de paquetes: evento + alimentacion + alojamiento / evento + alimentacion.
  - Se actualizo nota de ninos 0-4 / 5-10 (alojamiento compartido con padres, menu infantil para 5-10).
  - Se actualizo texto de alojamiento (habitaciones tipo seminario).
  - Se actualizo seccion de condiciones: menu tradicional/vegetariano y politica de cambios.
- Pruebas: N/A

### 2026-01-27 (Modo prueba pasarela)
- Responsable: Delta (Codex)
- Cambios:
  - Se agrego opcion de pago de prueba (solo preview) para cobrar montos minimos en COP/USD.
  - Se permite crear cuotas de prueba con total fijo (CUMBRE_TEST_AMOUNT_*).
  - Se agregaron envs `CUMBRE_TEST_MODE` y `PUBLIC_CUMBRE_TEST_MODE`.
- Pruebas: N/A

### 2026-01-27 (Portal Iglesias - base)
- Responsable: Delta (Codex)
- Cambios:
  - Se agrego SQL base para portal iglesias (roles, iglesias, memberships).
  - Se agrego perfil de usuario y endpoint `/api/portal/session`.
  - Se agrego `PORTAL_SUPERADMIN_EMAILS` para superadmin.
  - Se creo `docs/portal-iglesias.md` con guia inicial.
- Pruebas: N/A

### 2026-01-28 (Portal Maná - fase 2 login/onboarding)
- Responsable: Delta (Codex)
- Cambios:
  - Se creo `/portal` y `/portal/ingresar` como rutas principales (alias `/cuenta` via redirect).
  - Se actualizo copy: “Mis Aportes”, “Mis Eventos”, “Mi Perfil”, “Portal Maná”.
  - Se agrego onboarding “Completa tu perfil” (nombre, telefono, ciudad, pais, relacion Maná, sede).
  - Se agrego API `/api/portal/profile` para guardar perfil en `user_profiles`.
  - Se ajusto `user_profiles` con campos nuevos (phone/city/country/affiliation/church_name/church_id).
  - Se agrego tab “Mi Iglesia” con memberships (placeholder si no hay).
  - Se corrigio logo teal/blanco en portal.
  - Se permitio Supabase en CSP (connect-src) y se corrigieron rutas de scripts del portal.
  - Se corrigio carga de assets globales (global.css, lenis, home-animations) con Astro.resolve.
- Pruebas: Pendiente (login OTP + onboarding en preview)
- Pendientes:
  - Configurar `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` en Preview.
  - Ejecutar SQL actualizado `docs/sql/portal_iglesias.sql`.
  - Verificar envio de email OTP (SMTP en Supabase).

### 2026-01-28 (Portal Login Fix - Revertir ?url imports)
- Responsable: Antigravity
- Problema detectado por Delta:
  - El cambio de `Astro.resolve()` a imports `?url` (commit anterior) rompió completamente el portal
  - Errores en consola del navegador:
    - `Failed to resolve module specifier "@lib/supabaseBrowser"`
    - `Failed to resolve module specifier "gsap"`
    - `Failed to resolve module specifier "@studio-freight/lenis"`
    - `Uncaught SyntaxError: Unexpected identifier 'as'` en portal-login.js
  - Build failures en Vercel por sintaxis TypeScript en archivos `.js`
- Causa raíz (IMPORTANTE - Delta, lee esto):
  - **El problema con `?url` imports**: Cuando usas `import script from './script.js?url'`, le dices a Vite/Astro que trate el archivo como un **asset estático** (como una imagen), NO como código JavaScript que debe ser procesado.
  - **Consecuencia**: El navegador recibe el archivo `.js` SIN procesar, con:
    - Path aliases sin resolver (`@lib/supabaseBrowser` queda literal)
    - Imports de node_modules sin resolver (`gsap`, `lenis` quedan literales)
    - El navegador no entiende estos especificadores y arroja "Failed to resolve module specifier"
  - **Por qué `Astro.resolve()` funcionaba**: En Astro 4, `Astro.resolve()` le decía a Astro "procesa este archivo y dame la URL final", pero seguía siendo procesado por Vite.
  - **Solución correcta en Astro 5**: Usar `<script src="ruta/relativa.js">` directamente. Astro 5 automáticamente procesa, bundlea y resuelve dependencias.
- Cambios realizados:
  - **Revertir imports `?url` a script tags estándar**:
    - `src/pages/portal/ingresar.astro`: `<script src="../../scripts/portal-login.js">`
    - `src/pages/portal/index.astro`: `<script src="../../scripts/portal-dashboard.js">`
    - `src/layouts/BaseLayout.astro`: `<script src="../scripts/lenis.js">` y `home-animations.js`
    - `src/components/AccountButton.astro`: `<script src="../scripts/account-button.js">`
  - **Remover imports en frontmatter**: Eliminadas todas las líneas `import scriptName from '...?url'`
  - **Fix CSS global**: Cambiar `import globalStyles from '../styles/global.css?url'` a `import '../styles/global.css'` (import directo)
  - **Remover sintaxis TypeScript de archivos .js**:
    - `src/scripts/portal-login.js`: Eliminadas anotaciones `as HTMLFormElement | null`, etc.
    - Razón: Los archivos `.js` no pueden tener sintaxis TypeScript, solo JavaScript puro
- Commits:
  - `736433d`: "fix(portal): revert script loading to standard Astro imports"
  - `2333cc1`: "fix(portal): remove TypeScript syntax from .js files"
- Pruebas:
  - ✅ Build completa exitosamente en Vercel
  - ✅ Scripts se cargan sin errores de módulos
  - ⏳ Login OTP pendiente (Supabase Auth en mantenimiento programado hasta Feb 2)
- Lección clave para Delta:
  - **NUNCA uses `?url` para scripts que necesitan bundling**. Solo úsalo para assets verdaderamente estáticos (PDFs, imágenes, etc.)
  - **En Astro 5**: Para scripts client-side, usa `<script src="ruta">` directamente, Astro se encarga del resto
  - **Archivos `.js` = JavaScript puro**: Si necesitas TypeScript, usa `.ts` y déjalo que Astro lo compile
- Pendientes:
  - Esperar a que termine mantenimiento de Supabase (Auth service)
  - Validar login OTP funcional post-mantenimiento

### 2026-01-28 (Refinamiento UI/UX - Header, Scroll y Scripts)
- Responsable: Antigravity
- Cambios:
  - **Optimización de Scripts (Astro 5 Bundling)**:
    - Se migraron los scripts de `BaseLayout.astro`, `AccountButton.astro` y `portal-login.astro` a tags `<script>` inline con `import`.
    - Esto resuelve permanentemente los errores de resolución de módulos (`gsap`, `lenis`, `@lib/supabaseBrowser`) al permitir que Astro/Vite bundlee las dependencias correctamente en tiempo de compilación.
  - **Mejoras en el Header**:
    - Se eliminó `overflow-hidden` que cortaba sombras y dropdowns.
    - Se ajustaron márgenes laterales (padding) y gaps entre elementos para evitar desbordamientos en laptops.
    - Se añadió `shrink-0` a los contenedores de acciones para asegurar visibilidad de botones críticos (Donar, Idioma).
  - **Tuning de Scroll (Lenis)**:
    - Se ajustaron los parámetros físicos para un tacto más natural.
    - `duration`: reducido de 1.2s a 0.5s para eliminar el "lag" de arranque.
    - `wheelMultiplier`: restablecido a 1.0 para una respuesta 1:1 dependiente de la fuerza del usuario.
  - **Branding - Botón Donaciones**:
    - Rediseño visual: Color sólido **Teal Maná** (`#28A6BD`) con texto blanco.
    - Hover interactivo: Cambia a **Navy Maná** (`#293C74`) para un feedback premium.
    - Se usaron clases de utilidad directas para asegurar consistencia visual ignorando colisiones de CSS global.
- Pruebas:
  - ✅ Scripts inyectados correctamente y funcionando (Lenis activo).
  - ✅ Header alineado y con todos los elementos visibles.
  - ✅ Botón de donar con contraste alto en light mode.
- Commits:
  - `51e36de`: "fix: use absolute paths for script loading" (Intento inicial)
  - `89ebc84`: "fix: convert all scripts to inline for proper module bundling"
  - `179d2c8`: "fix: adjust header layout and scroll behavior"
  - `2c6efec`: "fix(ui): style donate button with solid teal color and white text"
  - `08caa39`: "fix(ui): update donate button hover color to azul maná (navy)"
  - `70c25d6`: "fix(ux): tune lenis scroll physics for natural feel"
  - `bfe9086`: "fix(portal): update magic link icon to sparkles for better clarity"
  - `3d81cc0`: "feat(portal): add password visibility toggle and sync login logic"
  - `7748207`: "fix(portal): restore stars effect and normalize login UI labels"
  - `5f778ce`: "style(portal): high contrast text updates for dashboard and login"
  - `bb80c82`: "style(portal): fix layout and spacing in church manual registration form"
  - `eac6d63`: "style(portal): harmonize admin users card spacing and layout"
  - `c4e2338`: "feat(primicias): add dedicated landing page with geo-aware payment gateway"
  - `9e225a0`: "fix(primicias): resolve syntax error in client-side script"
  - `[new]`: "style(layout): redesign footer with premium navy theme and fix header logo contrast logic"
  - `[new]`: "fix(auth): correct magiclink generation accessing nested property from Supabase SDK"
  - `[new]`: "feat(portal): redirect magic link directly to dashboard and add password update section in profile"
  - `[new]`: "feat(primicias): add dedicated landing page with geo-aware payment gateway (Wompi/Stripe/Pushpay)"


### 2026-01-28 (Hotfix: Internal Server Error en Preview)
- Responsable: Delta (Codex)
- Cambios:
  - Se detecto error 500: `Astro.resolve is not a function` en Astro 5 (rompia `/` y rutas portal).
  - Se reemplazo `Astro.resolve(...)` por imports `?url` en:
    - `src/layouts/BaseLayout.astro` (global.css, lenis, home-animations)
    - `src/pages/portal/ingresar.astro` (portal-login)
    - `src/pages/portal/index.astro` (portal-dashboard)
    - `src/components/AccountButton.astro` (account-button)
  - Se removio CSS duplicado en `src/pages/index.astro` que forzaba `/src/styles/global.css`.
  - Se corrigio nonce CSP para Edge (middleware) usando `crypto.getRandomValues`.
- Pruebas:
  - Pendiente validar preview post-deploy (home + portal).
- Pendientes:
  - Verificar que el preview nuevo ya no arroje 500.
  - Confirmar que portal carga scripts (sin 404) y aparece mensaje de “Enviando enlace mágico…”.

### 2026-01-28 (Hotfix: CSP bloqueando scripts data:video/mp2t)
- Responsable: Delta (Codex)
- Cambios:
  - Se renombro `src/scripts/*.ts` a `.js` para evitar MIME `video/mp2t` en Vercel.
  - Se actualizo BaseLayout/Portal/AccountButton/ChurchesMap para importar scripts `?url` con `.js`.
  - Se ajusto `astro.config.mjs` con `vite.build.assetsInlineLimit = 0` para evitar `data:` URLs.
- Pruebas:
  - Pendiente validar preview: scripts deben cargar sin CSP block ni MIME error.

### 2026-01-28 (Portal: login por contraseña para superadmins)
- Responsable: Delta (Codex)
- Cambios:
  - Se agregó login temporal por contraseña para superadmins (cuando Supabase Auth está en mantenimiento).
  - Nuevo endpoint: `/api/portal/password-login` crea cookie segura con sesión temporal.
  - Nuevo endpoint: `/api/portal/password-session` valida cookie.
  - Nuevo endpoint: `/api/portal/password-logout` cierra sesión.
  - `/api/portal/session` y `/api/cuenta/resumen` aceptan sesión por cookie (solo superadmin).
  - Portal Dashboard: fallback a modo password cuando no hay token Supabase (sin onboarding).
  - Se añadió campo de contraseña en `/portal/ingresar`.
  - Scripts del portal quedaron como `type="module"` con rutas `/src/scripts/*.js`.
- Pendientes:
  - Configurar env `PORTAL_SUPERADMIN_PASSWORD` en Vercel.
  - (Opcional) `PORTAL_ADMIN_SESSION_SECRET` para firmar cookie con clave distinta.

### 2026-01-28 (Portal login UX)
- Responsable: Delta (Codex)
- Cambios:
  - Se agrego boton separado “Ingresar con Contraseña” para superadmins.
  - Se desactivo smooth scroll en `/portal/ingresar` para evitar scroll pegado.
- Pruebas: Pendiente en preview

### 2026-01-25 (Cumbre Mundial 2026 - backend)
- Responsable: Delta (Codex)
- Cambios:
  - Se agrego esquema SQL para cumbre: bookings, participants, payments.
  - Se creo backend base de cumbre (booking create/get, registration submit, status).
  - Se creo endpoint unificado de pagos (/api/payments/create).
  - Se agrego endpoint para eventos Wompi reenviados con HMAC interno.
  - Se extendio webhook Stripe para registrar pagos cumbre.
  - Se agrego mailer con SendGrid/Resend (segun env).
  - Se actualizo .env.example con variables de cumbre y webhook interno.
- Pruebas: N/A (pendiente)
- Pendientes:
  - Crear paginas /eventos/cumbre-mundial-2026 (UI).
  - Ejecutar SQL en Supabase.
  - Configurar env vars en Vercel (CUMBRE_*, INTERNAL_WEBHOOK_SECRET, SENDGRID_API_KEY).

### 2026-01-24 (Sesión completa)

#### Parte 1 - Intento de Cosmic Design (REVERTIDO)
- Responsable: Nova (Antigravity)
- Cambios:
  - Se implementó sistema de diseño "Cosmic Storytelling" con paleta Deep Space (negro/azul oscuro)
  - Se crearon componentes nuevos: `Hero.astro`, `ChapterPinned.astro`, `Panorama.astro`
  - Se modificó completamente `index.astro` con nueva estructura narrativa
  - Se cambió paleta de colores en `theme.css` de beige/navy a cosmic-void/starlight
  - Se agregaron Lenis y GSAP para animaciones parallax
  - **Commit**: `c0e75ca` - "feat: Add Ayocin-style smooth scroll animations with Lenis and GSAP"
- Problema detectado:
  - El cambio fue demasiado drástico: eliminó contenido original, cambió colores completamente
  - Usuario reportó que "no se veía bien" y se perdió el azul original
  - Faltaban banners y contenido que existía antes
- Acción: **REVERT completo del commit**

#### Parte 2 - Corrección: Solo Animaciones (IMPLEMENTADO)
- Responsable: Nova (Antigravity)
- Cambios:
  - Se ejecutó `git revert c0e75ca` para restaurar contenido y colores originales
  - Se volvieron a agregar Lenis y GSAP a `package.json` (solo librerías)
  - Se crearon scripts de animación que trabajan con componentes existentes:
    - `src/scripts/lenis.ts` - Smooth scroll con física
    - `src/scripts/home-animations.ts` - Parallax via data attributes
  - Se integraron scripts en `BaseLayout.astro`
  - Se agregaron data attributes a componentes existentes:
    - `HeroChapter.astro`: `data-hero` para parallax del título
    - `HistoryChapter.astro`: `data-parallax-bg` y `data-bg` para fondo parallax
  - **Commit**: `f4799a7` - "feat: Add Ayocin parallax animations to existing content"
- Archivos modificados:
  - `package.json` (+2 dependencias: Lenis, GSAP)
  - `src/layouts/BaseLayout.astro` (+2 script tags)
  - `src/components/home/HeroChapter.astro` (+1 data attribute)
  - `src/components/home/HistoryChapter.astro` (+2 data attributes)
  - `src/scripts/lenis.ts` (nuevo)
  - `src/scripts/home-animations.ts` (nuevo)
- Pruebas: Smooth scroll + parallax en hero y backgrounds
- Pendientes:
  - Instalar dependencias: `npm install`
  - Agregar más data attributes (`data-fade`, `data-stagger`, `data-scale`) a otros componentes si se requiere
  - Verificar que animaciones funcionen correctamente en producción

#### Parte 3 - Documentación y Reglas
- Responsable: Delta (Codex)
- Cambios:
  - Se creó `docs/contrato-equipo.md` con roles y reglas de trabajo
  - Se creó `docs/bitacora.md` con formato de registro
  - Se definieron apodos: Nova (Antigravity), Delta (Codex), Atlas (Cloud)
  - Se estableció regla de no incluir referencias a herramientas internas en código
- Pruebas: N/A
- Pendientes: Mantener bitácora actualizada por cada PR/merge

### 2026-01-23
- Responsable: Delta (registro historico)
- Cambios:
  - Redisenos de Home Storytelling y ajustes de componentes.
  - Fix de tailwind.config para evitar error de PostCSS.
- Pruebas: N/A
- Pendientes: Validar build en CI.

### 2026-01-22
- Responsable: Delta (registro historico)
- Cambios:
  - Iteraciones de hero/header/nav (espaciado, legibilidad, tamanos).
  - Seccion historia con timeline + globo y luego storytelling completo.
- Pruebas: N/A
- Pendientes: Ajustar estilo final a referencia visual.

### 2026-01-21
- Responsable: Delta (registro historico)
- Cambios:
  - Ajuste adapter Vercel y limpieza de .vercel/output en repo.
- Pruebas: N/A
- Pendientes: Validar deploy en Vercel.

### 2025-12-22
- Responsable: Delta (registro historico)
- Cambios:
  - Home storytelling + tema Mana (chapters sticky, chips, glass).
- Pruebas: N/A
- Pendientes: Refinar narrativa y animaciones.

### 2025-12-20
- Responsable: Delta (registro historico)
- Cambios:
  - Evangeliza: geocode con ciudad canonica, fallback de Supabase, mapa agrega puntos.
  - Se agrega NOMINATIM_USER_AGENT a .env.example.
- Pruebas: N/A
- Pendientes: Normalizar ciudades y paises.

### 2025-12-19
- Responsable: Delta (registro historico)
- Cambios:
  - Evangeliza heatmap arreglado + mapa actualiza al enviar.
  - Se crea pagina Escuela Biblica.
- Pruebas: N/A
- Pendientes: Pulir copy y assets.

### 2025-12-12
- Responsable: Delta (registro historico)
- Cambios:
  - Stripe checkout fixes + thanks page + bypass captcha en dev.
  - Wompi checkout ajuste + heatmap evangeliza.
  - Landing Mujeres que creen y .env.example de pagos/seguridad.
- Pruebas: N/A
- Pendientes: Webhooks reales con llaves prod.

### 2025-12-10
- Responsable: Delta (registro historico)
- Cambios:
  - Biblia en linea, iglesias, evangeliza y adapter Vercel.
- Pruebas: N/A
- Pendientes: Mejorar UI del visor y CSP.

### 2025-12-09
- Responsable: Delta (registro historico)
- Cambios:
  - Fix churches map con Leaflet y simplificacion de donaciones.
  - Mejora directorio de iglesias y evangeliza map.
- Pruebas: N/A
- Pendientes: QA en mobile.

### 2025-12-08
- Responsable: Delta (registro historico)
- Cambios:
  - Update config.ts de colecciones.
- Pruebas: N/A
- Pendientes: Crear contenido base de news/events.

### 2025-12-07
- Responsable: Delta (registro historico)
- Cambios:
  - Geo-payments, seguridad base y nuevas APIs (merge de feature/geo-payments).
- Pruebas: N/A
- Pendientes: Endpoints de pagos con llaves reales.

### 2025-11-02
- Responsable: Delta (registro historico)
- Cambios:
  - Setup CI workflow, ajuste CI a astro check.
  - Integracion de fuentes Intro.
  - Proyecto Astro inicial.
- Pruebas: N/A
- Pendientes: Definir estructura de contenido.
