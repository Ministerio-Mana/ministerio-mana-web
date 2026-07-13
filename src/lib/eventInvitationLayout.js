export const EVENT_INVITATION_LAYOUTS = Object.freeze(['HORIZONTAL', 'SQUARE', 'VERTICAL']);

export function normalizeEventInvitationLayout(value, fallback = 'HORIZONTAL') {
  const layout = String(value || '').trim().toUpperCase();
  return EVENT_INVITATION_LAYOUTS.includes(layout) ? layout : fallback;
}

export function getEventInvitationLayout(width, height) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    return 'HORIZONTAL';
  }
  const ratio = safeWidth / safeHeight;
  if (ratio >= 1.25) return 'HORIZONTAL';
  if (ratio >= 0.9) return 'SQUARE';
  return 'VERTICAL';
}

export function getEventInvitationBounds(layout) {
  switch (normalizeEventInvitationLayout(layout)) {
    case 'SQUARE': return { width: 1200, height: 1200 };
    case 'VERTICAL': return { width: 1080, height: 1350 };
    default: return { width: 1600, height: 1200 };
  }
}
