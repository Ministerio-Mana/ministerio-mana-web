# Eventos: publicación, visibilidad y auditoría de controles

Fecha: 2026-07-16
Rutas: `/portal/events`, `/portal/events/:id`, `/eventos`, `/eventos/:slug`

## Regla fácil para el equipo pastoral

**Publicación** responde: “¿ya terminé de prepararlo?”.
**Visibilidad** responde: “si está publicado, ¿quién puede encontrarlo?”.

Son decisiones distintas. Elegir una visibilidad no publica un borrador.

| Publicación | Visibilidad | Agenda `/eventos` | Enlace público | Buscadores | Formulario público |
| --- | --- | --- | --- | --- | --- |
| Borrador | Cualquiera | No | No | No | No |
| Publicado | Público en la agenda | Sí | Sí | Sí | Sí, si la inscripción está activa |
| Publicado | Solo por enlace | No | Sí | No (`noindex`) | Sí, si la inscripción está activa |
| Archivado | Cualquiera | No | No | No | No |

### Cuándo usar cada visibilidad

- **Público en la agenda:** congresos, cultos, encuentros y convocatorias abiertas. Aparece con imagen, fecha, categoría, título, resumen y lugar. También puede recomendarse según el alcance local, regional, nacional o global.
- **Solo por enlace:** reuniones dirigidas a un grupo, preinscripciones o invitaciones que se compartirán por WhatsApp. La persona que tenga el enlace puede abrir la landing, pero el evento no aparece en la agenda ni en recomendaciones.

**“Interno” ya no se ofrece al crear eventos.** Duplicaba el estado Borrador y no permitía convocar, registrar ni conciliar. El valor se conserva únicamente para abrir registros antiguos sin cambiarlos de forma automática. Un evento cerrado que sí necesita llegar a personas debe usar **Solo por enlace**; una actividad que todavía se está preparando debe permanecer en **Borrador**.

## Controles auditados

### Gestión de Eventos

- **Nuevo evento:** abre el editor; permanece deshabilitado hasta validar permisos y catálogos.
- **Filtros Activos, Próximos, En curso, Terminados, Borradores y Archivados:** cambian la lista y anuncian su estado seleccionado.
- **Buscar evento o lugar / Todo alcance:** filtran sin modificar datos.
- **Abrir operación:** abre inscripciones, pagos, asistencia, Excel y documentos privados.
- **Ver invitación:** solo aparece en un evento publicado que no sea privado.
- **Editar:** respeta el alcance pastoral del usuario.
- **Publicar / Archivar / Restaurar:** actualizan el ciclo de vida sin eliminar el histórico.

Cada tarjeta muestra ahora el resultado de visibilidad: **En agenda pública**, **Solo por enlace** o **Interno**.

“Interno” solo puede aparecer en una tarjeta heredada. No está disponible en eventos nuevos.

### Editor

- Cerrar, Cancelar y Escape preservan el trabajo con confirmación cuando hay cambios.
- Título, publicación, descripción, duración, modalidad, alcance e inscripción incluyen ayudas contextuales accesibles por mouse, teclado y toque.
- La descripción propone un ejemplo pastoral y una longitud recomendada sin usar el placeholder como etiqueta.
- Un evento de un día pide una sola fecha; “Varios días” revela inicio y finalización.
- La modalidad es independiente del cobro. Virtual oculta lugar, dirección y mapa; presencial e híbrido los muestran.
- El alcance local se elige en cascada por país, región, ciudad e iglesia; al escoger la sede se completan ciudad, país, lugar y dirección desde el catálogo autorizado.
- Título, descripción, fechas, alcance, región/iglesia, ubicación, modalidad y zona horaria alimentan la landing y la operación.
- La imagen acepta horizontal, cuadrada o vertical; conserva el contenido y adapta la presentación.
- Publicación y visibilidad incluyen ayuda dinámica en lenguaje pastoral.
- Copiar enlace y Abrir invitación solo se habilitan cuando existe una landing pública válida.
- Inscripción permite: sin formulario, formulario externo o formulario Maná; cada opción explica si informa, reserva cupos o envía a otra plataforma.
- El formulario Maná mantiene datos base y preguntas adicionales configurables.
- El cobro permanece asociado al formulario Maná porque necesita una inscripción y un pagador identificables para evitar duplicados y aportes huérfanos. Un checkout sin inscripción requerirá un flujo contable de “solo pagador” separado antes de habilitarse.
- Cobro permite Wompi COP, Stripe USD, ambos para alcance global y opciones manuales como QR, transferencia, PayPal, Zelle o enlace externo.
- El QR admite selección y arrastre, muestra vista previa y no se publica hasta guardar correctamente.
- Guardar valida fechas, alcance, moneda, métodos de pago, formulario e imagen antes de confirmar.

### Landing pública

- Ver/abrir inscripción.
- WhatsApp y correo del organizador.
- Guardar en calendario y abrir ubicación.
- Ver brochure, si existe.
- Compartir por WhatsApp y copiar el enlace oficial.
- Inscribirse, escoger pago y adjuntar comprobante cuando corresponde.
- Mensajes explícitos para inscripción próxima, cerrada, sin cupo o en validación de pago.

### Operación

- Volver a Eventos, actualizar datos, actualizar Excel en OneDrive y descargar una copia.
- Actualizar archivos, arrastrar/seleccionar documento privado y subirlo.
- Buscar inscripciones y filtrar por estado.
- Ver comprobante, aprobar o rechazar un pago manual.
- Registrar cantidad de asistentes presentes.
- Paginar resultados.

Los controles de filas sin datos reales se auditaron por contrato de código; la prueba interactiva de aprobar, rechazar y registrar asistencia requiere una inscripción de prueba autorizada.

## Contenido recomendado para una landing de evento

La base implementada cubre:

- título y resumen claros;
- fecha, hora, zona horaria, modalidad, lugar y mapa;
- imagen adaptable y categoría;
- qué vivirá la persona;
- agenda;
- información práctica;
- equipo organizador;
- accesibilidad y necesidades familiares;
- preguntas frecuentes;
- cambios, cancelaciones y condiciones de los aportes;
- contacto, compartir, calendario e inscripción;
- datos estructurados de buscadores, incluida la modalidad presencial, virtual o híbrida.

Mejoras posteriores, solo cuando el evento lo necesite:

1. lista de espera al agotarse los cupos;
2. sesiones o talleres elegibles dentro de una agenda extensa;
3. acceso virtual protegido para inscritos;
4. avisos de cambio o cancelación a inscritos;
5. perfil público de conferencistas o pastores;
6. solicitudes privadas de acomodación, con recolección mínima de datos;
7. galería posterior y memoria del evento separadas de los documentos internos.
8. plantillas visuales Esencial, Historia y Mosaico reutilizando el sistema Stories Plus, con bloques guiados e imágenes adaptables sin permitir maquetación libre.

## Estándar para la fase de plantillas

Las tres plantillas comparten el mismo contenido y contrato de inscripción; cambia la composición visual, no la información ni los permisos.

### Bloques obligatorios compartidos

1. **Portada:** arte principal, título, resumen breve, fecha, modalidad, lugar y una sola acción primaria.
2. **Razón para asistir:** descripción en párrafos breves y una imagen contextual opcional.
3. **Agenda:** horarios o etapas, con inicio y finalización correctos para eventos de varios días.
4. **Información práctica:** acceso, mapa o enlace virtual, zona horaria, accesibilidad, familias y recomendaciones.
5. **Organiza y contacto:** equipo responsable, WhatsApp y correo.
6. **Inscripción o aporte:** cupos, valor, moneda, métodos habilitados y estado del registro.
7. **Preguntas frecuentes y condiciones:** cambios, cancelación y tratamiento del aporte.
8. **Cierre:** compartir, calendario y acción de inscripción repetida cuando corresponda.

### Esencial

- Hero horizontal o composición adaptable con arte cuadrado/vertical sin deformarlo.
- Lectura lineal, rápida y con secciones tradicionales.
- Ideal para reuniones locales y páginas con poco contenido.

### Historia · Stories Plus

- Escenas de pantalla completa que avanzan con scroll y conservan una narrativa clara al retroceder.
- Cada escena admite fondo de color o imagen con overlay calculado, texto breve y un recurso visual.
- Indicador de progreso, navegación por teclado, alternativa sin movimiento y respeto de `prefers-reduced-motion`.
- La inscripción nunca depende de terminar la animación: CTA visible al inicio y al cierre.

### Mosaico

- Portada editorial y tarjetas para agenda, protagonistas, imágenes e información práctica.
- Reordena tarjetas en una sola columna en móvil sin scroll horizontal.
- Ideal para congresos, encuentros de varios días y eventos con bastante contenido.

### Reglas del editor visual

- No habrá lienzo libre ni posiciones manuales. El pastor elige plantilla y completa bloques guiados.
- Cada imagen declara su función: portada, arte de invitación, escena o galería. La interfaz muestra proporción recomendada, peso máximo y vista previa móvil/escritorio.
- La aplicación selecciona texto claro u oscuro a partir del fondo y añade overlay cuando una foto no garantiza contraste AA; el usuario no puede publicar texto ilegible.
- Las imágenes usan `object-fit` según la función: portada con recorte seguro y punto focal; arte de invitación completo con fondo adaptado; nunca se estiran.
- Título, fecha, lugar, organizador, inscripción y datos estructurados permanecen iguales en las tres plantillas.

### Referencias de producto y accesibilidad

- Google exige una URL única por evento y datos correctos de nombre, inicio, finalización, lugar, precio, moneda y enlace de la oferta: https://developers.google.com/search/docs/appearance/structured-data/event
- Eventbrite organiza la creación alrededor de portada, datos básicos, ubicación, agenda, entradas, formulario, vista previa, privacidad y publicación: https://www.eventbrite.com/help/en-us/articles/551351/how-to-create-an-event/
- WCAG 2.2 exige contraste mínimo del texto y también aplica cuando el fondo es una imagen: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum y https://w3c.github.io/wcag/techniques/failures/F83

## Decisión Wompi que no se debe olvidar

Wompi Producción mantiene la URL del router central **21 Retos**. Ministerio Maná consume los eventos que ese router reenvía; no se debe sustituir el endpoint en Wompi de forma unilateral. Ver `docs/WOMPI_ROUTER_21_RETOS_ARCHITECTURE.md`.

## Implementación de plantillas completada

El editor de Gestión de Eventos ya guarda `template` y `theme` dentro de `page_settings`; no fue necesario ampliar el contrato SQL ni tocar pagos, documentos, asistentes o permisos. Las opciones admitidas son cerradas y normalizadas:

- plantillas: `ESSENTIAL`, `STORY`, `MOSAIC`;
- paletas: `navy`, `light`, `warm`.

La página pública interpreta el mismo contenido de tres maneras:

- Esencial conserva la lectura lineal;
- Historia usa el motor accesible de Stories Plus y mantiene la información práctica fuera de la animación;
- Mosaico convierte los bloques guiados en una composición editorial que vuelve a una columna en móvil.

Verificación realizada el 16 de julio de 2026:

- normalización y valores inválidos cubiertos por pruebas unitarias;
- contrato editor → `page_settings` → página pública cubierto por prueba de fuente;
- compilación de producción completada;
- prueba visual en 1280 px y 390 px, sin scroll horizontal y sin controles visibles menores de 44 px;
- Historia confirmó tres escenas con navegación accesible en el evento de contenido usado para la prueba.
