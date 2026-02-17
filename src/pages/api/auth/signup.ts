import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { sendAuthLink } from '@lib/authMailer';
import { checkLeakedPassword, formatPasswordErrors, validatePasswordStrength } from '@lib/passwordSecurity';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';

function env(key: string): string | undefined {
    return import.meta.env?.[key] ?? process.env?.[key];
}

function isProduction(): boolean {
    const runtimeEnv = env('VERCEL_ENV') ?? env('NODE_ENV') ?? 'development';
    return runtimeEnv === 'production';
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Server configuration error' }), { status: 500 });
    }

    try {
        const body = await request.json();
        const { email, password, firstName, lastName, turnstileToken } = body;
        const userAgent = request.headers.get('user-agent') || '';

        if (!email || !password || !firstName || !lastName) {
            return new Response(JSON.stringify({ ok: false, error: 'Faltan campos requeridos' }), { status: 400 });
        }

        const rateKey = `auth.signup:${clientAddress ?? 'unknown'}`;
        const rateAllowed = await enforceRateLimit(rateKey);
        if (!rateAllowed) {
            void logSecurityEvent({
                type: 'rate_limited',
                identifier: rateKey,
                ip: clientAddress,
                userAgent,
                detail: 'Auth signup',
            });
            return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), { status: 429 });
        }

        const hasSecret = Boolean(env('TURNSTILE_SECRET_KEY'));
        if (isProduction() && hasSecret) {
            const token = String(turnstileToken || body?.['cf-turnstile-response'] || '');
            if (!token) {
                return new Response(JSON.stringify({ ok: false, error: 'Captcha requerido' }), { status: 400 });
            }
            const okCaptcha = await verifyTurnstile(token, clientAddress);
            if (!okCaptcha) {
                void logSecurityEvent({
                    type: 'captcha_failed',
                    identifier: 'auth.signup',
                    ip: clientAddress,
                    userAgent,
                    detail: 'Turnstile invalido',
                });
                return new Response(JSON.stringify({ ok: false, error: 'Captcha invalido' }), { status: 400 });
            }
        }

        const strength = validatePasswordStrength(password);
        if (!strength.ok) {
            return new Response(JSON.stringify({ ok: false, error: formatPasswordErrors(strength.errors) }), { status: 400 });
        }

        const leaked = await checkLeakedPassword(password);
        if (leaked.leaked) {
            return new Response(JSON.stringify({ ok: false, error: 'Esta contraseña aparece en filtraciones conocidas. Elige otra.' }), { status: 400 });
        }
        if (!leaked.checked && leaked.error) {
            console.warn('[signup] HIBP check failed:', leaked.error);
        }

        // Check if user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const userExists = existingUsers?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase());

        if (userExists) {
            const redirectTo = `${new URL(request.url).origin}/portal/activar?next=${encodeURIComponent('/portal')}`;
            const linkResult = await sendAuthLink({
                kind: 'recovery',
                email,
                redirectTo,
            });
            if (!linkResult.ok) {
                return new Response(JSON.stringify({ ok: false, error: 'Este correo ya está registrado' }), { status: 400 });
            }
            return new Response(JSON.stringify({
                ok: true,
                alreadyExists: true,
                message: 'El correo ya existe. Te enviamos un nuevo enlace para activar o recuperar acceso.',
            }), { status: 200 });
        }

        // Create user with auto-confirmed email
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                first_name: firstName,
                last_name: lastName,
                full_name: `${firstName} ${lastName}`.trim()
            }
        });

        if (authError || !authData.user) {
            console.error('Signup error:', authError);
            return new Response(JSON.stringify({ ok: false, error: authError?.message || 'Error al crear cuenta' }), { status: 400 });
        }

        // Create profile
        const { error: profileError } = await supabaseAdmin
            .from('user_profiles')
            .upsert({
                user_id: authData.user.id,
                email: email,
                first_name: firstName,
                last_name: lastName,
                role: 'user',
                updated_at: new Date().toISOString()
            });

        if (profileError) {
            console.error('Profile creation error:', profileError);
        }

        // Send welcome email via SendGrid
        // Since user is already created, we use 'magiclink' instead of 'invite'
        try {
            const emailResult = await sendAuthLink({
                kind: 'magiclink',
                email: email,
                redirectTo: `${new URL(request.url).origin}/portal`
            });

            if (!emailResult.ok) {
                console.warn('[signup] Email not sent:', emailResult.error);
            }
        } catch (emailErr) {
            console.error('[signup] Email error:', emailErr);
            // Don't fail registration if email fails
        }

        return new Response(JSON.stringify({
            ok: true,
            userId: authData.user.id,
            message: 'Cuenta creada. Revisa tu correo para activar tu cuenta.'
        }), { status: 200 });

    } catch (err: any) {
        console.error('Signup error:', err);
        return new Response(JSON.stringify({ ok: false, error: err.message || 'Error al registrarse' }), { status: 500 });
    }
};
