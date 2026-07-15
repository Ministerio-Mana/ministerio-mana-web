# Traducción automática de contenido público

Fecha de decisión: 14 de julio de 2026.

## Decisión

El contenido no se traducirá manualmente campo por campo. El español será la fuente original y Azure Translator generará borradores en inglés. Antes de publicar, una persona podrá revisar y ajustar la traducción pastoral.

La traducción automática no reemplaza la revisión humana en nombres propios, direcciones, horarios, enlaces, instrucciones de pago, textos bíblicos ni mensajes pastorales sensibles.

## Flujo propuesto

1. El editor escribe y guarda el contenido original en español.
2. La aplicación calcula una versión del texto y solicita la traducción únicamente si el original cambió.
3. Azure Translator genera el borrador en inglés.
4. El editor ve el original y la traducción lado a lado, con estados `Pendiente`, `Traducido automáticamente`, `Revisado` y `Desactualizado`.
5. La publicación usa la traducción revisada; si falta, muestra español y nunca una página vacía.

## Contenido traducible

- Nombre público, bienvenida, descripción, horarios y escenas de páginas de iglesias.
- Título, descripción, textos informativos, preguntas adicionales y mensajes de contacto de eventos.
- Bloques editoriales del CMS y páginas públicas autorizadas.

## Contenido que no se envía al traductor

- Nombres de personas, correos, teléfonos, direcciones y coordenadas.
- Identificadores, enlaces, claves, tokens, referencias de pago y comprobantes.
- Respuestas de inscripciones, peticiones de oración y notas internas.
- Números de cuenta, QR e instrucciones financieras sin revisión humana explícita.

## Seguridad y privacidad

- La llave del traductor vive solo en variables de servidor de Vercel.
- El navegador nunca recibe la llave ni llama directamente al proveedor.
- Cada solicitud se limita a los campos públicos seleccionados.
- Se registra versión, idioma, estado y fecha, pero no el secreto ni el cuerpo completo en logs.
- El español siempre se conserva como fuente recuperable.

## Activación pendiente

- Crear un recurso Azure Translator dentro de la suscripción Microsoft aprobada.
- Definir región y presupuesto; comenzar con un límite bajo y alertas de consumo.
- Configurar `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` y `AZURE_TRANSLATOR_ENDPOINT` directamente en Vercel.
- Crear el almacenamiento de traducciones por recurso e idioma, con versión del texto original y auditoría.
- Construir la revisión lado a lado en los editores de iglesias, eventos y contenido.
- Probar nombres propios, direcciones, textos pastorales, responsive y fallback a español antes de habilitar publicación automática.

## Referencias oficiales

- [Azure Translator: traducción de texto](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/overview)
- [Referencia REST v3](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)
- [Privacidad y seguridad de datos](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/translator/data-privacy-security)
