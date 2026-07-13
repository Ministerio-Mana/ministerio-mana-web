import type { APIRoute } from 'astro';
import { downloadMicrosoftEventDocument } from '@lib/microsoftGraph';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ url }) => {
  if (!supabaseAdmin) return new Response(null, { status: 404 });
  const eventId = String(url.searchParams.get('event_id') || '').trim();
  if (!UUID_PATTERN.test(eventId)) return new Response(null, { status: 404 });

  const { data: event, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id,status,visibility')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError || !event || String(event.status).toUpperCase() !== 'PUBLISHED' || String(event.visibility || 'UNLISTED').toUpperCase() === 'PRIVATE') {
    return new Response(null, { status: 404 });
  }
  const { data: image, error: imageError } = await supabaseAdmin
    .from('event_invitation_images')
    .select('sharepoint_drive_id,sharepoint_item_id,mime_type,size_bytes')
    .eq('event_id', eventId)
    .maybeSingle();
  if (imageError || !image?.sharepoint_drive_id || !image?.sharepoint_item_id || image.mime_type !== 'image/webp') {
    return new Response(null, { status: 404 });
  }

  try {
    const content = await downloadMicrosoftEventDocument({
      driveId: String(image.sharepoint_drive_id),
      itemId: String(image.sharepoint_item_id),
    });
    if (!content.byteLength || content.byteLength > 768_000) return new Response(null, { status: 404 });
    return new Response(content, {
      headers: {
        'content-type': 'image/webp',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[event-invitation-image] public read failed', error);
    return new Response(null, { status: 404 });
  }
};
