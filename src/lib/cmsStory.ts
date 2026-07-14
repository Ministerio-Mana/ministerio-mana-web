import { isStoryMotionPreset, type StoryMotionPresetName } from './storyMotion.ts';

export const CMS_STORY_THEMES = ['navy', 'light', 'warm'] as const;
export const CMS_STORY_LAYOUTS = ['backdrop', 'split-left', 'split-right', 'poster'] as const;
export const CMS_STORY_FOCAL_POINTS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export const CMS_STORY_MIN_SCENES = 2;
export const CMS_STORY_MAX_SCENES = 8;

export type CmsStoryTheme = (typeof CMS_STORY_THEMES)[number];
export type CmsStoryLayout = (typeof CMS_STORY_LAYOUTS)[number];
export type CmsStoryFocalPoint = (typeof CMS_STORY_FOCAL_POINTS)[number];

export type CmsStoryScene = {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  image: string;
  imageAlt: string;
  focalPoint: CmsStoryFocalPoint;
  layout: CmsStoryLayout;
  primaryLabel: string;
  primaryHref: string;
};

export type CmsStoryPayload = {
  preset: StoryMotionPresetName;
  theme: CmsStoryTheme;
  scenes: CmsStoryScene[];
};

type NormalizeOptions = {
  requirePublishable?: boolean;
};

function compactText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function multilineText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function safePublicUrl(value: unknown): string {
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

function safeId(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.includes(String(value ?? '') as T);
}

function normalizeScene(value: unknown, index: number): CmsStoryScene {
  const scene = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    id: safeId(scene.id, `escena-${index + 1}`),
    eyebrow: compactText(scene.eyebrow, 60),
    title: compactText(scene.title, 90),
    text: multilineText(scene.text, 520),
    image: safePublicUrl(scene.image),
    imageAlt: compactText(scene.imageAlt, 160),
    focalPoint: includesValue(CMS_STORY_FOCAL_POINTS, scene.focalPoint) ? scene.focalPoint : 'center',
    layout: includesValue(CMS_STORY_LAYOUTS, scene.layout) ? scene.layout : index % 2 ? 'split-right' : 'backdrop',
    primaryLabel: compactText(scene.primaryLabel, 40),
    primaryHref: safePublicUrl(scene.primaryHref),
  };
}

export function createDefaultCmsStoryPayload(title = 'Nuestra historia'): CmsStoryPayload {
  return {
    preset: 'editorial',
    theme: 'navy',
    scenes: [
      normalizeScene({
        id: 'bienvenida',
        eyebrow: 'Ministerio Maná',
        title,
        text: 'Presenta aquí la idea principal con una frase breve y cercana.',
        layout: 'backdrop',
      }, 0),
      normalizeScene({
        id: 'proposito',
        eyebrow: 'Nuestro propósito',
        title: 'Una historia que continúa',
        text: 'Agrega una segunda escena para ampliar el mensaje con una imagen significativa.',
        layout: 'split-right',
      }, 1),
      normalizeScene({
        id: 'invitacion',
        eyebrow: 'Te esperamos',
        title: 'Sé parte de esta historia',
        text: 'Cierra con una invitación clara y, si lo necesitas, agrega un botón.',
        layout: 'poster',
      }, 2),
    ],
  };
}

export function normalizeCmsStoryPayload(
  input: unknown,
  options: NormalizeOptions = {},
): { ok: boolean; payload: CmsStoryPayload; errors: string[] } {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawScenes = Array.isArray(value.scenes) ? value.scenes : [];
  const scenes = rawScenes.slice(0, CMS_STORY_MAX_SCENES).map(normalizeScene);
  const payload: CmsStoryPayload = {
    preset: isStoryMotionPreset(value.preset) ? value.preset : 'editorial',
    theme: includesValue(CMS_STORY_THEMES, value.theme) ? value.theme : 'navy',
    scenes,
  };
  const errors: string[] = [];

  if (rawScenes.length > CMS_STORY_MAX_SCENES) {
    errors.push(`La historia admite máximo ${CMS_STORY_MAX_SCENES} escenas.`);
  }
  if (options.requirePublishable && scenes.length < CMS_STORY_MIN_SCENES) {
    errors.push(`Agrega al menos ${CMS_STORY_MIN_SCENES} escenas antes de publicar.`);
  }

  if (options.requirePublishable) {
    scenes.forEach((scene, index) => {
      if (!scene.title) errors.push(`La escena ${index + 1} necesita un título.`);
      if (!scene.image) errors.push(`La escena ${index + 1} necesita una imagen.`);
      if (scene.image && !scene.imageAlt) errors.push(`Describe la imagen de la escena ${index + 1}.`);
      if (scene.primaryLabel && !scene.primaryHref) errors.push(`Completa el enlace del botón de la escena ${index + 1}.`);
    });
  }

  return { ok: errors.length === 0, payload, errors };
}
