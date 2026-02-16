# Directorio de Iglesias y Mapa Global

Este documento define como se carga, valida y publica la informacion de sedes Maná en la web y en el portal.

## 1) Fuente de verdad

- Web publica (pagina `/iglesias` + mapa): `src/data/churches.json`
- Selector de iglesias en portal (registro manual Cumbre): tabla `public.churches`
- Sincronizacion portal desde JSON: `POST /api/portal/admin/seed-churches`
- Seed SQL incremental manual: `docs/sql/churches_global_seed.sql`

## 2) Estructura de cada iglesia (JSON)

Campos recomendados:

- `name`: nombre visible de la sede
- `city`: ciudad o zona
- `country`: pais
- `continent`: continente (para chips)
- `address`: direccion completa
- `maps_url`: enlace directo de Google Maps (opcional pero recomendado)
- `lat` / `lng`: coordenadas para pin en mapa
- `contact.name`: responsable local
- `contact.email`: correo institucional (si existe)
- `contact.phone`: telefono de contacto
- `whatsapp`: telefono para boton de WhatsApp
- `service`: horario principal de reunion
- `notes`: aclaraciones operativas

Regla operativa: si no hay correo institucional, dejar `null` y mantener telefono/WhatsApp activo.
Regla mapa: si hay `maps_url`, se usa ese enlace como prioridad para “Cómo llegar”.

## 3) UX del mapa y filtros

- El mapa global permite enfocar por pais (chips arriba a la derecha).
- En cada pin se muestran acciones directas:
  - `Cómo llegar` (Google Maps)
  - `WhatsApp` (si el numero existe)
- En listado inferior:
  - Filtro por continente (chips)
  - Filtro por pais (chips con contador)
  - Busqueda por texto (ciudad/pais/iglesia/direccion)
- El listado y el mapa comparten foco por pais mediante evento UI (`mana:church-country-focus`).

## 4) Logica de roles (eventos / iglesias)

Para Cumbre y gestion por sedes:

- `superadmin`: acceso global y configuracion total
- `admin`: gestion global operativa
- `church_admin` (pastor): administra su sede
- `church_member` (colaborador): registra participantes/pagos, sin permisos globales

Flujo esperado:

1. Superadmin/admin crea o invita pastor/colaborador.
2. Usuario queda asociado en `church_memberships`.
3. Portal usa `church_id` para filtrar registros y estadisticas.
4. Registro manual de Cumbre queda trazado por `church_id` + `contact_church`.

## 5) Datos confirmados en esta iteracion

Se agregaron sedes/contactos de:

- Colombia: Pereira
- Ecuador: Cuenca, Quito, Guayaquil Sur, Guayaquil Norte
- Mexico: Tantoyuca (Emanuel Cielos Abiertos)
- Francia: Paris
- Europa (contacto regional): Carlos Claros (base Paris)

Nota Europa: mientras no haya sedes fisicas adicionales confirmadas, se mantiene un punto regional de contacto para Europa.

## 6) Checklist cuando llegue una iglesia nueva

1. Confirmar nombre oficial de sede
2. Confirmar direccion exacta + ciudad + pais
3. Confirmar contacto principal (nombre, telefono, correo)
4. Obtener WhatsApp con indicativo internacional
5. Definir horario de servicio
6. Cargar en `src/data/churches.json`
7. Sincronizar a portal (`/api/portal/admin/seed-churches` o SQL)
8. Verificar en `/iglesias` y en modal de selector del portal
