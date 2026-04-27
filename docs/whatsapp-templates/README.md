# Plantillas WhatsApp (Twilio)

Estas plantillas estan pensadas para aprobarse en Twilio WhatsApp Templates.
Los placeholders usan el formato `{{1}}`, `{{2}}`, etc.

## 1) Recordatorio de cuota
Archivo: `cumbre_installment_reminder.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = numero de cuota
- {{3}} = total de cuotas
- {{4}} = fecha de vencimiento (ej. 29 de enero de 2026)
- {{5}} = valor formateado (ej. $ 55.00 USD)
- {{6}} = link de pago

Env var sugerida:
- `WHATSAPP_CUMBRE_REMINDER_CONTENT_SID`

## 2) Pago recibido
Archivo: `cumbre_payment_received.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = valor formateado
- {{3}} = booking id

Env var sugerida (si se implementa):
- `WHATSAPP_CUMBRE_PAYMENT_RECEIVED_CONTENT_SID`

## 3) Registro incompleto
Archivo: `cumbre_registration_incomplete.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = campos faltantes (ej. Documento, Fecha de nacimiento)
- {{3}} = link de registro
- {{4}} = booking id

Env var sugerida:
- `WHATSAPP_CUMBRE_REG_INCOMPLETE_CONTENT_SID`

## 4) Pago en verificacion
Archivo: `cumbre_payment_pending.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = booking id

Env var sugerida:
- `WHATSAPP_CUMBRE_PAYMENT_PENDING_CONTENT_SID`

## 5) Pago con inconsistencia
Archivo: `cumbre_payment_issue.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = booking id

Env var sugerida:
- `WHATSAPP_CUMBRE_PAYMENT_ISSUE_CONTENT_SID`

## 6) Sin iglesia asignada
Archivo: `cumbre_no_church.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = booking id

Env var sugerida:
- `WHATSAPP_CUMBRE_NO_CHURCH_CONTENT_SID`
