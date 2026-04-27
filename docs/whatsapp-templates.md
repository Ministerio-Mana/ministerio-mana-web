# WhatsApp templates (Twilio)

Este documento define plantillas Utility para recordatorios de diezmo.
WhatsApp exige plantillas aprobadas para mensajes fuera de la ventana de 24h.

## Variables
- Usa variables secuenciales: {{1}}, {{2}}, {{3}}...
- No pongas variables pegadas entre si.
- Los valores de variables no deben tener saltos de linea.

## Plantillas sugeridas (Utility)

### 1) mana_tithe_reminder_es
**Body:**
🙏 Hola {{1}}, gracias por apoyar la mision del Ministerio Mana. Este mensaje fue programado por ti para recordarte tu diezmo mensual de {{2}}.
📅 Vigencia: {{3}} a {{4}}.
🔗 Dona aqui: {{5}}.
✅ Si ya pagaste, ignora este mensaje.
❗ Responde ALTO para dejar de recibir recordatorios.

**Variables:**
1 = Nombre (ej: "Santiago")
2 = Monto (ej: "$ 50.000 COP")
3 = Fecha inicio (ej: "1 de febrero")
4 = Fecha fin (ej: "30 de abril")
5 = Link de pago (ej: "https://ministeriomana.org/primicias")

**Env var en Vercel:**
WHATSAPP_TITHE_REMINDER_CONTENT_SID = <Content SID>

---

### 2) mana_tithe_optin_es
**Body:**
🙏 Hola {{1}}, gracias por apoyar la mision del Ministerio Mana.
Activaste recordatorios de diezmo por {{2}} desde {{3}} hasta {{4}}.
Te enviaremos el enlace cuando corresponda.
❗ Responde ALTO para cancelar.

**Variables:**
1 = Nombre
2 = Monto
3 = Fecha inicio
4 = Fecha fin

---

### 3) mana_tithe_payment_received_es
**Body:**
✅ Gracias por apoyar la mision del Ministerio Mana.
Recibimos tu diezmo de {{1}}.
Si tienes dudas, responde a este mensaje.

**Variables:**
1 = Monto

## Crear plantilla via Content API (ejemplo)
Reemplaza el body y variables por cada plantilla.

```bash
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  https://content.twilio.com/v1/Content \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "mana_tithe_reminder_es",
    "language": "es",
    "variables": {
      "1": "Santiago",
      "2": "$ 50.000 COP",
      "3": "1 de febrero",
      "4": "30 de abril",
      "5": "https://ministeriomana.org/primicias"
    },
    "types": {
      "twilio/text": {
        "body": "🙏 Hola {{1}}, gracias por apoyar la mision del Ministerio Mana. Este mensaje fue programado por ti para recordarte tu diezmo mensual de {{2}}. 📅 Vigencia: {{3}} a {{4}}. 🔗 Dona aqui: {{5}}. ✅ Si ya pagaste, ignora este mensaje. ❗ Responde ALTO para dejar de recibir recordatorios."
      }
    }
  }'
```

Cuando la plantilla quede aprobada, Twilio te devuelve un Content SID (ej: HXxxxxxxxx).
Ese SID se usa para enviar con ContentSid + ContentVariables.
