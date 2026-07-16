# Plan de landings públicas: eventos e iglesias

Fecha: 15 de julio de 2026

## Objetivo

Convertir cada evento y cada iglesia en una página pública útil, atractiva, accesible y segura, sin obligar a pastores o colaboradores a maquetar, escoger contrastes ni conocer código.

## Principios confirmados

- Cada evento debe tener una URL pública única con nombre, fecha, zona horaria, lugar, imagen, organizador, estado e inscripción coherentes. Google recomienda además imágenes 1:1, 4:3 y 16:9 cuando estén disponibles y datos estructurados `Event`: https://developers.google.com/search/docs/appearance/structured-data/event
- Una iglesia necesita un punto público único para horarios, calendario o eventos, ubicación, contacto, contenido y próximos pasos. Church Center organiza este patrón como perfil, calendario, eventos, grupos, formularios, donaciones y páginas: https://pcoaccounts.zendesk.com/hc/en-us/articles/360010614793-Set-up-Church-Center
- Los formularios deben conservar etiquetas, instrucciones, validación comprensible y feedback accesible: https://www.w3.org/WAI/tutorials/forms/
- No se solicitará geolocalización exacta por defecto. El portal prioriza por iglesia, ciudad, región y país ya guardados en el perfil. Si en otra fase se ofrece ubicación del dispositivo, debe ser opt-in, explicar finalidad y retención, y funcionar solo bajo HTTPS: https://www.w3.org/TR/geolocation/

## Landing de evento

### Orden público

1. Portada adaptable para arte horizontal, cuadrado o vertical, sin deformarlo.
2. Título, resumen, fecha, lugar, modalidad, cupo y valor.
3. Acción primaria de inscripción y acción secundaria para guardar el calendario.
4. Descripción y bloques guiados opcionales:
   - Qué vivirán los asistentes.
   - Agenda o momentos principales.
   - Información práctica antes de asistir.
   - Equipo u organización responsable.
5. Formulario interno o enlace externo, según la configuración.
6. Métodos de aporte o donación permitidos por alcance y país.
7. WhatsApp o correo de ayuda.
8. Footer y navegación institucional compartidos.

### Protección editorial

- Los colaboradores escriben contenido, no colores ni HTML.
- La plantilla controla tipografía, contraste, overlay, espacios, largo de línea y comportamiento móvil.
- Los cuatro bloques de contenido aceptan texto plano con límites de longitud.
- Comprobantes, documentos de pagador, cédulas e información financiera nunca forman parte de la página pública.
- La descarga `.ics` contiene únicamente información pública del evento.

## Landing de iglesia

### Orden público

1. Portada con nombre, ciudad, bienvenida, WhatsApp y ruta.
2. Descripción de la comunidad y horarios.
3. `Planifica tu visita`: reunión, dirección y contacto local.
4. Equipo pastoral cuando la iglesia decida publicarlo.
5. Galería optimizada y con texto alternativo.
6. Próximos eventos locales enlazados a sus landings.
7. Contacto final con ubicación, correo y WhatsApp.
8. En fases posteriores: ministerios o grupos, prédicas o recursos y preguntas frecuentes.

### Plantillas

- `Esencial`: lectura directa y rápida.
- `Historia`: escenas de pantalla completa con movimiento reducido cuando el dispositivo lo solicite.
- `Mosaico`: composición editorial de imágenes y tarjetas.

Las tres consumen los mismos datos y conservan los mismos requisitos de publicación. Cambiar de plantilla no duplica contenido ni rompe la página.

## Descubrimiento de eventos

El portal muestra solo eventos `PUBLISHED` y `PUBLIC`, vigentes y autorizados para el perfil:

1. La iglesia del usuario.
2. Otras iglesias de la misma ciudad y país.
3. Su región.
4. Su país.
5. Eventos globales.

Dentro de cada nivel se ordenan por fecha. No se usa GPS ni se expone la ubicación del usuario. Un evento privado no se convierte en descubrible aunque comparta territorio.

## Arquitectura de medios

- Invitaciones de eventos: SharePoint mediante el proxy autenticado y los contratos existentes.
- Imágenes públicas de iglesias: ImageKit para transformación, tamaños responsivos y entrega pública optimizada.
- Evidencias de pago y documentos operativos: almacenamiento privado, URLs firmadas de corta duración y acceso por rol.

No se deben mezclar archivos públicos de comunicación con archivos financieros privados.

## Entregado en esta fase

- Jerarquía territorial reutilizable para recomendar eventos al usuario.
- Enlaces reales desde `Eventos para ti` hacia cada landing pública.
- Etiquetas de contexto: iglesia, cercanía, región, país o global.
- Bloques editoriales guiados dentro del editor de eventos.
- Descarga segura de calendario `.ics` y enlace a ubicación.
- Sección `Planifica tu visita` en las tres plantillas de iglesia.
- Datos estructurados para eventos e iglesias.
- Pruebas unitarias de alcance, visibilidad, orden y sanitización.
- Corrección de las tres rutas del archivo editorial de eventos, que enlazaban desde el listado pero respondían 404.

## Próximas fases

### Fase 2 — contenido enriquecido controlado

- Agenda estructurada por horas.
- Invitados u oradores con foto y función.
- Preguntas frecuentes.
- Galería adicional del evento con posiciones predeterminadas.
- Bloques activables y reordenables dentro de un catálogo cerrado, con vista previa real.

### Fase 3 — comunidad local

- Ministerios o grupos de la iglesia.
- Recursos, prédicas o enlaces verificados.
- Calendario local filtrable.
- Solicitud de acompañamiento para visitantes nuevos, con consentimiento explícito.

### Fase 4 — proximidad opcional

- Ofrecer `Usar mi ubicación` solo con permiso explícito.
- Explicar por qué se solicita y no guardar coordenadas precisas por defecto.
- Mantener siempre la alternativa manual de país, región, ciudad e iglesia.

### Fase 5 — informes financieros locales

- Definir con Finanzas los datos mínimos, responsables, periodicidad y aprobaciones.
- Diseñar carga guiada por iglesia y consolidación regional/nacional.
- Evitar convertir la landing pública o el editor pastoral en un sistema contable sin controles.

## Verificación pendiente con usuario autenticado

- Crear y publicar una iglesia de prueba en cada plantilla.
- Crear un evento de prueba `LOCAL`, `REGIONAL`, `NATIONAL` y `GLOBAL`.
- Confirmar con perfiles representativos que cada persona ve solo los alcances que le corresponden.
- Probar inscripción, calendario, WhatsApp, mapa, Wompi, Stripe y métodos manuales según el evento.
- Validar en teléfono, tableta y escritorio el editor y las dos landings.

Esta fase no agrega SQL: reutiliza `events.page_settings`, `region_id` y las tablas de páginas de iglesia ya instaladas.
