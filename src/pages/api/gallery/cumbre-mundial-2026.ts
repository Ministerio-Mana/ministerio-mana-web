import type { APIRoute } from 'astro';
import {
  CUMBRE_GALLERY_ALBUMS,
  cumbreGalleryFolder,
  isCumbreGalleryAlbum,
} from '@lib/cumbreGallery';
import { optimizedPublicImageUrl, responsivePublicImageSrcset } from '@lib/publicMedia';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function response(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
        : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  if (!supabaseAdmin) return response({ ok: false, error: 'Galería no disponible.' }, 503);

  const album = String(url.searchParams.get('album') || CUMBRE_GALLERY_ALBUMS[0].slug).trim();
  if (!isCumbreGalleryAlbum(album)) return response({ ok: false, error: 'Álbum no válido.' }, 400);

  const requestedLimit = Number(url.searchParams.get('limit') || 30);
  const requestedOffset = Number(url.searchParams.get('offset') || 0);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(60, Math.floor(requestedLimit))) : 30;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(5000, Math.floor(requestedOffset))) : 0;

  const result = await supabaseAdmin
    .from('cms_media')
    .select('id,original_name,public_url,width,height,path,created_at', { count: 'exact' })
    .eq('provider', 'imagekit')
    .eq('folder', cumbreGalleryFolder(album))
    .order('path', { ascending: true })
    .range(offset, offset + limit - 1);

  if (result.error) {
    console.error('[public-gallery] Cumbre query failed', result.error);
    return response({ ok: false, error: 'No se pudo cargar la galería.' }, 500);
  }

  const images = (result.data || []).map((item) => ({
    id: item.id,
    name: item.original_name || 'Cumbre Mundial Maná 2026',
    width: Number(item.width || 0) || null,
    height: Number(item.height || 0) || null,
    thumbnail_url: optimizedPublicImageUrl(item.public_url, 720, 78),
    display_url: optimizedPublicImageUrl(item.public_url, 1920, 84),
    srcset: responsivePublicImageSrcset(item.public_url, [320, 480, 720, 960, 1280], 78),
  }));
  const total = Number(result.count || 0);

  return response({
    ok: true,
    album,
    images,
    pagination: {
      offset,
      limit,
      total,
      has_more: offset + images.length < total,
      next_offset: offset + images.length,
    },
  });
};
