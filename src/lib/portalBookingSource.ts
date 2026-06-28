export const PORTAL_IGLESIA_BOOKING_SOURCE = 'portal-iglesia';

export function isPortalIglesiaBooking(booking: unknown): boolean {
  const source = String((booking as any)?.source || '').trim().toLowerCase();
  return source === PORTAL_IGLESIA_BOOKING_SOURCE;
}

export function restrictToPortalIglesiaBookings<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  includeAllSources = false,
): T {
  return includeAllSources ? query : query.eq('source', PORTAL_IGLESIA_BOOKING_SOURCE);
}
