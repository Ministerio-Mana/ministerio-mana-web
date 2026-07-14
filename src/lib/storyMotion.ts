export type StaticStoryModeInput = {
  reducedMotion: boolean;
  staticMobile: boolean;
  viewportWidth: number;
  staticBreakpoint: number;
};

export const STORY_MOTION_PRESETS = {
  calm: {
    scrollFactor: 1.08,
    scrub: 0.72,
    sweepDuration: 0.46,
    snapMinDuration: 0.16,
    snapMaxDuration: 0.34,
    snapDelay: 0.05,
  },
  editorial: {
    scrollFactor: 1.2,
    scrub: 0.9,
    sweepDuration: 0.52,
    snapMinDuration: 0.18,
    snapMaxDuration: 0.42,
    snapDelay: 0.06,
  },
  cinematic: {
    scrollFactor: 1.34,
    scrub: 1.05,
    sweepDuration: 0.56,
    snapMinDuration: 0.22,
    snapMaxDuration: 0.5,
    snapDelay: 0.07,
  },
} as const;

export type StoryMotionPresetName = keyof typeof STORY_MOTION_PRESETS;
export type StoryMotionConfig = {
  preset: StoryMotionPresetName;
  scrollFactor: number;
  scrub: number;
  sweepDuration: number;
  snapMinDuration: number;
  snapMaxDuration: number;
  snapDelay: number;
};

const STORY_MOTION_LIMITS = {
  scrollFactor: [1, 1.6],
  scrub: [0.4, 1.6],
  sweepDuration: [0.3, 0.8],
  snapMinDuration: [0.1, 0.5],
  snapMaxDuration: [0.2, 0.8],
  snapDelay: [0, 0.2],
} as const;

function clampMotionValue(
  value: unknown,
  fallback: number,
  [minimum, maximum]: readonly [number, number],
): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function isStoryMotionPreset(value: unknown): value is StoryMotionPresetName {
  return typeof value === 'string' && value in STORY_MOTION_PRESETS;
}

export function resolveStoryMotionConfig(
  requestedPreset: unknown,
  overrides: Partial<Omit<StoryMotionConfig, 'preset'>> = {},
): StoryMotionConfig {
  const preset = isStoryMotionPreset(requestedPreset) ? requestedPreset : 'editorial';
  const defaults = STORY_MOTION_PRESETS[preset];

  const config: StoryMotionConfig = {
    preset,
    scrollFactor: clampMotionValue(overrides.scrollFactor, defaults.scrollFactor, STORY_MOTION_LIMITS.scrollFactor),
    scrub: clampMotionValue(overrides.scrub, defaults.scrub, STORY_MOTION_LIMITS.scrub),
    sweepDuration: clampMotionValue(overrides.sweepDuration, defaults.sweepDuration, STORY_MOTION_LIMITS.sweepDuration),
    snapMinDuration: clampMotionValue(
      overrides.snapMinDuration,
      defaults.snapMinDuration,
      STORY_MOTION_LIMITS.snapMinDuration,
    ),
    snapMaxDuration: clampMotionValue(
      overrides.snapMaxDuration,
      defaults.snapMaxDuration,
      STORY_MOTION_LIMITS.snapMaxDuration,
    ),
    snapDelay: clampMotionValue(overrides.snapDelay, defaults.snapDelay, STORY_MOTION_LIMITS.snapDelay),
  };

  if (config.snapMaxDuration < config.snapMinDuration) {
    config.snapMaxDuration = config.snapMinDuration;
  }

  return config;
}

export function storySnapPoint(progress: number, panelCount: number): number {
  const safeProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const steps = Math.max(1, Math.floor(panelCount) - 1);
  return Math.round(safeProgress * steps) / steps;
}

export function shouldUseStaticStory({
  reducedMotion,
  staticMobile,
  viewportWidth,
  staticBreakpoint,
}: StaticStoryModeInput): boolean {
  return reducedMotion || (staticMobile && viewportWidth < staticBreakpoint);
}

export function mobileRevealDelay(index: number, stepMs = 45, maxSteps = 5): string {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return `${Math.min(safeIndex, maxSteps) * stepMs}ms`;
}
