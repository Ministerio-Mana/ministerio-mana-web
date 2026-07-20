import { normalizeCmsStoryPayload, type CmsStoryPayload } from './cmsStory.ts';

export const CHURCH_PAGE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const CHURCH_PAGE_TEMPLATES = ['ESSENTIAL', 'STORY', 'MOSAIC'] as const;

export type ChurchPageStatus = (typeof CHURCH_PAGE_STATUSES)[number];
export type ChurchPageTemplate = (typeof CHURCH_PAGE_TEMPLATES)[number];
export type ChurchGalleryImage = { url: string; alt: string };

export type ChurchPageDraft = {
  slug: string;
  status: ChurchPageStatus;
  template: ChurchPageTemplate;
  display_name: string;
  tagline: string;
  description: string;
  hero_image_url: string;
  hero_image_alt: string;
  pastor_name: string;
  pastor_title: string;
  pastor_image_url: string;
  pastor_image_alt: string;
  service_schedule: string;
  contact_whatsapp: string;
  contact_whatsapp_message: string;
  contact_email: string;
  story_config: CmsStoryPayload;
  gallery: ChurchGalleryImage[];
};

function compactText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function longText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

export function normalizeChurchPageSlug(value: unknown, fallback = ''): string {
  const normalized = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return normalized.length >= 3 ? normalized : '';
}

export function safeChurchPageImageUrl(value: unknown): string {
  const raw = String(value ?? '').trim().slice(0, 1200);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeChurchWhatsApp(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 18);
}

export function churchMediaFolder(church: Record<string, unknown>): string {
  const stableKey = church.code || church.id;
  return `iglesias/${normalizeChurchPageSlug(stableKey, String(church.id || 'iglesia')) || 'iglesia'}`;
}

function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeGallery(value: unknown): ChurchGalleryImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 16)
    .map((entry) => {
      const image = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      return {
        url: safeChurchPageImageUrl(image.url || image.image),
        alt: compactText(image.alt || image.imageAlt, 160),
      };
    })
    .filter((image) => image.url);
}

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.includes(String(value ?? '').toUpperCase() as T);
}

export function createChurchPageDraft(church: Record<string, unknown> = {}): ChurchPageDraft {
  const name = compactText(church.name, 120) || 'Iglesia Maná';
  const place = [compactText(church.city, 80), compactText(church.country, 80)].filter(Boolean).join(', ');
  return normalizeChurchPageDraft({
    slug: church.code || name,
    status: 'DRAFT',
    template: 'ESSENTIAL',
    display_name: name,
    tagline: place ? `Una familia de fe en ${place}` : 'Una familia para crecer en la fe',
    description: 'Conoce nuestra comunidad, horarios, próximos eventos y formas de contactarnos.',
    pastor_name: church.contact_name,
    service_schedule: '',
    contact_whatsapp: church.contact_phone,
    contact_email: church.contact_email,
    story_config: {
      preset: 'editorial',
      theme: 'navy',
      scenes: [],
    },
    gallery: [],
  });
}

export function normalizeChurchPageDraft(input: unknown): ChurchPageDraft {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const template = includesValue(CHURCH_PAGE_TEMPLATES, value.template) ? String(value.template).toUpperCase() as ChurchPageTemplate : 'ESSENTIAL';
  const status = includesValue(CHURCH_PAGE_STATUSES, value.status) ? String(value.status).toUpperCase() as ChurchPageStatus : 'DRAFT';
  return {
    slug: normalizeChurchPageSlug(value.slug),
    status,
    template,
    display_name: compactText(value.display_name || value.displayName, 120),
    tagline: compactText(value.tagline, 180),
    description: longText(value.description, 1600),
    hero_image_url: safeChurchPageImageUrl(value.hero_image_url || value.heroImageUrl),
    hero_image_alt: compactText(value.hero_image_alt || value.heroImageAlt, 160),
    pastor_name: compactText(value.pastor_name || value.pastorName, 120),
    pastor_title: compactText(value.pastor_title || value.pastorTitle, 80),
    pastor_image_url: safeChurchPageImageUrl(value.pastor_image_url || value.pastorImageUrl),
    pastor_image_alt: compactText(value.pastor_image_alt || value.pastorImageAlt, 160),
    service_schedule: longText(value.service_schedule || value.serviceSchedule, 600),
    contact_whatsapp: normalizeChurchWhatsApp(value.contact_whatsapp || value.contactWhatsapp),
    contact_whatsapp_message: compactText(value.contact_whatsapp_message || value.contactWhatsappMessage, 280),
    contact_email: normalizeEmail(value.contact_email || value.contactEmail),
    story_config: normalizeCmsStoryPayload(value.story_config || value.storyConfig).payload,
    gallery: normalizeGallery(value.gallery),
  };
}

export function validateChurchPageForPublish(input: unknown): { ok: boolean; errors: string[]; draft: ChurchPageDraft } {
  const draft = normalizeChurchPageDraft(input);
  const errors: string[] = [];
  if (!draft.slug) errors.push('El enlace público necesita un nombre válido.');
  if (!draft.display_name) errors.push('Agrega el nombre público de la iglesia.');
  if (!draft.tagline) errors.push('Agrega una frase corta de bienvenida.');
  if (!draft.description) errors.push('Agrega una descripción de la comunidad.');
  if (!draft.hero_image_url) errors.push('Selecciona una imagen de portada.');
  if (draft.hero_image_url && !draft.hero_image_alt) errors.push('Describe la imagen de portada.');
  if (!draft.service_schedule) errors.push('Indica al menos un horario de reunión.');
  if (!draft.contact_whatsapp && !draft.contact_email) errors.push('Agrega WhatsApp o correo de contacto.');
  if (draft.pastor_image_url && !draft.pastor_image_alt) errors.push('Describe la imagen del pastor o equipo.');
  draft.gallery.forEach((image, index) => {
    if (!image.alt) errors.push(`Describe la imagen ${index + 1} de la galería.`);
  });
  if (draft.template === 'STORY' || draft.template === 'MOSAIC') {
    const storyValidation = normalizeCmsStoryPayload(draft.story_config, { requirePublishable: true });
    errors.push(...storyValidation.errors);
    draft.story_config = storyValidation.payload;
  }
  return { ok: errors.length === 0, errors, draft };
}

export function isChurchPageSchemaMissingError(error: unknown): boolean {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = String(candidate.code || '');
  const message = String(candidate.message || candidate.details || '').toLowerCase();
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || (message.includes('church_public_page') && (
      message.includes('does not exist')
      || message.includes('schema cache')
      || message.includes('could not find')
    ));
}
