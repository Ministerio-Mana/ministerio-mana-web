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
| Publicado | Interno | No | No | No | No |
| Archivado | Cualquiera | No | No | No | No |

### Cuándo usar cada visibilidad

- **Público en la agenda:** congresos, cultos, encuentros y convocatorias abiertas. Aparece con imagen, fecha, categoría, título, resumen y lugar. También puede recomendarse según el alcance local, regional, nacional o global.
- **Solo por enlace:** reuniones dirigidas a un grupo, preinscripciones o invitaciones que se compartirán por WhatsApp. La persona que tenga el enlace puede abrir la landing, pero el evento no aparece en la agenda ni en recomendaciones.
- **Interno · sin página pública:** planeación interna, reuniones de equipo y actividades cerradas que se administran dentro del Portal. No genera landing, enlace ni formulario público.

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

## Decisión Wompi que no se debe olvidar

Wompi Producción mantiene la URL del router central **21 Retos**. Ministerio Maná consume los eventos que ese router reenvía; no se debe sustituir el endpoint en Wompi de forma unilateral. Ver `docs/WOMPI_ROUTER_21_RETOS_ARCHITECTURE.md`.
