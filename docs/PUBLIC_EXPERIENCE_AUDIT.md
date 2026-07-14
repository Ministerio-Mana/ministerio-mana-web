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
| Iglesias y mapa | Mapa Leaflet funcional, directorio híbrido y páginas locales con tres plantillas. | Supabase alimenta el directorio sin perder el respaldo estático; falta QA con una sede publicada. |
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

## Registro Iglesias — 14 de julio de 2026

- El directorio público combina las iglesias de Supabase con el respaldo editorial existente; un fallo de base de datos no deja el mapa ni las tarjetas vacías.
- Cada sede publicada obtiene `/iglesias/{slug}` y aparece con “Conocer esta iglesia” en el directorio. Las sedes sin página continúan mostrando ubicación y contacto sin enlaces rotos.
- `Esencial` prioriza información práctica y velocidad; `Historia` reutiliza el barrido vertical de Historia Maná; `Mosaico` ofrece una composición editorial nueva con movimiento progresivo y degradación estática.
- Las tres experiencias comparten tipografía, jerarquía, paleta, footer, contactos, mapa, galería y próximos eventos locales. En móvil pasan a una columna y respetan `prefers-reduced-motion`.
- La imagen nunca se estira. Portadas usan composición adaptable; escenas permiten fondo, división o arte protagonista; galerías recortan únicamente dentro de tarjetas previsibles.
- La versión pública se sirve desde una instantánea separada del borrador. Las imágenes externas no registradas y las pertenecientes a otra sede se rechazan antes de guardar.
- La activación productiva requiere `docs/sql/church_public_pages.sql` y una publicación de prueba autorizada. Hasta entonces, el directorio existente sigue funcionando sin cambios destructivos.

## Registro Devocional y Peticiones — 14 de julio de 2026

- La auditoría en vivo confirmó que `/devocional/` obtiene el video actual y que el reproductor del footer reproduce YouTube, pero el footer conservaba una miniatura fija por una inicialización incorrecta de caché.
- El footer ahora intenta la consulta inicial, usa miniaturas reales de YouTube incluso durante el respaldo y vuelve a intentar pronto si la fuente remota falla. No bloquea la página más de 320 ms.
- El muro público de Peticiones cargó su registro sin desbordamiento ni exposición adicional. El detalle ahora se anuncia como diálogo, enfoca el cierre, acepta `Escape` y devuelve el foco a la petición que lo abrió.

## Matriz responsive y correcciones — 14 de julio de 2026

- La auditoría automatizada `npm run audit:public-ui` abre Chrome real a 1440 × 900, 768 × 1024 y 390 × 844. Comprueba desbordamiento, encabezados, imágenes, etiquetas, objetivos táctiles y contratos propios de Peticiones, Iglesias e Historia Maná.
- `/peticiones/` conserva un solo `h1`, cero imágenes rotas, cero campos sin etiqueta y ningún desbordamiento en los tres anchos. Las peticiones funcionales usan siete ranuras reservadas en escritorio y seis en tableta o celular; no comparten posiciones con los papeles decorativos.
- Cada petición visible es ahora un papel completo horizontal o vertical, con nombre manuscrito legible, área interactiva mínima de 44 px, foco visible y detalle separado. La paginación impide reutilizar una ranura dentro de la misma vista.
- `/iglesias/` cargó 22 tarjetas y 22 marcadores en los tres anchos, sin desbordamiento, imágenes rotas, etiquetas faltantes ni objetivos menores de 44 px. Marcadores, zoom, cierre de popup y acciones de contacto tienen nombre accesible y superficie táctil completa.
- `/home-ministerio`, Peregrinación, Campus y Devocional pasaron sin desbordamiento ni imágenes rotas. El regreso de Peregrinación se elevó a 44 px; Campus recibió etiquetas programáticas para monto y datos de pago, un error anunciable y estado `disabled` real antes de elegir un monto válido.
- La revisión visual humana sigue siendo necesaria para juzgar ritmo, recorte artístico y comodidad del movimiento; la matriz automática evita declarar como correcto un diseño que técnicamente se desborde o pierda accesibilidad.

## Frontera de almacenamiento público y privado

- ImageKit es la fuente recomendada para portadas, galerías, escenas y artes públicos de iglesias, eventos y páginas. Su CDN entrega variantes responsive y formatos optimizados sin exponer bibliotecas internas.
- SharePoint conserva originales operativos, Excel, comprobantes, documentos, aprobaciones y archivos sujetos a auditoría o retención. No se usa como CDN de la experiencia pública.
- Solo se conserva una copia maestra en SharePoint cuando exista una necesidad aprobada de archivo institucional. No se duplican automáticamente todos los medios públicos, para evitar almacenamiento, sincronización y gobierno innecesarios.
- Esta separación mantiene la página rápida y pública en ImageKit, mientras los archivos sensibles permanecen privados y sujetos a permisos en SharePoint.

## Cierre humano de esta fase

- Revisar `/home-ministerio` y la peregrinación en escritorio, tableta y celular.
- Confirmar que el ritmo se siente suave y que ningún panel obliga a seguir una animación para leer.
- Aprobar qué borrador del Home se convierte en fuente oficial antes de cambiar la portada `/`.
- Crear una página controlada con `Historia Maná`, elegir imágenes horizontal, cuadrada y vertical desde ImageKit y aprobar las tres presentaciones antes de usar el constructor en Home.
- Publicar una sede controlada con cada una de las tres plantillas y confirmar directorio, mapa, WhatsApp, correo y evento local en 390 px y escritorio.
- Después del despliegue, confirmar que el footer muestra la miniatura del devocional más reciente y que reproducir, pausar, cambiar video y mover el progreso siguen funcionando.
- Abrir y cerrar una petición por teclado; confirmar que `Escape` devuelve el foco a la tarjeta sin marcar “Oré”.
