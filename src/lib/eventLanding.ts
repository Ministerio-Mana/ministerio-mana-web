export type EventLandingSettings = {
  what_to_expect: string;
  agenda: string;
  practical_info: string;
  host_info: string;
};

function normalizeLongText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

export function normalizeEventLandingSettings(value: unknown): EventLandingSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    what_to_expect: normalizeLongText(input.what_to_expect || input.whatToExpect, 1200),
    agenda: normalizeLongText(input.agenda, 1600),
    practical_info: normalizeLongText(input.practical_info || input.practicalInfo, 1200),
    host_info: normalizeLongText(input.host_info || input.hostInfo, 900),
  };
}

export function hasEventLandingContent(value: unknown): boolean {
  return Object.values(normalizeEventLandingSettings(value)).some(Boolean);
}
