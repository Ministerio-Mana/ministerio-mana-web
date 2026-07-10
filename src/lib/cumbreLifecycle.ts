const DEFAULT_CUMBRE_REGISTRATION_CLOSED_AT = '2026-06-09T00:00:00-05:00';

function env(key: string): string | undefined {
  return import.meta.env?.[key] ?? process.env?.[key];
}

export function isCumbreRegistrationClosed(now = new Date()): boolean {
  const configured = env('CUMBRE_REGISTRATION_CLOSED_AT') || DEFAULT_CUMBRE_REGISTRATION_CLOSED_AT;
  const closedAt = new Date(configured);
  if (Number.isNaN(closedAt.getTime())) return true;
  return now.getTime() >= closedAt.getTime();
}

export function cumbreRegistrationClosedResponse(): Response {
  return new Response(JSON.stringify({
    ok: false,
    code: 'EVENT_CLOSED',
    error: 'La Cumbre Mundial 2026 ya finalizó y no recibe nuevas inscripciones.',
  }), {
    status: 410,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}
