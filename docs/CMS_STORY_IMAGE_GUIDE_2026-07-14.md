# Guía de imágenes para Historia Maná

Fecha: 14 de julio de 2026.

## Regla principal

Las medidas son recomendaciones, no condiciones de rechazo. El constructor acepta imágenes horizontales, cuadradas y verticales. La presentación elegida decide cómo se muestran:

- **Imagen de fondo:** usa recorte adaptable y un punto importante configurable.
- **Imagen a la izquierda o derecha:** conserva una composición editorial y recorta únicamente el contenedor visual.
- **Arte protagonista:** muestra completa una invitación cuadrada o vertical sobre un fondo ambiental derivado de la misma imagen.

No se debe incrustar título, fecha o botones dentro de una fotografía de fondo. Ese texto pertenece al contenido HTML para que siga legible, traducible y accesible.

## Paquete inicial para Home

Subir entre 10 y 14 imágenes a la carpeta `home/historia` de ImageKit:

| Uso | Cantidad | Orientación recomendada | Tamaño de referencia |
| --- | ---: | --- | --- |
| Portada y cierre | 2 | Horizontal | 1920 × 1080 o superior |
| Historia del ministerio | 2 | Horizontal o vertical documental | 1600 px en el lado largo |
| Misión y visión | 2 | Horizontal | 1600 × 1200 |
| Devocional | 1 arte + 1 ambiente | Cuadrado y horizontal | 1200 × 1200; 1920 × 1080 |
| Frentes o ministerios | 3 | Cuadrada o vertical | 1200 × 1200 o 1200 × 1600 |
| Iglesias y comunidad | 3 a 6 | Horizontal/documental | 1600 × 1200 |

### Lista exacta del laboratorio `/home-ministerio`

El laboratorio tiene once escenas. No todas necesitan una fotografía exclusiva; los mapas, logos e ilustraciones existentes se conservan. Este es el pedido concreto para una primera versión:

1. **Orar y agradecer:** una imagen amplia de adoración o comunidad, con espacio libre para el título.
2. **Misión:** una imagen de discipulado, servicio o grupo pequeño.
3. **Visión 2030:** una imagen que comunique alcance nacional e internacional.
4. **Origen 2016:** una foto autorizada de los pastores Carlos Ríos y Gloria Cano; opcionalmente una segunda imagen histórica de Londres o Medellín.
5. **Devocional Maná:** una foto real grabando o compartiendo el devocional; el logo y el mapa actuales permanecen.
6. **Principios y valores:** una foto de estudio bíblico o enseñanza, usada como apoyo ambiental.
7. **Tres frentes:** conservar los tres logos actuales; agregar una sola imagen comunitaria si se desea más calidez.
8. **Objetivos:** una foto de evangelismo, discipulado o servicio; el contenido puede alternar sobre la misma imagen.
9. **Alimento espiritual:** una foto de los materiales, cursos o personas estudiando.
10. **Iglesias:** entre tres y seis fotos de sedes y comunidades; el mapa se mantiene dinámico o ilustrado, nunca como captura.
11. **Cierre:** una imagen horizontal de toda la comunidad o de una celebración representativa.

Mínimo para comenzar sin repetir demasiado: 9 fotografías más los recursos actuales. Versión recomendada: 12 a 14 fotografías.

Peso recomendado: entre 250 KB y 1,2 MB por imagen optimizada. ImageKit generará variantes para cada pantalla. Evitar archivos con texto diminuto, marcos pegados al borde o el rostro principal demasiado cerca de una esquina.

## Paquete por evento

Carpeta sugerida: `eventos/{slug}`.

1. Una portada horizontal.
2. Un arte de invitación en cualquier orientación.
3. Entre dos y cinco fotos de apoyo: lugar, equipo, comunidad o actividad.
4. Una imagen cuadrada opcional para compartir.

## Paquete por iglesia

Carpeta sugerida: `iglesias/{slug}`.

1. Exterior o comunidad para la portada horizontal.
2. Retrato del pastor o del equipo.
3. Entre tres y seis imágenes de comunidad, reuniones y servicio.
4. Logo cuadrado opcional con fondo transparente.

El mapa no debe ser una captura: la página lo construirá con coordenadas, dirección y enlace de navegación.

## Datos que acompañan cada imagen

- Descripción breve de lo que muestra para el texto alternativo.
- Persona, lugar o detalle que no debe quedar fuera del recorte.
- Permiso de uso confirmado cuando aparezcan personas identificables, especialmente menores.
- Carpeta relacionada con la página, evento o iglesia; no usar una carpeta general para todo.

## Arquitectura aprobada

Existe un solo motor `Historia Maná`. Home, peregrinaciones, eventos e iglesias compartirán movimiento, accesibilidad, responsive y presets. Los datos y permisos siguen separados:

- El CMS administra páginas editoriales generales.
- Eventos derivan fecha, lugar, formulario, pago y contactos del módulo de Eventos; la historia solo aporta presentación.
- Iglesias derivan dirección, mapa, WhatsApp, correo, liderazgo y eventos locales del registro de cada iglesia; la historia solo aporta presentación.

No se concede acceso global al CMS a una iglesia. La edición local requerirá propiedad y alcance de iglesia comprobados en servidor antes de habilitarse.
