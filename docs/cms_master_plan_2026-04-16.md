# CMS Master Plan - Ministerio Maná (2026-04-16)

## Objetivo
Construir un panel de administración de sitio tipo WordPress para que admins/superadmins gestionen contenido público sin tocar código, preservando seguridad, auditoría y control de publicación.

## Alcance detectado del proyecto
- Sitio público multipágina (home, eventos, noticias, ministerios, cumbre, donaciones, campus).
- Portal interno con RBAC, operaciones de eventos/cumbre, finanzas y equipos por iglesia.
- Operación sensible con pagos, exportes, notificaciones y trazabilidad.

## Módulos CMS recomendados
1. Páginas y secciones (base):
- CRUD de páginas CMS.
- Bloques por página (hero, texto, galería, CTA, video, cards, custom).
- Orden de secciones y payload JSON.
- Estados: draft/published/archived.

2. Publicación y control:
- Publicar/despublicar por página.
- Versionado (`cms_revisions`) por cambio relevante.
- Historial operativo (`cms_audit_logs`) con actor, IP y timestamp.

3. Biblioteca multimedia (siguiente fase):
- Integración con Supabase Storage.
- Upload, reemplazo, recorte básico, metadatos (alt, tipo, peso).
- Referencias de uso por sección para detectar assets huérfanos.

4. SEO y navegación (siguiente fase):
- Campos SEO por página (title, description, OG image, canonical).
- Menús editables (header/footer) por país/idioma.
- Redirects 301/302 administrables.

5. Gobernanza editorial (siguiente fase):
- Flujo de aprobación (editor -> admin -> publish).
- Entornos de preview y “programar publicación”.
- Bloqueos de edición concurrente.

## Seguridad
- Acceso restringido a `admin` y `superadmin`.
- Reutilización de guard existente del portal (`portalAdminGuard`) con IP allowlist.
- Todo cambio con bitácora/auditoría.

## Entregable implementado en este ciclo
- SQL base CMS: `docs/sql/cms_schema.sql`.
- API CMS:
  - `GET/POST/PUT /api/portal/content/pages`
  - `GET/POST/PUT/DELETE /api/portal/content/sections`
  - `POST /api/portal/content/publish`
  - `GET /api/portal/content/history`
- Panel inicial:
  - `GET /portal/content`
  - Gestión de páginas, secciones, publicación y actividad reciente.

## Próximos pasos sugeridos
1. Integrar render público dinámico de una página piloto (Home) leyendo `cms_pages + cms_sections`.
2. Conectar biblioteca multimedia (bucket `cms-media`) y selector visual de assets.
3. Añadir permisos granulares por módulo (contenido/medios/seo).
4. Añadir preview draft por token antes de publicar.
