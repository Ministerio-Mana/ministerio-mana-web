# Auditoría de experiencia pública

Fecha base: 14 de julio de 2026.

## Objetivo de la fase

Revisar las páginas públicas como un sistema y convertir la narración por desplazamiento en una firma reconocible de Ministerio Maná, sin aplicar movimiento cinematográfico a formularios o herramientas operativas.

## Contrato Historia Maná

La historia se construye con paneles de una pantalla y una transición vertical reversible: al bajar, el panel siguiente cubre al anterior; al subir, la secuencia se reproduce en sentido contrario. El contenido permanece en orden semántico y debe poder leerse completo sin JavaScript o con reducción de movimiento.

Hay tres intensidades compartidas:

| Preset | Uso | Comportamiento |
| --- | --- | --- |
| `calm` | Entradas editoriales cortas y transiciones de sección | Poco desplazamiento, descanso rápido y sin protagonismo excesivo. |
| `editorial` | Peregrinaciones, campañas e historias | Barrido claro, lectura pausada y seis escenas recomendadas como máximo antes de ofrecer detalle normal. |
| `cinematic` | Portadas especiales y relatos institucionales | Mayor profundidad y ritmo, solo en escritorio o dispositivos capaces. |

Reglas obligatorias:

- En móvil angosto la historia pasa a flujo vertical estático cuando la densidad o el contenido lo requieren.
- `prefers-reduced-motion: reduce` elimina fijación, barridos, desenfoques y saltos; todas las escenas siguen visibles y accesibles.
- La transición no impide usar teclado, enlaces internos ni el scroll nativo.
- Cada escena tiene una idea principal, un título, texto breve y como máximo una acción primaria.
- Imágenes decorativas usan texto alternativo vacío; las informativas conservan texto alternativo útil.
- No se usa autoplay con sonido ni movimiento perpetuo imprescindible para entender la página.

El contrato técnico vive en `src/lib/storyMotion.ts`, `src/styles/story-motion.css` y `src/components/story/ManaStoryDeck.astro`. El motor histórico conserva compatibilidad con los atributos existentes mientras las rutas se migran por etapas.

## Inventario inicial

| Ruta o módulo | Estado encontrado | Decisión |
| --- | --- | --- |
| `/home-ministerio` | Relato completo de once escenas con implementación manual. | Mantener como laboratorio; corregir acceso con reducción de movimiento y migrar por escenas antes de considerar reemplazar `/`. |
| `ManaPinnedStory` | Segunda versión de once escenas con GSAP, mapa y barridos; no se renderiza en una ruta pública. | Conservar como referencia visual y hacerla consumir los mismos tokens, sin publicarla por accidente. |
| `/peregrinaciones/turquia-islas-griegas-2026` | Seis escenas narrativas y detalle largo posterior. | Primera ruta migrada al componente compartido con preset `editorial`. |
| Cumbre — bienvenida | Siete escenas con el mismo motor usado por Peregrinaciones. | Migrada al componente compartido con preset `cinematic`; no reactivar campañas cerradas. |
| Campus | Portada visual con revelados independientes y valores históricos fuera de escala. | Auditar en la siguiente etapa; usar movimiento calmado, no una historia completa, salvo una campaña concreta. |
| Peticiones | Muro operativo con formulario y privacidad sensible. | Priorizar calma, legibilidad, feedback y privacidad; no fijar escenas al scroll. |
| Iglesias y mapa | Mapa Leaflet funcional con filtros, controles y variante ambiental. | Mejorar responsive, carga, teclado y diseño de tarjetas; reservar el mapa ambiental para escenas narrativas. |
| CMS de Contenido | Admite bloques editoriales y carga directa a ImageKit. El constructor técnico obligaba a copiar URLs o editar JSON. | `Historia Maná` agregado como plantilla cerrada: escenas, preset, paleta, layout, punto focal y selector visual de ImageKit; nunca expone valores libres de movimiento. |

## Etapas

1. **Base compartida:** presets seguros, componente, degradación estática y pruebas de contrato.
2. **Home laboratorio:** revisar escena por escena, copy, recursos, foco, teclado, rendimiento y responsive; no cambiar `/` sin aprobación.
3. **Iglesias y mapa:** carga resiliente, alternativa si falla el proveedor, tarjetas móviles y navegación accesible.
4. **Campus:** jerarquía, tokens, imágenes, movimiento calmado y conversión sin distraer del aporte.
5. **Peticiones:** privacidad visible, formulario indulgente, estados, accesibilidad y densidad.
6. **CMS:** constructor restringido con presets `calm`, `editorial` y `cinematic`, previsualización, selector de ImageKit y límites de dos a ocho escenas. Implementado técnicamente; QA productivo pendiente.

## Registro CMS — 14 de julio de 2026

- El bloque `story` comparte `ManaStoryDeck` y los presets tipados existentes; no se creó un motor paralelo.
- La edición es guiada y no requiere JSON: permite reordenar escenas, elegir presentación para horizontal/cuadrada/vertical, definir punto focal, texto alternativo y CTA opcional.
- La biblioteca ImageKit se abre dentro de un diálogo con búsqueda y aplica la URL directamente al campo elegido.
- Borradores por pestaña incluyen estructura y valores de escenas. Los límites se vuelven a validar en el API.
- Publicar exige una sola historia por página, al menos dos escenas y título, imagen y texto alternativo en cada escena.
- Una ruta pública dinámica sirve únicamente páginas publicadas; las rutas especiales existentes conservan prioridad.
- El catálogo de recursos y las recomendaciones de carga viven en `CMS_STORY_IMAGE_GUIDE_2026-07-14.md`.

## Cierre humano de esta fase

- Revisar `/home-ministerio` y la peregrinación en escritorio, tableta y celular.
- Confirmar que el ritmo se siente suave y que ningún panel obliga a seguir una animación para leer.
- Aprobar qué borrador del Home se convierte en fuente oficial antes de cambiar la portada `/`.
- Crear una página controlada con `Historia Maná`, elegir imágenes horizontal, cuadrada y vertical desde ImageKit y aprobar las tres presentaciones antes de usar el constructor en Home.
