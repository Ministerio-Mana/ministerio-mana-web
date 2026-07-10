import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeCmsMediaFolder } from '@lib/cmsMedia';

export type ImageKitConfig = {
  urlEndpoint: string;
  publicKey: string;
  privateKey: string;
};

export type ImageKitFileDetails = {
  fileId?: string;
  name?: string;
  filePath?: string;
  url?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  fileType?: string;
  mime?: string;
  isPublished?: boolean;
  size?: number;
  width?: number;
  height?: number;
  createdAt?: string;
};

type RegistrationClaims = {
  sub: string;
  logicalFolder: string;
  remoteFolder: string;
  fileName: string;
  iat: number;
  exp: number;
};

function envValue(name: string): string {
  const astroEnv = import.meta.env?.[name];
  return String(astroEnv || process.env[name] || '').trim();
}

export function getCmsMediaProvider(): 'supabase' | 'imagekit' {
  return envValue('CMS_MEDIA_PROVIDER').toLowerCase() === 'imagekit' ? 'imagekit' : 'supabase';
}

export function getImageKitConfig(): ImageKitConfig | null {
  const urlEndpoint = envValue('IMAGEKIT_URL_ENDPOINT').replace(/\/+$/, '');
  const publicKey = envValue('IMAGEKIT_PUBLIC_KEY');
  const privateKey = envValue('IMAGEKIT_PRIVATE_KEY');
  if (!urlEndpoint || !publicKey || !privateKey) return null;

  try {
    const parsed = new URL(urlEndpoint);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return { urlEndpoint, publicKey, privateKey };
}

function encodePart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signParts(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): string {
  const encodedHeader = encodePart(header);
  const encodedPayload = encodePart(payload);
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function createImageKitUploadToken(
  config: ImageKitConfig,
  uploadPayload: Record<string, string>,
): string {
  const iat = Math.floor(Date.now() / 1000);
  return signParts(
    { alg: 'HS256', typ: 'JWT', kid: config.publicKey },
    { ...uploadPayload, iat, exp: iat + 300 },
    config.privateKey,
  );
}

export function createCmsMediaRegistrationToken(
  config: ImageKitConfig,
  claims: Omit<RegistrationClaims, 'iat' | 'exp'>,
): string {
  const iat = Math.floor(Date.now() / 1000);
  return signParts(
    { alg: 'HS256', typ: 'JWT', kid: 'cms-media-registration' },
    { ...claims, iat, exp: iat + 900 },
    config.privateKey,
  );
}

export function verifyCmsMediaRegistrationToken(
  config: ImageKitConfig,
  token: string,
): RegistrationClaims | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', config.privateKey).update(unsigned).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as RegistrationClaims;
    const now = Math.floor(Date.now() / 1000);
    if (header?.alg !== 'HS256' || header?.kid !== 'cms-media-registration') return null;
    if (!payload?.sub || !payload.logicalFolder || !payload.remoteFolder || !payload.fileName) return null;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    if (payload.iat > now + 60 || payload.exp < now || payload.exp - payload.iat > 900) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildImageKitCmsFolder(logicalFolder: string): string {
  const safeFolder = safeCmsMediaFolder(logicalFolder) || 'general';
  return `/ministerio-mana/cms/${safeFolder}`;
}

function imageKitAuthorization(config: ImageKitConfig): string {
  return `Basic ${Buffer.from(`${config.privateKey}:`).toString('base64')}`;
}

export async function getImageKitFileDetails(
  config: ImageKitConfig,
  fileId: string,
): Promise<ImageKitFileDetails | null> {
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, {
    headers: {
      accept: 'application/json',
      authorization: imageKitAuthorization(config),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ImageKit file lookup failed (${response.status})`);
  return response.json() as Promise<ImageKitFileDetails>;
}

export async function deleteImageKitFile(config: ImageKitConfig, fileId: string): Promise<void> {
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      authorization: imageKitAuthorization(config),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404 || response.status === 204) return;
  if (!response.ok) throw new Error(`ImageKit file deletion failed (${response.status})`);
}

export async function publishImageKitFile(config: ImageKitConfig, fileId: string): Promise<void> {
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      authorization: imageKitAuthorization(config),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      publish: {
        isPublished: true,
        includeFileVersions: false,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ImageKit file publication failed (${response.status})`);
}

export async function purgeImageKitUrl(config: ImageKitConfig, url: string): Promise<void> {
  const response = await fetch('https://api.imagekit.io/v1/files/purge', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: imageKitAuthorization(config),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status !== 201) throw new Error(`ImageKit cache purge failed (${response.status})`);
}

export function isImageKitDeliveryUrl(config: ImageKitConfig, candidate: string): boolean {
  try {
    const expected = new URL(config.urlEndpoint);
    const actual = new URL(candidate);
    return expected.protocol === actual.protocol && expected.host === actual.host;
  } catch {
    return false;
  }
}
