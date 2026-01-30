# Plantillas de Correo para Supabase

Este directorio contiene las plantillas HTML diseñadas para los correos transaccionales de Supabase, siguiendo la identidad visual de "Ministerio Maná" (Navy, Teal, Gold, Beige).

## Instrucciones de Instalación

1.  Ve a tu **Supabase Dashboard**.
2.  Navega a **Authentication** > **Configuration** > **Email Templates**.
3.  Para cada tipo de correo, copia el contenido del archivo HTML correspondiente y pégalo en el editor de Supabase.

### Correos de Acción (Action Required)

| Tipo de Correo | Archivo | Asunto Sugerido |
| :--- | :--- | :--- |
| **Confirm Signup** | `confirmation.html` | Confirma tu registro en Ministerio Maná |
| **Invite User** | `invite.html` | Has sido invitado a Ministerio Maná |
| **Magic Link** | `magic_link.html` | Inicia sesión en Ministerio Maná |
| **Reset Password** | `reset_password.html` | Restablecer tu contraseña |
| **Change Email Address** | `email_change.html` | Confirma el cambio de correo |
| **Reauthentication** | `reauthentication.html` | Código de paso: {{ .Token }} |

### Correos de Notificación (Notification Only)

Estos correos se envían automáticamente cuando ocurren cambios en la cuenta. Asegúrate de activarlos en la configuración de Supabase.

| Evento | Archivo | Asunto Sugerido |
| :--- | :--- | :--- |
| **Password Changed** | `password_changed.html` | Tu contraseña ha sido actualizada |
| **Email Changed** | `email_changed_notice.html` | Tu correo ha sido actualizado |
| **Phone Changed** | `phone_changed.html` | Tu teléfono ha sido actualizado |
| **Identity Linked** | `identity_linked.html` | Nueva cuenta vinculada |
| **Identity Unlinked** | `identity_unlinked.html` | Cuenta desvinculada |
| **MFA Added** | `mfa_added.html` | Autenticación de dos pasos activada |
| **MFA Removed** | `mfa_removed.html` | Autenticación de dos pasos desactivada |

## Notas Importantes

*   **Logo**: Las plantillas asumen que tu logo está disponible en `{{ .SiteURL }}/logo.svg`. Asegúrate de que `Site URL` en Supabase (Authentication > URL Configuration) apunte a tu dominio principal (ej. `https://ministeriomana.com` o `http://localhost:4321` para pruebas).
*   **Variables**: Se utilizan las variables estándar de Go template que soporta Supabase (`{{ .ConfirmationURL }}`, `{{ .Token }}`, etc.).
*   **Compatibilidad**: El diseño utiliza HTML/CSS en línea y tablas/divs simples para asegurar compatibilidad con la mayoría de clientes de correo (Gmail, Outlook, Apple Mail).

## Si usas SendGrid (API propia)

El proyecto ahora puede enviar correos de autenticación vía **SendGrid API**. En ese caso:

- Los templates de Supabase quedan como **fallback** (o para uso manual).
- Puedes usar estos HTML como base en SendGrid.
- Variables sugeridas en SendGrid (dynamic templates):
  - `action_url`
  - `cta_label`
  - `subject`
  - `app_name`
  - `support_email`

### SendGrid · Auth (Portal Maná)

Plantillas recomendadas (dynamic templates):

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Invite | `sendgrid/auth_invite.html` | `SENDGRID_TEMPLATE_INVITE` |
| Magic Link | `sendgrid/auth_magiclink.html` | `SENDGRID_TEMPLATE_MAGICLINK` |
| Recovery | `sendgrid/auth_recovery.html` | `SENDGRID_TEMPLATE_RECOVERY` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `action_url`
- `cta_label`
- `support_email`

### SendGrid · Cumbre Mundial 2026

Plantillas recomendadas (dynamic templates):

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Booking recibido | `sendgrid/cumbre_booking_received.html` | `SENDGRID_TEMPLATE_CUMBRE_BOOKING` |
| Pago recibido | `sendgrid/cumbre_payment_received.html` | `SENDGRID_TEMPLATE_CUMBRE_PAYMENT_RECEIVED` |
| Depósito >= 50% | `sendgrid/cumbre_deposit_ok.html` | `SENDGRID_TEMPLATE_CUMBRE_DEPOSIT_OK` |
| Pago completo | `sendgrid/cumbre_paid.html` | `SENDGRID_TEMPLATE_CUMBRE_PAID` |
| Pago fallido | `sendgrid/cumbre_payment_failed.html` | `SENDGRID_TEMPLATE_CUMBRE_PAYMENT_FAILED` |
| Pago en verificación (PSE/Nequi) | `sendgrid/cumbre_payment_pending.html` | `SENDGRID_TEMPLATE_CUMBRE_PAYMENT_PENDING` |
| Recordatorio cuota | `sendgrid/cumbre_installment_reminder.html` | `SENDGRID_TEMPLATE_CUMBRE_INSTALLMENT_REMINDER` |
| Registro completo | `sendgrid/cumbre_registration_complete.html` | `SENDGRID_TEMPLATE_CUMBRE_REG_COMPLETE` |
| Registro incompleto | `sendgrid/cumbre_registration_incomplete.html` | `SENDGRID_TEMPLATE_CUMBRE_REG_INCOMPLETE` |
| Plan de cuotas creado | `sendgrid/cumbre_plan_created.html` | `SENDGRID_TEMPLATE_CUMBRE_PLAN_CREATED` |
| Cuota vencida | `sendgrid/cumbre_installment_overdue.html` | `SENDGRID_TEMPLATE_CUMBRE_INSTALLMENT_OVERDUE` |
| Pago final pendiente | `sendgrid/cumbre_final_payment_due.html` | `SENDGRID_TEMPLATE_CUMBRE_FINAL_DUE` |
| Link de pago listo | `sendgrid/cumbre_payment_link_generated.html` | `SENDGRID_TEMPLATE_CUMBRE_LINK_READY` |
| Link de pago expirado | `sendgrid/cumbre_payment_link_expired.html` | `SENDGRID_TEMPLATE_CUMBRE_LINK_EXPIRED` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `full_name`
- `booking_id`
- `amount` (formateado)
- `total_amount` (formateado)
- `total_paid` (formateado)
- `currency`
- `due_date` (formateado)
- `installment_index`
- `installment_count`
- `payment_link`
- `installments_count`
- `installment_frequency`
- `next_due_date`
- `missing_fields`
- `cta_url`
- `cta_label`
- `support_email`
- `support_whatsapp`

### SendGrid · Donaciones (general + diezmos + iglesias + misiones)

Plantillas recomendadas (dynamic templates):

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Donación general | `sendgrid/donation_thanks_general.html` | `SENDGRID_TEMPLATE_DONATION_THANKS` |
| Diezmos | `sendgrid/donation_thanks_tithe.html` | `SENDGRID_TEMPLATE_TITHE_THANKS` |
| Cumbre (donación) | `sendgrid/donation_thanks_cumbre.html` | `SENDGRID_TEMPLATE_CUMBRE_DONATION_THANKS` |
| Iglesia local | `sendgrid/donation_thanks_church.html` | `SENDGRID_TEMPLATE_CHURCH_DONATION_THANKS` |
| Misiones/Campus | `sendgrid/donation_thanks_mission.html` | `SENDGRID_TEMPLATE_MISSION_DONATION_THANKS` |
| Donación fallida | `sendgrid/donation_failed.html` | `SENDGRID_TEMPLATE_DONATION_FAILED` |
| Donación recurrente creada | `sendgrid/donation_recurring_created.html` | `SENDGRID_TEMPLATE_DONATION_RECURRING_CREATED` |
| Donación recurrente fallida | `sendgrid/donation_recurring_failed.html` | `SENDGRID_TEMPLATE_DONATION_RECURRING_FAILED` |
| Donación recurrente cancelada | `sendgrid/donation_recurring_canceled.html` | `SENDGRID_TEMPLATE_DONATION_RECURRING_CANCELED` |
| Recibo de donación | `sendgrid/donation_receipt.html` | `SENDGRID_TEMPLATE_DONATION_RECEIPT` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `full_name`
- `amount`
- `currency`
- `reference`
- `donation_type`
- `church_name`
- `church_city`
- `campus`
- `payment_link`
- `support_email`
- `support_whatsapp`
- `frequency`
- `next_charge_date`
- `manage_url`
- `update_payment_url`
- `receipt_url`

### SendGrid · Newsletter

Plantillas recomendadas:

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Confirmar suscripción | `sendgrid/newsletter_confirm.html` | `SENDGRID_TEMPLATE_NEWSLETTER_CONFIRM` |
| Bienvenida | `sendgrid/newsletter_welcome.html` | `SENDGRID_TEMPLATE_NEWSLETTER_WELCOME` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `confirm_url`
- `manage_url`
- `support_email`

### SendGrid · Comunicaciones Iglesias / Misiones

Plantillas recomendadas:

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Anuncio iglesia | `sendgrid/church_announcement.html` | `SENDGRID_TEMPLATE_CHURCH_ANNOUNCEMENT` |
| Actualización misiones | `sendgrid/mission_update.html` | `SENDGRID_TEMPLATE_MISSION_UPDATE` |
| Evento creado | `sendgrid/church_event_created.html` | `SENDGRID_TEMPLATE_CHURCH_EVENT_CREATED` |
| Evento recordatorio | `sendgrid/church_event_reminder.html` | `SENDGRID_TEMPLATE_CHURCH_EVENT_REMINDER` |
| Evento cancelado | `sendgrid/church_event_canceled.html` | `SENDGRID_TEMPLATE_CHURCH_EVENT_CANCELED` |

Variables dinámicas usadas:

- `subject`
- `church_name`
- `message_body`
- `event_date`
- `event_location`
- `cta_url`
- `cta_label`
- `campus`
- `event_title`
- `event_description`
- `event_date`
- `event_time`
- `calendar_url`

### SendGrid · Portal (Roles y Accesos)

Plantillas recomendadas:

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Solicitud recibida | `sendgrid/portal_role_request_received.html` | `SENDGRID_TEMPLATE_PORTAL_ROLE_REQUEST` |
| Solicitud aprobada | `sendgrid/portal_role_request_approved.html` | `SENDGRID_TEMPLATE_PORTAL_ROLE_APPROVED` |
| Solicitud rechazada | `sendgrid/portal_role_request_rejected.html` | `SENDGRID_TEMPLATE_PORTAL_ROLE_REJECTED` |
| Rol actualizado | `sendgrid/portal_role_changed.html` | `SENDGRID_TEMPLATE_PORTAL_ROLE_CHANGED` |
| Iglesia asignada | `sendgrid/portal_church_assigned.html` | `SENDGRID_TEMPLATE_PORTAL_CHURCH_ASSIGNED` |
| Invitación iglesia | `sendgrid/portal_church_invite.html` | `SENDGRID_TEMPLATE_PORTAL_CHURCH_INVITE` |
| Acceso revocado | `sendgrid/portal_access_revoked.html` | `SENDGRID_TEMPLATE_PORTAL_ACCESS_REVOKED` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `full_name`
- `role`
- `church_name`
- `church_city`
- `cta_url`
- `cta_label`
- `support_email`
- `support_whatsapp`

### SendGrid · Alertas internas (Admin)

Plantillas recomendadas:

| Tipo | Archivo | Env esperado |
| --- | --- | --- |
| Webhook falló | `sendgrid/admin_alert_webhook_failed.html` | `SENDGRID_TEMPLATE_ADMIN_WEBHOOK_FAILED` |
| Pago con problema | `sendgrid/admin_alert_payment_issue.html` | `SENDGRID_TEMPLATE_ADMIN_PAYMENT_ISSUE` |
| Error del sistema | `sendgrid/admin_alert_system_error.html` | `SENDGRID_TEMPLATE_ADMIN_SYSTEM_ERROR` |

Variables dinámicas usadas:

- `subject`
- `app_name`
- `alert_message`
- `reference`
- `amount`
- `source`
- `occurred_at`
- `context`
- `action_url`
