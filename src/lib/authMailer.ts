import { supabaseAdmin } from './supabaseAdmin';
import { isSendgridEnabled, sendSendgridEmail } from './sendgrid';
import { logSecurityEvent } from './securityEvents';

export type AuthEmailKind = 'invite' | 'magiclink' | 'recovery';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

const APP_NAME = env('AUTH_EMAIL_APP_NAME') || 'Ministerio Maná';
const SUPPORT_EMAIL = env('AUTH_EMAIL_SUPPORT') || 'soporte@ministeriomana.org';

const TEMPLATE_IDS: Record<AuthEmailKind, string | undefined> = {
  invite: env('SENDGRID_TEMPLATE_INVITE'),
  magiclink: env('SENDGRID_TEMPLATE_MAGICLINK'),
  recovery: env('SENDGRID_TEMPLATE_RECOVERY'),
};

const SUBJECTS: Record<AuthEmailKind, string> = {
  invite: 'Activa tu cuenta en Portal Maná',
  magiclink: 'Tu acceso al Portal Maná',
  recovery: 'Restablece tu contraseña',
};

const CTA_LABELS: Record<AuthEmailKind, string> = {
  invite: 'Activar cuenta',
  magiclink: 'Ingresar al portal',
  recovery: 'Cambiar contraseña',
};

function maskEmail(email: string): string {
  const value = String(email || '').trim().toLowerCase();
  const [local, domain] = value.split('@');
  if (!domain) return value.slice(0, 3) + '***';
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function getPublicBaseUrl(): string | null {
  const raw =
    env('PUBLIC_SITE_URL') ||
    env('SITE_URL') ||
    env('VERCEL_PROJECT_PRODUCTION_URL') ||
    env('VERCEL_URL');
  if (!raw) return null;
  const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function normalizeTrustedRedirectTo(rawRedirectTo?: string | null): string | undefined {
  const raw = String(rawRedirectTo || '').trim();
  if (!raw) return undefined;

  const trustedBase = new URL(getPublicBaseUrl() || 'https://ministeriomana.org');
  try {
    const requested = new URL(raw, trustedBase);
    if (requested.protocol !== 'http:' && requested.protocol !== 'https:') {
      return trustedBase.toString();
    }
    return new URL(`${requested.pathname}${requested.search}${requested.hash}`, trustedBase).toString();
  } catch {
    return trustedBase.toString();
  }
}

function normalizeVerificationType(type?: string | null): string {
  if (type === 'email_change_current' || type === 'email_change_new') {
    return 'email_change';
  }
  return String(type || '');
}

function parseActionLink(actionLink?: string | null): { tokenHash?: string; verificationType?: string } {
  if (!actionLink) return {};
  try {
    const url = new URL(actionLink);
    const tokenHash = url.searchParams.get('token') || url.searchParams.get('token_hash') || '';
    const verificationType =
      url.searchParams.get('type') || url.searchParams.get('verification_type') || '';
    return {
      tokenHash: tokenHash || undefined,
      verificationType: verificationType || undefined,
    };
  } catch {
    return {};
  }
}

function buildPortalActivationUrl(params: {
  redirectTo?: string;
  email: string;
  verificationType?: string | null;
  hashedToken?: string | null;
  fallbackActionLink?: string | null;
}): string {
  const { redirectTo, email, verificationType, hashedToken, fallbackActionLink } = params;

  const base = getPublicBaseUrl() || 'https://ministeriomana.org';
  const trustedBase = new URL(base);
  const activationUrl = new URL('/portal/activar', trustedBase);

  try {
    const requestedUrl = new URL(redirectTo || '/portal/activar', trustedBase);
    if (requestedUrl.pathname.startsWith('/portal/activar')) {
      activationUrl.pathname = requestedUrl.pathname;
      requestedUrl.searchParams.forEach((value, key) => {
        activationUrl.searchParams.set(key, value);
      });
    }
  } catch {
    // Ignore invalid redirectTo and keep trusted default.
  }

  const parsed = parseActionLink(fallbackActionLink);
  const resolvedTokenHash = hashedToken || parsed.tokenHash || null;
  const resolvedVerificationType = normalizeVerificationType(verificationType || parsed.verificationType || null);

  if (resolvedTokenHash) {
    activationUrl.searchParams.set('token_hash', resolvedTokenHash);
  }
  if (resolvedVerificationType) {
    activationUrl.searchParams.set('type', resolvedVerificationType);
  }
  activationUrl.searchParams.set('email', email);

  // Ultimo fallback: si no pudimos construir un link util para /portal/activar,
  // devolvemos action_link original para no romper el envio.
  if (!resolvedTokenHash && !resolvedVerificationType && fallbackActionLink) {
    return fallbackActionLink;
  }
  return activationUrl.toString();
}

function buildAuthHtml(kind: AuthEmailKind, actionUrl: string): string {
  const title = SUBJECTS[kind];
  const cta = CTA_LABELS[kind];
  return `
  <div style="font-family: Arial, sans-serif; background:#f1f5f9; padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;box-shadow:0 20px 45px rgba(15,23,42,0.1)">
      <h2 style="margin:0 0 6px;color:#1e293b;">${APP_NAME}</h2>
      <h3 style="margin:0 0 16px;color:#0f172a;">${title}</h3>
      <p style="margin:0 0 18px;color:#475569;">Haz clic en el botón para continuar.</p>
      <p style="margin:0 0 20px;">
        <a href="${actionUrl}" style="display:inline-block;background:#22b8cf;color:#0f172a;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;">${cta}</a>
      </p>
      <p style="margin:0 0 12px;color:#64748b;font-size:12px;">Si no solicitaste este correo, puedes ignorarlo.</p>
      <p style="margin:0;color:#64748b;font-size:12px;">¿Necesitas ayuda? Escríbenos a ${SUPPORT_EMAIL}.</p>
    </div>
  </div>
  `;
}

export async function sendAuthEmail(params: {
  kind: AuthEmailKind;
  email: string;
  actionUrl: string;
}): Promise<boolean> {
  if (!isSendgridEnabled()) return false;
  const templateId = TEMPLATE_IDS[params.kind];
  const subject = SUBJECTS[params.kind];

  return sendSendgridEmail({
    to: params.email,
    subject,
    html: templateId ? undefined : buildAuthHtml(params.kind, params.actionUrl),
    templateId,
    dynamicTemplateData: templateId
      ? {
        app_name: APP_NAME,
        action_url: params.actionUrl,
        subject,
        cta_label: CTA_LABELS[params.kind],
        support_email: SUPPORT_EMAIL,
      }
      : undefined,
  });
}

export async function sendAuthLink(params: {
  kind: AuthEmailKind;
  email: string;
  redirectTo?: string;
}): Promise<{ ok: boolean; method: 'sendgrid' | 'supabase'; userId?: string | null; error?: string }> {
  if (!supabaseAdmin) {
    return { ok: false, method: 'supabase', error: 'Supabase no configurado' };
  }

  const redirectTo = normalizeTrustedRedirectTo(params.redirectTo);

  if (!isSendgridEnabled()) {
    try {
      if (params.kind === 'invite') {
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(params.email, { redirectTo });
        if (error) throw error;
        void logSecurityEvent({
          type: 'maintenance',
          identifier: 'auth.send-link.supabase',
          detail: 'Auth link enviado via Supabase (inviteUserByEmail)',
          meta: {
            kind: params.kind,
            email: maskEmail(params.email),
            has_redirect_to: Boolean(redirectTo),
          },
        });
        return { ok: true, method: 'supabase', userId: data?.user?.id ?? null };
      }
      if (params.kind === 'recovery') {
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(params.email, { redirectTo });
        if (error) throw error;
        void logSecurityEvent({
          type: 'maintenance',
          identifier: 'auth.send-link.supabase',
          detail: 'Auth link enviado via Supabase (resetPasswordForEmail)',
          meta: {
            kind: params.kind,
            email: maskEmail(params.email),
            has_redirect_to: Boolean(redirectTo),
          },
        });
        return { ok: true, method: 'supabase' };
      }
      const { error } = await supabaseAdmin.auth.signInWithOtp({
        email: params.email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      void logSecurityEvent({
        type: 'maintenance',
        identifier: 'auth.send-link.supabase',
        detail: 'Auth link enviado via Supabase (signInWithOtp)',
        meta: {
          kind: params.kind,
          email: maskEmail(params.email),
          has_redirect_to: Boolean(redirectTo),
        },
      });
      return { ok: true, method: 'supabase' };
    } catch (err: any) {
      void logSecurityEvent({
        type: 'maintenance',
        identifier: 'auth.send-link.supabase.error',
        detail: 'Fallo envio auth link via Supabase',
        meta: {
          kind: params.kind,
          email: maskEmail(params.email),
          error: err?.message || 'unknown',
        },
      });
      return { ok: false, method: 'supabase', error: err?.message || 'No se pudo enviar' };
    }
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: params.kind,
    email: params.email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (error || !data?.properties?.action_link) {
    // Diagnóstico adicional: Verificar si el usuario existe
    let userExists = false;
    let userCheckError = null;
    try {
      // Intento de listar usuarios filtrando por email (si es supported) o buscar
      // Nota: listUsers no siempre soporta filtro por email directo en todas las versiones
      // pero podemos listar y buscar. O usar getUserById si tuvieramos ID.
      // La forma más segura de saber si existe sin ID es intentar un getUser (que no hay por email admin)
      // o listUsers.
      // Usaremos createUser con email dummy para ver si dice "ya existe"? No, side effects.
      // Mejor asumimos que si no hay link y no hay error, es probable que no exista.

      // Vamos a intentar obtener el usuario para confirmar
      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
      if (!listErr && listData?.users) {
        userExists = listData.users.some(u => u.email?.toLowerCase() === params.email.toLowerCase());
      } else {
        userCheckError = listErr;
      }
    } catch (e) {
      userCheckError = e;
    }

    const errorMsg = error?.message
      ? error.message
      : (userExists ? 'No se generó link (link property missing)' : 'Usuario no registrado');

    console.error('[auth.generateLink] failed', {
      kind: params.kind,
      email: params.email,
      redirectTo,
      error: error || 'Undefined error from Supabase',
      hasProperties: Boolean(data?.properties),
      hasActionLink: Boolean(data?.properties?.action_link),
      userExists,
      userCheckError,
      data: JSON.stringify(data)
    });

    return { ok: false, method: 'sendgrid', error: errorMsg };
  }

  const actionUrl = buildPortalActivationUrl({
    redirectTo,
    email: params.email,
    verificationType: data?.properties?.verification_type,
    hashedToken: data?.properties?.hashed_token,
    fallbackActionLink: data?.properties?.action_link,
  });
  let actionPath = '';
  try {
    actionPath = new URL(actionUrl).pathname;
  } catch {
    actionPath = '';
  }
  void logSecurityEvent({
    type: 'maintenance',
    identifier: 'auth.send-link.generated',
    detail: 'Auth link generado via generateLink',
    meta: {
      kind: params.kind,
      email: maskEmail(params.email),
      verification_type: normalizeVerificationType(data?.properties?.verification_type || ''),
      has_hashed_token: Boolean(data?.properties?.hashed_token),
      has_action_link: Boolean(data?.properties?.action_link),
      action_path: actionPath || null,
    },
  });

  const sent = await sendAuthEmail({
    kind: params.kind,
    email: params.email,
    actionUrl,
  });

  if (!sent) {
    void logSecurityEvent({
      type: 'maintenance',
      identifier: 'auth.send-link.sendgrid.error',
      detail: 'Fallo envio auth email via SendGrid',
      meta: {
        kind: params.kind,
        email: maskEmail(params.email),
      },
    });
    return { ok: false, method: 'sendgrid', error: 'No se pudo enviar el correo' };
  }

  void logSecurityEvent({
    type: 'maintenance',
    identifier: 'auth.send-link.sent',
    detail: 'Auth email enviado via SendGrid',
    meta: {
      kind: params.kind,
      email: maskEmail(params.email),
      action_path: actionPath || null,
    },
  });

  return { ok: true, method: 'sendgrid', userId: data.user?.id ?? null };
}
