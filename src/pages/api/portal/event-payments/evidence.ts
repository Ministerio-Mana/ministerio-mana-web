import type { APIRoute } from 'astro';
import { canActorOperateEventPayments, getEventAccessContext } from '@lib/eventAccess';
import { downloadMicrosoftEventDocument } from '@lib/microsoftGraph';
import { enforceRateLimit } from '@lib/rateLimit';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
  });
}

function safeFilename(value: string, mimeType: string) {
  const extension = mimeType === 'application/pdf' ? 'pdf' : 'webp';
  const base = String(value || 'comprobante')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'comprobante';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'Supabase no configurado.' }, 500);
  const evidenceId = String(url.searchParams.get('evidence_id') || '').trim();
  if (!UUID_PATTERN.test(evidenceId)) return json({ ok: false, error: 'Comprobante inválido.' }, 400);

  const ctx = await getEventAccessContext(request);
  if (!ctx.ok) return json({ ok: false, error: ctx.error || 'No autorizado.' }, ctx.status);
  if (ctx.isPasswordSession || !ctx.userId) {
    return json({ ok: false, error: 'Esta función requiere una cuenta individual.' }, 403);
  }
  const allowed = await enforceRateLimit(`event-evidence-view:${ctx.userId}`, 60, 90, { failOpen: false });
  if (!allowed) return json({ ok: false, error: 'Demasiadas consultas. Intenta más tarde.' }, 429);

  const { data: evidence, error: evidenceError } = await supabaseAdmin
    .from('event_payment_evidence')
    .select('id,event_id,original_filename,mime_type,sharepoint_drive_id,sharepoint_item_id,deleted_at')
    .eq('id', evidenceId)
    .maybeSingle();
  if (evidenceError) return json({ ok: false, error: 'No se pudo consultar el comprobante.' }, 500);
  if (!evidence?.id || evidence.deleted_at || !evidence.sharepoint_drive_id || !evidence.sharepoint_item_id) {
    return json({ ok: false, error: 'Comprobante no disponible.' }, 404);
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id,scope,church_id,region_id,country')
    .eq('id', evidence.event_id)
    .maybeSingle();
  if (eventError || !event?.id) return json({ ok: false, error: 'Evento no encontrado.' }, 404);
  if (!(await canActorOperateEventPayments(ctx, event))) {
    return json({ ok: false, error: 'No tienes permiso para ver este comprobante.' }, 403);
  }

  try {
    const content = await downloadMicrosoftEventDocument({
      driveId: evidence.sharepoint_drive_id,
      itemId: evidence.sharepoint_item_id,
    });
    const mimeType = evidence.mime_type === 'application/pdf' ? 'application/pdf' : 'image/webp';
    const filename = safeFilename(evidence.original_filename, mimeType);
    const responseBody = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    return new Response(responseBody, {
      headers: {
        'content-type': mimeType,
        'content-disposition': `${mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${filename}"`,
        'cache-control': 'private, no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error('[event.payment-evidence] download failed', error);
    return json({ ok: false, error: 'Microsoft no pudo entregar el comprobante.' }, 502);
  }
};
