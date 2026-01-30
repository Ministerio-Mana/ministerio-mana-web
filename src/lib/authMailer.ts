import { supabaseAdmin } from './supabaseAdmin';
import { isSendgridEnabled, sendSendgridEmail } from './sendgrid';

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

  const redirectTo = params.redirectTo;

  if (!isSendgridEnabled()) {
    try {
      if (params.kind === 'invite') {
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(params.email, { redirectTo });
        if (error) throw error;
        return { ok: true, method: 'supabase', userId: data?.user?.id ?? null };
      }
      if (params.kind === 'recovery') {
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(params.email, { redirectTo });
        if (error) throw error;
        return { ok: true, method: 'supabase' };
      }
      const { error } = await supabaseAdmin.auth.signInWithOtp({
        email: params.email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      return { ok: true, method: 'supabase' };
    } catch (err: any) {
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

  const sent = await sendAuthEmail({
    kind: params.kind,
    email: params.email,
    actionUrl: data.properties.action_link,
  });

  if (!sent) {
    return { ok: false, method: 'sendgrid', error: 'No se pudo enviar el correo' };
  }

  return { ok: true, method: 'sendgrid', userId: data.user?.id ?? null };
}
