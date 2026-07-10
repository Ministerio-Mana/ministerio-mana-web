function imageKitUrlEndpoint(): string {
  return String(
    import.meta.env?.IMAGEKIT_URL_ENDPOINT
    || process.env.IMAGEKIT_URL_ENDPOINT
    || '',
  ).trim().replace(/\/+$/, '');
}

function isImageKitUrl(candidate: string): boolean {
  const endpoint = imageKitUrlEndpoint();
  if (!endpoint || !candidate) return false;
  try {
    const base = new URL(endpoint);
    const image = new URL(candidate);
    const basePath = base.pathname.replace(/\/+$/, '');
    return image.protocol === 'https:'
      && image.origin === base.origin
      && (image.pathname === basePath || image.pathname.startsWith(`${basePath}/`));
  } catch {
    return false;
  }
}

export function optimizedPublicImageUrl(source: string, width: number, quality = 80): string {
  if (!isImageKitUrl(source)) return source;
  const safeWidth = Math.max(160, Math.min(2400, Math.round(width)));
  const safeQuality = Math.max(60, Math.min(90, Math.round(quality)));
  const image = new URL(source);
  image.searchParams.set('tr', `w-${safeWidth},q-${safeQuality},f-auto`);
  return image.toString();
}

export function responsivePublicImageSrcset(
  source: string,
  widths: number[] = [320, 640, 960, 1280, 1600],
  quality = 80,
): string | undefined {
  if (!isImageKitUrl(source)) return undefined;
  const uniqueWidths = Array.from(new Set(
    widths.map((width) => Math.max(160, Math.min(2400, Math.round(width)))),
  )).sort((a, b) => a - b);
  return uniqueWidths
    .map((width) => `${optimizedPublicImageUrl(source, width, quality)} ${width}w`)
    .join(', ');
}
