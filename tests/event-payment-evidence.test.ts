import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildEvidenceRegistrationFolder,
  buildEvidenceStoredName,
  cleanEvidenceName,
  createEvidenceUploadCredential,
  MAX_EVIDENCE_OUTPUT_BYTES,
  preparePaymentEvidence,
  verifyEvidenceUploadCredential,
} from '../src/lib/eventPaymentEvidence.ts';

test('organiza el nombre del comprobante por persona e inscripción', () => {
  assert.equal(cleanEvidenceName('  María Pérez / Gómez  '), 'maria-perez-gomez');
  assert.equal(
    buildEvidenceStoredName('María Pérez', '12345678-1234-4234-9234-123456789abc', 'webp'),
    'comprobante-maria-perez-12345678.webp',
  );
  assert.equal(
    buildEvidenceRegistrationFolder(
      'María Pérez',
      '12345678-1234-4234-9234-123456789abc',
      'abcdef12-1234-4234-9234-123456789abc',
    ),
    'maria-perez-12345678-abcdef12',
  );
});

test('emite una credencial temporal y almacenable solo como hash', () => {
  const credential = createEvidenceUploadCredential();
  assert.equal(credential.token.includes(credential.sha256), false);
  assert.equal(
    verifyEvidenceUploadCredential(credential.token, credential.sha256, credential.expiresAt),
    true,
  );
  assert.equal(
    verifyEvidenceUploadCredential(`${credential.token}x`, credential.sha256, credential.expiresAt),
    false,
  );
  assert.equal(
    verifyEvidenceUploadCredential(credential.token, credential.sha256, '2020-01-01T00:00:00.000Z'),
    false,
  );
});

test('reorienta y optimiza capturas como WebP sin metadatos originales', async () => {
  const input = await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 3,
      background: { r: 41, g: 60, b: 116 },
    },
  }).png().toBuffer();
  const inputBody = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const file = new File([inputBody], 'Captura de pago.png', { type: 'image/png' });
  const prepared = await preparePaymentEvidence(file);
  const metadata = await sharp(prepared.content).metadata();

  assert.equal(prepared.contentType, 'image/webp');
  assert.equal(prepared.extension, 'webp');
  assert.equal(prepared.optimized, true);
  assert.ok(prepared.content.byteLength <= MAX_EVIDENCE_OUTPUT_BYTES);
  assert.ok((metadata.width || 0) <= 1600);
  assert.ok((metadata.height || 0) <= 1600);
});

test('rechaza contenido que no coincide con el tipo de imagen declarado', async () => {
  const fake = new File([new TextEncoder().encode('%PDF-1.4\n')], 'captura.png', { type: 'image/png' });
  await assert.rejects(
    () => preparePaymentEvidence(fake),
    /no pudo validarse de forma segura/i,
  );
});
