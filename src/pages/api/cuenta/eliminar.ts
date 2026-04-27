import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { logSecurityEvent } from '@lib/securityEvents';
import { buildClearSessionCookie } from '@lib/portalPasswordSession';

export const prerender = false;

const REQUIRED_CONFIRM_TEXT = 'ELIMINAR';
const BAN_DURATION = '876000h'; // 100 years

function normalizeEmail(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function sumNumeric(rows: Array<Record<string, any>>, key: string): number {
  return (rows || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await getUserFromRequest(request);
  if (!user?.id || !user?.email) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const confirmText = String(payload.confirmText || '').trim().toUpperCase();
  const reasonRaw = String(payload.reason || '').trim();
  const reason = sanitizePlainText(reasonRaw, 300);

  if (confirmText !== REQUIRED_CONFIRM_TEXT) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Escribe "${REQUIRED_CONFIRM_TEXT}" para confirmar`,
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (reasonRaw && (!reason || containsBlockedSequence(reasonRaw))) {
    return new Response(JSON.stringify({ ok: false, error: 'Motivo invalido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const normalizedEmail = normalizeEmail(user.email);
  const nowIso = new Date().toISOString();

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo validar el perfil' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const profileRole = String(profile?.role || '').toLowerCase();
  if (['superadmin', 'admin'].includes(profileRole)) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Las cuentas administrativas no se pueden eliminar desde autoservicio.',
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const scopedEmail = normalizeEmail(profile?.email) || normalizedEmail;

  const [bookingsRes, donationsRes, subscriptionsRes] = await Promise.all([
    supabaseAdmin
      .from('cumbre_bookings')
      .select('id, total_amount, total_paid, status')
      .ilike('contact_email', scopedEmail),
    supabaseAdmin
      .from('donations')
      .select('id, amount, status')
      .ilike('donor_email', scopedEmail),
    supabaseAdmin
      .from('donation_reminder_subscriptions')
      .select('id, status')
      .ilike('donor_email', scopedEmail),
  ]);

  const bookingRows = bookingsRes.data || [];
  const donationRows = donationsRes.data || [];
  const subscriptionRows = subscriptionsRes.data || [];

  const metrics = {
    bookings_count: bookingRows.length,
    bookings_total_amount: sumNumeric(bookingRows as any, 'total_amount'),
    bookings_total_paid: sumNumeric(bookingRows as any, 'total_paid'),
    donations_count: donationRows.length,
    donations_total_amount: sumNumeric(donationRows as any, 'amount'),
    subscriptions_total: subscriptionRows.length,
    subscriptions_active: subscriptionRows.filter((row: any) => String(row?.status || '').toUpperCase() === 'ACTIVE').length,
    subscriptions_paused: subscriptionRows.filter((row: any) => String(row?.status || '').toUpperCase() === 'PAUSED').length,
  };

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    ban_duration: BAN_DURATION,
    user_metadata: {
      ...(user.user_metadata || {}),
      account_deleted_at: nowIso,
      account_deleted_by: 'self_service',
      account_delete_reason: reason || null,
    },
  });

  if (banError) {
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo desactivar la cuenta' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const warnings: string[] = [];

  const profileUpdate = await supabaseAdmin
    .from('user_profiles')
    .update({
      role: 'user',
      full_name: null,
      phone: null,
      city: null,
      country: null,
      affiliation_type: null,
      church_name: null,
      church_id: null,
      document_type: null,
      document_number: null,
      updated_at: nowIso,
    })
    .eq('user_id', user.id);

  if (profileUpdate.error && profileUpdate.error.code !== 'PGRST116') {
    warnings.push('No se pudo limpiar el perfil');
  }

  const [optionalPortalChurchUpdate, optionalRegionUpdate, subscriptionsUpdate, membershipsUpdate, regionalAssignmentsUpdate] = await Promise.all([
    supabaseAdmin
      .from('user_profiles')
      .update({
        portal_church_id: null,
        updated_at: nowIso,
      } as any)
      .eq('user_id', user.id),
    supabaseAdmin
      .from('user_profiles')
      .update({
        region_id: null,
        updated_at: nowIso,
      } as any)
      .eq('user_id', user.id),
    supabaseAdmin
      .from('donation_reminder_subscriptions')
      .update({
        status: 'CANCELLED',
        updated_at: nowIso,
      })
      .ilike('donor_email', scopedEmail)
      .in('status', ['ACTIVE', 'PAUSED']),
    supabaseAdmin
      .from('church_memberships')
      .update({
        status: 'inactive',
        updated_at: nowIso,
      })
      .eq('user_id', user.id)
      .neq('status', 'inactive'),
    supabaseAdmin
      .from('region_leadership_assignments')
      .update({
        status: 'inactive',
        updated_at: nowIso,
      })
      .eq('user_id', user.id)
      .eq('status', 'active'),
  ]);

  if (
    optionalPortalChurchUpdate.error
    && !['PGRST116', '42703'].includes(optionalPortalChurchUpdate.error.code || '')
  ) {
    warnings.push('No se pudo limpiar church scope del perfil');
  }
  if (
    optionalRegionUpdate.error
    && !['PGRST116', '42703'].includes(optionalRegionUpdate.error.code || '')
  ) {
    warnings.push('No se pudo limpiar region scope del perfil');
  }
  if (subscriptionsUpdate.error && subscriptionsUpdate.error.code !== 'PGRST116') {
    warnings.push('No se pudieron cancelar algunas suscripciones');
  }
  if (membershipsUpdate.error && membershipsUpdate.error.code !== 'PGRST116') {
    warnings.push('No se pudieron desactivar algunas membresías');
  }
  if (
    regionalAssignmentsUpdate.error
    && !['PGRST116', '42P01', '42703'].includes(regionalAssignmentsUpdate.error.code || '')
  ) {
    warnings.push('No se pudieron desactivar asignaciones regionales');
  }

  await logSecurityEvent({
    type: 'maintenance',
    identifier: 'portal.account.deleted',
    detail: 'Cuenta eliminada por autoservicio',
    meta: {
      user_id: user.id,
      email: scopedEmail,
      reason: reason || null,
      deleted_at: nowIso,
      metrics,
      warnings,
    },
  });

  return new Response(JSON.stringify({
    ok: true,
    deleted_at: nowIso,
    warnings,
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildClearSessionCookie(),
    },
  });
};
