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
  canPublishChurchPageForDirectory,
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
    gallery: Array.from({ length: 20 }, (_, index) => ({ url: `https://ik.imagekit.io/test/${index}.jpg`, alt: `Foto ${index}` })),
  });
  assert.equal(page.hero_image_url, '');
  assert.equal(page.contact_whatsapp, '573001234567');
  assert.equal(page.gallery.length, 16);
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

test('solo publica páginas de iglesias activas y visibles en el directorio', () => {
  assert.equal(canPublishChurchPageForDirectory({
    id: 'mana-publica',
    name: 'Maná Pública',
    lifecycle_status: 'ACTIVE',
    is_public: true,
  }), true);
  assert.equal(canPublishChurchPageForDirectory({
    id: 'mana-borrador',
    name: 'Maná Borrador',
    lifecycle_status: 'DRAFT',
    is_public: true,
  }), false);
  assert.equal(canPublishChurchPageForDirectory({
    id: 'mana-privada',
    name: 'Maná Privada',
    lifecycle_status: 'ACTIVE',
    is_public: false,
  }), false);
  assert.equal(canPublishChurchPageForDirectory({ id: 'legacy', name: 'Maná Legacy' }), true);
});

test('recargar no convierte una página guardada en un borrador pendiente', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/scripts/portal-church-page.js', import.meta.url)), 'utf8');
  assert.match(source, /if \(!key \|\| !state\.page \|\| !state\.dirty\) return;/);
  assert.match(source, /JSON\.stringify\(localDraft\) !== JSON\.stringify\(normalizedServerPage\)/);
  assert.match(source, /if \(localDraft && !hasLocalChanges\) clearLocalDraft\(\);/);
});

test('una página publicada se puede retirar desde el mismo editor', () => {
  const script = readFileSync(fileURLToPath(new URL('../src/scripts/portal-church-page.js', import.meta.url)), 'utf8');
  const page = readFileSync(fileURLToPath(new URL('../src/pages/portal/church-page.astro', import.meta.url)), 'utf8');
  assert.match(page, /id="church-page-unpublish"[^>]*>.*Retirar publicación/);
  assert.match(script, /action: 'unpublish'/);
  assert.match(script, /el\.unpublish\?\.addEventListener\('click', unpublishPage\)/);
});

test('la vista previa no oculta acciones en escritorios con poca altura', () => {
  const page = readFileSync(fileURLToPath(new URL('../src/pages/portal/church-page.astro', import.meta.url)), 'utf8');
  assert.match(page, /church-page-preview-rail space-y-4 xl:sticky xl:top-6/);
  assert.match(page, /@media \(min-width: 1280px\) and \(max-height: 899px\)/);
  assert.match(page, /\.church-page-preview-rail \{ position: static !important; \}/);
});

test('los rechazos del proveedor de imágenes se explican en español', () => {
  const script = readFileSync(fileURLToPath(new URL('../src/scripts/portal-church-page.js', import.meta.url)), 'utf8');
  assert.match(script, /No pudimos procesar esa imagen\. Verifica que sea un JPG, PNG o WebP válido e intenta de nuevo\./);
  assert.doesNotMatch(script, /uploaded\?\.message/);
});

test('las páginas públicas sincronizan la jerarquía completa de eventos', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/lib/churchPublic.ts', import.meta.url)), 'utf8');
  assert.match(source, /region_id,city,country/);
  assert.match(source, /discoverEventsForProfile\(publicEvents/);
  assert.match(source, /churchId: pageResult\.data\.church_id/);
  assert.match(source, /regionId: churchResult\.data\.region_id/);
  assert.match(source, /country: churchResult\.data\.country/);
  assert.match(source, /limit: 50/);
});

test('promociones y calendario comparten una experiencia accesible en todas las plantillas', () => {
  const component = readFileSync(fileURLToPath(new URL('../src/components/churches/ChurchEventsExperience.astro', import.meta.url)), 'utf8');
  const script = readFileSync(fileURLToPath(new URL('../src/scripts/church-events.js', import.meta.url)), 'utf8');
  const publicPage = readFileSync(fileURLToPath(new URL('../src/components/churches/ChurchPublicExperience.astro', import.meta.url)), 'utf8');
  assert.match(publicPage, /ChurchEventsExperience events=\{\[\]\} \{promotions\} mode="promotions"/);
  assert.match(publicPage, /ChurchEventsExperience \{events\} promotions=\{\[\]\} mode="agenda"/);
  assert.match(component, /aria-roledescription="diapositiva"/);
  assert.match(component, /data-calendar-grid role="grid"/);
  assert.match(component, /data-calendar-list aria-live="polite"/);
  assert.match(component, /min-height: 48px/);
  assert.match(script, /event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/);
  assert.doesNotMatch(script, /setInterval|autoplay/i);
});

test('la galería ofrece más libertad sin convertir toda la página en un muro de fotos', () => {
  const page = readFileSync(fileURLToPath(new URL('../src/components/churches/ChurchPublicExperience.astro', import.meta.url)), 'utf8');
  const editor = readFileSync(fileURLToPath(new URL('../src/scripts/portal-church-page.js', import.meta.url)), 'utf8');
  assert.match(editor, /const MAX_GALLERY = 16;/);
  assert.match(page, /const primaryGallery = gallery\.slice\(0, 9\)/);
  assert.match(page, /const extraGallery = gallery\.slice\(9\)/);
  assert.match(page, /church-gallery__more/);
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
