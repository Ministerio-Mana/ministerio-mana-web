import type { APIRoute } from 'astro';
import { enforcePortalAdminGuard } from '@lib/portalAdminGuard';
import { enforceRateLimit } from '@lib/rateLimit';
import {
  getMicrosoftGraphConfigurationStatus,
  isMicrosoftEventsWriteEnabled,
  verifyMicrosoftSharePointConnection,
} from '@lib/microsoftGraph';

export const prerender = false;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  const auth = await enforcePortalAdminGuard({
    request,
    clientAddress,
    identifier: 'portal.integrations.microsoft.status',
  });
  if (!auth.ok) return json({ ok: false, error: auth.error || 'No autorizado' }, auth.status);
  if (auth.role !== 'superadmin' || auth.isPasswordSession || !auth.userId) {
    return json({ ok: false, error: 'Esta verificación requiere una cuenta superadmin individual.' }, 403);
  }

  const config = getMicrosoftGraphConfigurationStatus();
  const eventsWriteEnabled = isMicrosoftEventsWriteEnabled();
  const url = new URL(request.url);
  if (url.searchParams.get('verify') !== '1') {
    return json({ ok: true, provider: 'microsoft', ...config, events_write_enabled: eventsWriteEnabled });
  }
  if (!config.enabled || !config.configured) {
    return json({
      ok: true,
      provider: 'microsoft',
      ...config,
      connected: false,
      events_write_enabled: eventsWriteEnabled,
    });
  }

  const allowed = await enforceRateLimit(
    `microsoft-status:${auth.userId}`,
    60,
    10,
    { failOpen: false },
  );
  if (!allowed) return json({ ok: false, error: 'Demasiadas verificaciones. Intenta de nuevo más tarde.' }, 429);

  try {
    const connection = await verifyMicrosoftSharePointConnection();
    return json({
      ok: true,
      provider: 'microsoft',
      enabled: true,
      configured: true,
      connected: true,
      events_write_enabled: eventsWriteEnabled,
      site: connection.site,
      drives: connection.drives,
      selected_drive_id: connection.selectedDriveId,
    });
  } catch (error) {
    console.error('[portal.integrations.microsoft.status] verification failed', {
      userId: auth.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({
      ok: false,
      provider: 'microsoft',
      connected: false,
      events_write_enabled: eventsWriteEnabled,
      error: error instanceof Error ? error.message : 'No se pudo verificar Microsoft.',
    }, 502);
  }
};
