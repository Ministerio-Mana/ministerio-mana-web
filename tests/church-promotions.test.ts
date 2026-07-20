import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEventChurchPromotions,
  mergeChurchPromotions,
  normalizeCmsChurchPromotion,
  type ChurchPromotion,
} from '../src/lib/churchPromotions.ts';

test('normaliza campañas globales y rechaza enlaces o piezas incompletas', () => {
  const campaign = normalizeCmsChurchPromotion({
    id: 'campaign-1',
    position: 3,
    title: 'Peregrinación',
    payload: {
      title: 'Peregrinación a Turquía',
      description: 'Un recorrido para aprender y compartir.',
      image: 'https://ik.imagekit.io/mana/turquia.jpg',
      ctaHref: '/eventos/peregrinacion-turquia',
      ctaLabel: 'Conocer el viaje',
      priority: 8,
    },
  });
  assert.equal(campaign?.source, 'CAMPAIGN');
  assert.equal(campaign?.eyebrow, 'Para toda la familia Maná');
  assert.equal(campaign?.priority, 8);
  assert.equal(normalizeCmsChurchPromotion({ title: 'Insegura', payload: { image: 'javascript:alert(1)', ctaHref: '/' } }), null);
  assert.equal(normalizeCmsChurchPromotion({ title: 'Sin enlace', payload: { image: 'https://example.org/a.jpg' } }), null);
  assert.equal(normalizeCmsChurchPromotion({
    title: 'Escape de dominio',
    payload: { image: 'https://example.org/a.jpg', ctaHref: '/\\example.org' },
  }), null);
});

test('convierte eventos aplicables con imagen en promociones humanas', () => {
  const now = new Date('2026-07-20T12:00:00-05:00').getTime();
  const promotions = buildEventChurchPromotions([{
    id: 'event-global',
    title: 'Escuela Bíblica',
    description: 'Una temporada para crecer.',
    scope: 'GLOBAL',
    audience_kind: 'GLOBAL',
    audience_label: 'Para toda la familia Maná',
    audience_priority: 4,
    public_path: '/eventos/escuela-biblica',
    slug: 'escuela-biblica',
    banner_url: 'https://ik.imagekit.io/mana/escuela.jpg',
    banner_layout: 'HORIZONTAL',
    start_date: '2026-08-10T18:00:00-05:00',
    end_date: null,
    location_name: null,
    location_address: null,
    city: null,
    country: null,
    price: null,
    currency: null,
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    page_settings: { promote_on_church_pages: true, promotion_priority: 10 },
  }], { now });
  assert.equal(promotions.length, 1);
  assert.equal(promotions[0].eyebrow, 'Para toda la familia Maná');
  assert.equal(promotions[0].cta_href, '/eventos/escuela-biblica');
  assert.equal(promotions[0].priority, 10);
});

test('respeta exclusión promocional, exige imagen y elimina duplicados', () => {
  const now = new Date('2026-07-20T12:00:00-05:00').getTime();
  const baseEvent = {
    id: 'event-1', title: 'Evento', description: null, scope: 'LOCAL', church_id: 'church-1',
    audience_kind: 'CHURCH', audience_label: 'En tu iglesia', audience_priority: 0, public_path: '/eventos/evento',
    slug: 'evento', banner_url: 'https://example.org/evento.jpg', start_date: '2026-08-10T18:00:00-05:00', end_date: null,
    location_name: null, location_address: null, city: 'Medellín', country: 'Colombia', price: null, currency: null,
    status: 'PUBLISHED', visibility: 'PUBLIC',
  } as any;
  assert.equal(buildEventChurchPromotions([{ ...baseEvent, page_settings: { promote_on_church_pages: false } }], { now }).length, 0);
  assert.equal(buildEventChurchPromotions([{ ...baseEvent, banner_url: '', page_settings: { promote_on_church_pages: true } }], { now }).length, 0);

  const first: ChurchPromotion = {
    id: 'a', source: 'CAMPAIGN', title: 'Misma', description: '', eyebrow: 'Global', image_url: 'https://example.org/a.jpg',
    mobile_image_url: '', cta_label: 'Ver', cta_href: '/misma', starts_at: null, ends_at: null, priority: 10,
  };
  const duplicate = { ...first, id: 'b', source: 'EVENT' as const, priority: 20 };
  assert.deepEqual(mergeChurchPromotions([first], [duplicate], 4).map((item) => item.id), ['a']);
});
