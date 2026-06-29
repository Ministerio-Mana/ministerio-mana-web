const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

export function neutralizeSpreadsheetFormula(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return FORMULA_PREFIX_PATTERN.test(raw) ? `'${raw}` : raw;
}

export function csvEscape(value: unknown): string {
  const safe = neutralizeSpreadsheetFormula(value);
  if (/[,\n\r"]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function csvEscapeQuoted(value: unknown): string {
  return `"${neutralizeSpreadsheetFormula(value).replace(/"/g, '""')}"`;
}
