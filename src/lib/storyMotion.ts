export type StaticStoryModeInput = {
  reducedMotion: boolean;
  staticMobile: boolean;
  viewportWidth: number;
  staticBreakpoint: number;
};

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
