# Contrato de trabajo - Ministerio Mana Web

Fecha: 2026-01-24

## Roles clave
- Antigravity: UI/UX Lead (diseno, layout, CSS/Tailwind, animaciones, accesibilidad, responsive)
- Codex: Backend/Security Lead (endpoints, webhooks, validaciones, env vars, performance, seguridad)
- Cloud/Claude: Copywriting (solo contenido y textos, sin codigo)

## Apodos de trabajo
- Delta = Codex
- Nova = Antigravity
- Atlas = Cloud/Claude

## Reglas de convivencia
1) Separacion de roles
   - Antigravity solo UI/UX.
   - Codex solo backend/integraciones/seguridad.
   - Cloud/Claude solo textos.
2) Nadie toca secretos
   - No se ponen llaves reales en repo, prompts o commits.
   - Secretos solo en Vercel Environment Variables.
   - En el repo solo .env.example con valores fake.
3) Control de dependencias
   - Solo Codex puede modificar package.json y lockfiles.
4) Una rama por tarea
   - No trabajar directo en main.
   - Prefijos: ui/, feat/, fix/, copy/.
5) Entrega limpia
   - Cada entrega debe incluir: archivos tocados, que cambio, como probar, que NO toco.
6) No referencias a herramientas internas
   - No incluir texto sobre IA, prompts o herramientas internas en UI, copy, README, commits o comentarios.
   - Documentacion tecnica debe ser neutral y profesional.

## Mapa de carpetas (Astro)
### Antigravity puede editar
- src/components/** (solo visual)
- src/layouts/**
- src/styles/**
- src/assets/**
- src/pages/index.astro (solo markup/estructura visual)

### Antigravity NO puede editar
- src/pages/api/**
- src/lib/** (server/utils)
- package.json / lockfiles

### Codex puede editar
- src/pages/api/**
- src/lib/** (server)
- astro.config.*
- .env.example (solo documentar variables)

### Codex NO debe tocar
- CSS fino del home (salvo compatibilidad minima)
- animaciones visuales (las define Antigravity)
