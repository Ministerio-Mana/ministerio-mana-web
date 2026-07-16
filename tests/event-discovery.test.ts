import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverEventsForProfile, getEventAudience, getEventPublicPath } from '../src/lib/eventDiscovery.ts';

const profile = {
  churchId: 'church-medellin',
  regionId: 'region-antioquia',
  city: 'Medellín',
  country: 'Colombia',
};

test('respeta la jerarquía iglesia, ciudad, región, país y global', () => {
  assert.equal(getEventAudience({ id: '1', scope: 'LOCAL', church_id: 'church-medellin' }, profile)?.audience_kind, 'CHURCH');
  assert.equal(getEventAudience({ id: '2', scope: 'LOCAL', city: 'Medellin', country: 'colombia' }, profile)?.audience_kind, 'NEARBY');
  assert.equal(getEventAudience({ id: '3', scope: 'REGIONAL', region_id: 'region-antioquia' }, profile)?.audience_kind, 'REGIONAL');
  assert.equal(getEventAudience({ id: '4', scope: 'NATIONAL', country: 'Colombia' }, profile)?.audience_kind, 'NATIONAL');
  assert.equal(getEventAudience({ id: '5', scope: 'GLOBAL' }, profile)?.audience_kind, 'GLOBAL');
});

test('no muestra eventos territoriales que no corresponden al perfil', () => {
  assert.equal(getEventAudience({ id: '1', scope: 'LOCAL', city: 'Bogotá', country: 'Colombia' }, profile), null);
  assert.equal(getEventAudience({ id: '2', scope: 'REGIONAL', region_id: 'region-caribe' }, profile), null);
  assert.equal(getEventAudience({ id: '3', scope: 'NATIONAL', country: 'Francia' }, profile), null);
});

test('ordena por cercanía territorial y excluye privados o finalizados', () => {
  const now = new Date('2026-07-15T12:00:00-05:00').getTime();
  const events = [
    { id: 'global', scope: 'GLOBAL', status: 'PUBLISHED', visibility: 'PUBLIC', start_date: '2026-07-16T10:00:00-05:00' },
    { id: 'national', scope: 'NATIONAL', country: 'Colombia', status: 'PUBLISHED', visibility: 'PUBLIC', start_date: '2026-07-17T10:00:00-05:00' },
    { id: 'local', slug: 'evento-local', scope: 'LOCAL', church_id: 'church-medellin', status: 'PUBLISHED', visibility: 'PUBLIC', start_date: '2026-08-01T10:00:00-05:00' },
    { id: 'private', scope: 'GLOBAL', status: 'PUBLISHED', visibility: 'PRIVATE', start_date: '2026-07-16T10:00:00-05:00' },
    { id: 'past', scope: 'GLOBAL', status: 'PUBLISHED', visibility: 'PUBLIC', start_date: '2026-07-01T10:00:00-05:00', end_date: '2026-07-01T12:00:00-05:00' },
  ];
  const result = discoverEventsForProfile(events, profile, { now, limit: 10 });
  assert.deepEqual(result.map((event) => event.id), ['local', 'national', 'global']);
  assert.equal(result[0].public_path, '/eventos/evento-local');
});

test('mantiene la ruta pública conocida de la Cumbre', () => {
  assert.equal(getEventPublicPath({ id: '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202' }), '/eventos/cumbre-mundial-2026');
});
