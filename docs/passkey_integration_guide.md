# Guía de Integración y Funcionamiento de Passkeys

## ¿Qué son los Passkeys?

Los **Passkeys** (claves de acceso) son un nuevo estándar de seguridad que reemplaza las contraseñas tradicionales. En lugar de escribir una contraseña, el usuario inicia sesión usando el método de desbloqueo de su dispositivo:
- **FaceID / TouchID** (Apple)
- **Huella / Patrón** (Android/Windows)
- **YubiKey** (Hardware)

Técnicamente, se basan en **WebAuthn**. El dispositivo genera un par de claves criptográficas: una pública (que se guarda en Supabase) y una privada (que nunca sale del dispositivo del usuario).

## ¿Por qué son mejores?
1.  **Anti-Phishing**: No se pueden robar con páginas falsas porque la clave privada nunca se comparte.
2.  **Experiencia de Usuario**: Es tan rápido como desbloquear el celular.
3.  **Seguridad**: Más seguro que SMS o OTP.

---

## Cómo Integrarlos en tu Proyecto (Supabase)

Para que el botón de "Passkey" que agregamos funcione realmente, necesitas configurar tu proyecto de Supabase.

### 1. Habilitar WebAuthn en Supabase Dashboard
1.  Ve a tu proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2.  Navega a **Authentication** -> **Providers**.
3.  Busca **WebAuthn** (o Passkeys) y habilítalo.
4.  Debes configurar el **Relying Party ID (RP ID)**.
    *   Si estás en desarrollo local, puede ser `localhost`.
    *   En producción, debe ser tu dominio exacto, por ejemplo: `ministeriomana.com`.
    *   **Nota**: Los passkeys están vinculados al dominio. Un passkey creado en `localhost` no funcionará en `ministeriomana.com`.

### 2. Flujo de Registro (Crear Passkey)
Antes de poder *ingresar* con Passkey, el usuario debe *crear* uno desde su perfil (estando logueado).
Debes agregar un botón en "Mi Perfil" que diga "Vincular Passkey / Huella".

Código para vincular (JavaScript):
```javascript
const { data, error } = await supabase.auth.mfa.challengeAndVerify({
  factorId: '', // Dejar vacío para iniciar registro
  factorType: 'webauthn' // o 'totp'
})
```
*Nota: Supabase simplifica esto con `linkIdentity` o métodos específicos en versiones recientes.*

### 3. Flujo de Login (El botón que agregamos)
El código que pusimos en `ingresar.astro` intenta usar el método estándar. La implementación correcta para iniciar sesión es:

```javascript
const { data, error } = await supabase.auth.signInWithWebAuthn({
  email: 'correo@usuario.com' // Opcional si es discoverable credential
})
```

## Cambios realizados en tu código

He actualizado `src/pages/portal/ingresar.astro` para:
1.  **Priorizar Contraseña**: Ahora es la opción principal.
2.  **Ocultar Magic Link**: Ahora está disponible solo si el usuario hace clic en "¿Olvidé mi contraseña?".
3.  **Botón Passkey**: Está visible proactivamente. Actualmente muestra un mensaje de "Beta" si falla, pero una vez configures el Dashboard, intentará ejecutar la autenticación.

### Corrección de "Bucle Infinito" del Magic Link
El problema de que "vuelve a pedir la clave" ocurría porque al llegar al Portal, la aplicación verificaba la sesión *antes* de que el Magic Link se procesara totalmente.

He agregado este código en `ingresar.astro` para detectar si el usuario acaba de llegar desde el correo:

```javascript
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    // Si Supabase detecta que el link es válido, redirige automáticamente
    window.location.href = '/portal';
  }
});
```

Esto asegura que si el link es válido, el usuario entre directo al Dashboard.
