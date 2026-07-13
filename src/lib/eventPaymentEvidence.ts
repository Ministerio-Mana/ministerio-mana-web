import crypto from 'node:crypto';
import sharp from 'sharp';

export const MAX_EVIDENCE_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_PDF_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_OUTPUT_BYTES = 1536 * 1024;
export const EVIDENCE_UPLOAD_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_MIMES = new Set([...IMAGE_MIMES, 'application/pdf']);

export function cleanEvidenceName(value: string, maxLength = 90): string {
  return String(value || 'persona')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, maxLength) || 'persona';
}

export function safeEvidenceOriginalName(value: string): string {
  const leaf = String(value || '').split(/[\\/]/).pop() || 'comprobante';
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'comprobante';
}

export function createEvidenceUploadCredential() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    sha256: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + EVIDENCE_UPLOAD_TOKEN_TTL_MS).toISOString(),
  };
}

export function verifyEvidenceUploadCredential(token: string, expectedSha256: string, expiresAt: string): boolean {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token) || !/^[a-f0-9]{64}$/i.test(expectedSha256)) return false;
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;
  const actual = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'), 'utf8');
  const expected = Buffer.from(expectedSha256.toLowerCase(), 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function buildEvidenceStoredName(contactName: string, registrationId: string, extension: string): string {
  const person = cleanEvidenceName(contactName, 72);
  const suffix = String(registrationId || '').replace(/-/g, '').slice(0, 8).toLowerCase();
  return `comprobante-${person}-${suffix || 'registro'}.${extension}`;
}

export async function preparePaymentEvidence(file: File): Promise<{
  content: Uint8Array;
  contentType: string;
  extension: 'webp' | 'pdf';
  originalName: string;
  optimized: boolean;
}> {
  const declaredType = String(file.type || '').toLowerCase();
  if (!ALLOWED_MIMES.has(declaredType) || file.size <= 0 || file.size > MAX_EVIDENCE_INPUT_BYTES) {
    throw new Error('Usa una captura JPG, PNG o WebP, o un PDF, de máximo 4 MB.');
  }
  const originalName = safeEvidenceOriginalName(file.name);
  const input = Buffer.from(await file.arrayBuffer());

  if (declaredType === 'application/pdf') {
    if (input.byteLength > MAX_EVIDENCE_PDF_BYTES) throw new Error('El PDF debe pesar máximo 2 MB.');
    if (input.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('El contenido del PDF no es válido.');
    const searchable = input.toString('latin1');
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/i.test(searchable)) {
      throw new Error('El PDF contiene funciones activas no permitidas.');
    }
    return {
      content: input,
      contentType: 'application/pdf',
      extension: 'pdf',
      originalName,
      optimized: false,
    };
  }

  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 });
    const metadata = await image.metadata();
    const actualType = metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : '';
    if (!actualType || actualType !== declaredType || !metadata.width || !metadata.height) {
      throw new Error('Formato de imagen inconsistente.');
    }
    const variants = [
      { maxDimension: 1600, quality: 78 },
      { maxDimension: 1400, quality: 68 },
      { maxDimension: 1200, quality: 60 },
    ];
    let content: Uint8Array = new Uint8Array();
    for (const variant of variants) {
      content = await sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 })
        .rotate()
        .resize({
          width: variant.maxDimension,
          height: variant.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: variant.quality, effort: 5 })
        .toBuffer();
      if (content.byteLength <= MAX_EVIDENCE_OUTPUT_BYTES) break;
    }
    if (content.byteLength > MAX_EVIDENCE_OUTPUT_BYTES) {
      throw new Error('La captura sigue siendo demasiado pesada después de optimizarla.');
    }
    return {
      content,
      contentType: 'image/webp',
      extension: 'webp',
      originalName,
      optimized: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new Error(message.includes('demasiado pesada') ? message : 'La captura no pudo validarse de forma segura.');
  }
}
