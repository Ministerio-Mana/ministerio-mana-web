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

## 2) Pago recibido
Archivo: `cumbre_payment_received.txt`

Variables sugeridas:
- {{1}} = nombre
- {{2}} = valor formateado
- {{3}} = booking id
