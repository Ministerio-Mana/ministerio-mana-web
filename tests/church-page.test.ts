import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  churchMediaFolder,
  createChurchPageDraft,
  normalizeChurchPageDraft,
  normalizeChurchPageSlug,
  validateChurchPageForPublish,
} from '../src/lib/churchPage.ts';
import {
  canCreateChurch,
  canEditChurch,
  extractCoordinatesFromMapsUrl,
  hasValidChurchCoordinates,
  isQaChurchDeletionCandidate,
  normalizeChurchManagementInput,
} from '../src/lib/churchManagement.ts';
import { normalizePublicChurchDirectoryItem } from '../src/lib/churchDirectoryItem.ts';
import { buildSafeChurchMapsUrl } from '../src/lib/mapsUrl.ts';
import { canCreateRole } from '../src/lib/portalRbac.ts';
import { isChurchScopeRowAllowed } from '../src/lib/churchScopePolicy.ts';

test('la biblioteca usa un identificador estable y no el nombre editable', () => {
  assert.equal(
    churchMediaFolder({ id: '4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4', name: 'Nombre anterior' }),
    'iglesias/4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4',
  );
  assert.equal(
    churchMediaFolder({ id: '4cfd7cc8-3e5c-4cb1-b88e-826bd22419b4', code: 'MANA-BOGOTA', name: 'Nombre nuevo' }),
    'iglesias/mana-bogota',
  );
});

test('normaliza enlaces públicos de iglesias sin caracteres inseguros', () => {
  assert.equal(normalizeChurchPageSlug(' Maná Belén / Medellín '), 'mana-belen-medellin');
  assert.equal(normalizeChurchPageSlug('a'), '');
});

test('limita galerías, URLs y teléfono a valores públicos válidos', () => {
  const page = normalizeChurchPageDraft({
    slug: 'iglesia-prueba',
    display_name: 'Iglesia Prueba',
    hero_image_url: 'javascript:alert(1)',
    contact_whatsapp: '+57 (300) 123-4567',
    gallery: Array.from({ length: 12 }, (_, index) => ({ url: `https://ik.imagekit.io/test/${index}.jpg`, alt: `Foto ${index}` })),
  });
  assert.equal(page.hero_image_url, '');
  assert.equal(page.contact_whatsapp, '573001234567');
  assert.equal(page.gallery.length, 8);
});

test('la plantilla esencial publica información completa sin exigir escenas', () => {
  const base = createChurchPageDraft({ name: 'Maná Prueba', code: 'mana-prueba' });
  const result = validateChurchPageForPublish({
    ...base,
    tagline: 'Una familia para crecer',
    description: 'Una comunidad local abierta para caminar juntos.',
    hero_image_url: 'https://ik.imagekit.io/test/hero.jpg',
    hero_image_alt: 'Comunidad reunida',
    service_schedule: 'Domingos · 10:00 a. m.',
    contact_whatsapp: '+57 300 123 4567',
  });
  assert.equal(result.ok, true);
});

test('Historia y Mosaico requieren al menos dos escenas publicables', () => {
  const result = validateChurchPageForPublish({
    slug: 'mana-prueba',
    template: 'STORY',
    display_name: 'Maná Prueba',
    tagline: 'Una familia para crecer',
    description: 'Una comunidad local abierta para caminar juntos.',
    hero_image_url: 'https://ik.imagekit.io/test/hero.jpg',
    hero_image_alt: 'Comunidad reunida',
    service_schedule: 'Domingos · 10:00 a. m.',
    contact_email: 'iglesia@example.org',
    story_config: { preset: 'editorial', theme: 'navy', scenes: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /al menos 2 escenas/i);
});

test('la jerarquía delega personas únicamente hacia niveles permitidos', () => {
  assert.equal(canCreateRole('national_pastor', 'regional_pastor'), true);
  assert.equal(canCreateRole('regional_pastor', 'pastor'), true);
  assert.equal(canCreateRole('regional_pastor', 'national_pastor'), false);
  assert.equal(canCreateRole('pastor', 'regional_collaborator'), false);
});

test('la gestión de iglesias respeta la misma escalera de seguridad', () => {
  const access = (role: string) => ({ role, isPasswordSession: false });
  assert.equal(canCreateChurch(access('national_pastor')), true);
  assert.equal(canCreateChurch(access('regional_pastor')), true);
  assert.equal(canCreateChurch(access('pastor')), false);
  assert.equal(canEditChurch(access('pastor')), true);
  assert.equal(canEditChurch(access('local_collaborator')), false);
  assert.equal(canCreateChurch({ role: 'superadmin', isPasswordSession: true }), false);
});

test('el borrado total queda limitado a pruebas QA ya retiradas del público', () => {
  assert.equal(isQaChurchDeletionCandidate({
    name: 'PRUEBA QA Iglesia Esencial',
    lifecycle_status: 'INACTIVE',
    is_public: false,
    show_on_map: false,
  }), true);
  assert.equal(isQaChurchDeletionCandidate({
    name: 'Iglesia Maná Medellín',
    lifecycle_status: 'INACTIVE',
    is_public: false,
    show_on_map: false,
  }), false);
  assert.equal(isQaChurchDeletionCandidate({
    name: 'PRUEBA QA Iglesia todavía visible',
    lifecycle_status: 'ACTIVE',
    is_public: true,
    show_on_map: true,
  }), false);
});

test('una sede sin región no se abre por respaldo a todo el país', () => {
  const regional = {
    isAdmin: false,
    isNational: false,
    isRegional: true,
    allowedChurchId: null,
    allowedCountry: 'Colombia',
    allowedRegionIds: ['region-antioquia'],
  };
  assert.equal(isChurchScopeRowAllowed({ id: 'mana-medellin', country: 'Colombia', region_id: 'region-antioquia' }, regional), true);
  assert.equal(isChurchScopeRowAllowed({ id: 'mana-cali', country: 'Colombia', region_id: 'region-valle' }, regional), false);
  assert.equal(isChurchScopeRowAllowed({ id: 'mana-sin-region', country: 'Colombia', region_id: null }, regional), false);
});

test('normaliza los datos oficiales y protege el mapa sin coordenadas', () => {
  const input = normalizeChurchManagementInput({
    name: '  Iglesia   Maná Centro  ',
    kind: 'church',
    status: 'active',
    country: 'colombia',
    city: 'Medellín',
    is_public: true,
    show_on_map: true,
  });
  assert.equal(input.name, 'Iglesia Maná Centro');
  assert.equal(input.country, 'Colombia');
  assert.equal(input.kind, 'CHURCH');
  assert.equal(input.status, 'ACTIVE');
  assert.equal(input.show_on_map, false);
  assert.equal(hasValidChurchCoordinates('', ''), false);
  assert.equal(hasValidChurchCoordinates(null, undefined), false);
  assert.equal(hasValidChurchCoordinates('6.244203', '-75.581212'), true);
});

test('el directorio no convierte coordenadas vacías en el punto 0,0', () => {
  const church = normalizePublicChurchDirectoryItem({
    name: 'Ministerio Maná Virtual',
    country: 'Australia',
    lat: null,
    lng: null,
    show_on_map: true,
  });

  assert.equal(church.lat, null);
  assert.equal(church.lng, null);
  assert.equal(church.show_on_map, false);
  assert.equal(
    buildSafeChurchMapsUrl({ lat: null, lng: null, city: 'Medellín', country: 'Colombia' }),
    'https://www.google.com/maps/search/?api=1&query=Medell%C3%ADn%2C%20Colombia',
  );
});

test('detecta coordenadas válidas desde enlaces de Google Maps', () => {
  assert.deepEqual(
    extractCoordinatesFromMapsUrl('https://www.google.com/maps/place/Maná/@6.244203,-75.581212,16z'),
    { lat: 6.244203, lng: -75.581212 },
  );
  assert.equal(extractCoordinatesFromMapsUrl('https://maps.google.com/iglesia'), null);
});

test('solo el directorio y su importación explícita crean iglesias oficiales', () => {
  const apiRoot = fileURLToPath(new URL('../src/pages/api/portal/', import.meta.url));
  const mutationRoutes = (readdirSync(apiRoot, { recursive: true }) as string[])
    .filter((route) => route.endsWith('.ts'))
    .filter((route) => {
      const source = readFileSync(`${apiRoot}/${route}`, 'utf8').replace(/\s+/g, '');
      return /\.from\(['"]churches['"]\)\.insert\(/.test(source);
    })
    .sort();

  assert.deepEqual(mutationRoutes, [
    'admin/seed-churches.ts',
    'churches/manage.ts',
  ]);
});
