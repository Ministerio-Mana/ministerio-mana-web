export const CMS_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CMS_IMAGE_MIME_SET = new Set<string>(CMS_IMAGE_MIME_TYPES);
export const CMS_IMAGEKIT_MAX_BYTES = 5 * 1024 * 1024;
export const CMS_SUPABASE_MAX_BYTES = 4 * 1024 * 1024;
export const CMS_IMAGE_MIN_DIMENSION = 160;
export const CMS_IMAGE_MAX_DIMENSION = 5000;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function safeCmsMediaFolder(input: string | null | undefined): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 160);
}

export function resolveCmsMediaFolder(
  folder: string | null | undefined,
  pageKey: string | null | undefined,
): string {
  return safeCmsMediaFolder(folder) || safeCmsMediaFolder(pageKey) || 'general';
}

export function cleanCmsMediaFileBase(input: string | null | undefined): string {
  const withoutExtension = String(input || 'imagen').replace(/\.[^.]+$/, '');
  return withoutExtension
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'imagen';
}

export function cmsMediaExtensionForMime(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType] || null;
}

export function createCmsMediaFileName(originalName: string, mimeType: string): string {
  const extension = cmsMediaExtensionForMime(mimeType);
  if (!extension) throw new Error('Unsupported CMS image type');
  return `${cleanCmsMediaFileBase(originalName)}-${crypto.randomUUID()}.${extension}`;
}

export function isCmsImageDimensionAllowed(value: unknown): boolean {
  const dimension = Number(value);
  return Number.isFinite(dimension)
    && dimension >= CMS_IMAGE_MIN_DIMENSION
    && dimension <= CMS_IMAGE_MAX_DIMENSION;
}

export function cmsImageKitChecks(): string {
  return [
    '"file.size" <= "5MB"',
    '"file.mime" IN ["image/jpeg", "image/png", "image/webp"]',
    `"mediaMetadata.width" >= ${CMS_IMAGE_MIN_DIMENSION}`,
    `"mediaMetadata.width" <= ${CMS_IMAGE_MAX_DIMENSION}`,
    `"mediaMetadata.height" >= ${CMS_IMAGE_MIN_DIMENSION}`,
    `"mediaMetadata.height" <= ${CMS_IMAGE_MAX_DIMENSION}`,
  ].join(' AND ');
}
