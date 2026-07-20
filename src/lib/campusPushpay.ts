const PUSHPAY_SHORT_LINK_PATTERN = /^https:\/\/ppay\.co\/[A-Za-z0-9]+$/;

export function resolveCampusPushpayUrl(
  candidate: string | null | undefined,
): string | undefined {
  const value = String(candidate || '').trim();
  return PUSHPAY_SHORT_LINK_PATTERN.test(value) ? value : undefined;
}
