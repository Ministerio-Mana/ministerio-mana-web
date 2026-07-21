# Moderación asistida de peticiones — modo sombra

Esta fase agrega una recomendación interna para las peticiones que solicitan aparecer en el muro. No publica, rechaza ni cambia la privacidad de ninguna petición.

## Contrato de privacidad

- Las peticiones privadas nunca se envían a un proveedor de IA.
- Una petición pública solo se analiza si la persona marca el consentimiento explícito.
- Se envía únicamente `request_text`; no se envían nombre, ciudad, país, IP ni identificadores del portal.
- La llamada a Responses usa `store: false`.
- La base guarda consentimiento, estado, recomendación, códigos controlados, modelo y versión de política. No guarda el prompt ni la respuesta completa del proveedor.
- Si falta configuración, hay timeout, la respuesta es inválida o el proveedor falla, la recomendación es revisión humana.

## Orden seguro de activación

1. Desplegar el código con `PRAYER_AI_MODE=off`.
2. Ejecutar `docs/sql/prayer_wall_schema.sql` en el SQL Editor del proyecto correcto de Supabase.
3. Crear un proyecto de OpenAI exclusivo para Ministerio Maná y una llave exclusiva para este flujo. Configurar alertas o presupuesto operativo en ese proyecto.
4. Guardar la llave directamente en Vercel como `OPENAI_API_KEY`, solo para los entornos que correspondan. No pegarla en chats, tickets, documentos ni variables `PUBLIC_*`.
5. Configurar en Vercel:

   - `PRAYER_AI_MODE=shadow`
   - `PRAYER_AI_MODEL=gpt-5.6-sol`
   - `PRAYER_AI_TIMEOUT_MS=6000`
   - `PRAYER_AI_POLICY_VERSION=2026-07-20.v1`

6. Desplegar nuevamente y enviar peticiones ficticias públicas con y sin consentimiento. Confirmar en el portal que ambas siguen pendientes y que solo la autorizada muestra recomendación automática.
7. Confirmar que una petición privada queda con `ai_consent=false` y `ai_status=not_run`.

## Lectura en el portal

- **IA recomienda publicar:** el texto pasó los filtros, pero una persona todavía decide.
- **IA recomienda revisar:** muestra motivos controlados para ayudar a priorizar.
- **Análisis no disponible:** el sistema falló de forma segura y exige revisión humana.
- **Revisión humana:** no hubo consentimiento y el texto nunca se envió al proveedor.

## Evaluación antes de automatizar

Mantener modo sombra hasta comparar una muestra suficiente de recomendaciones contra decisiones humanas. Registrar falsos positivos, falsos negativos y casos pastorales sensibles. La publicación automática no está implementada en esta fase y no debe habilitarse solo cambiando una variable.

## Apagado inmediato

Cambiar `PRAYER_AI_MODE=off` en Vercel y redesplegar. Las peticiones continúan entrando y permanecen en revisión humana; no es necesario borrar datos ni revertir el esquema.
