export function resolveWebhookFailureTransition(params: {
  status: string | null | undefined;
  providerReference: string | null | undefined;
  incomingReference: string | null | undefined;
  attemptCount: number | null | undefined;
}): { shouldUpdate: boolean; nextAttemptCount: number } {
  const currentStatus = String(params.status || '').toUpperCase();
  const storedReference = String(params.providerReference || '').trim();
  const incomingReference = String(params.incomingReference || '').trim();
  const attemptCount = Math.max(Number(params.attemptCount || 0), 0);
  const duplicateFailure = currentStatus === 'FAILED'
    && Boolean(storedReference)
    && storedReference === incomingReference;

  return {
    shouldUpdate: !duplicateFailure,
    nextAttemptCount: duplicateFailure ? attemptCount : attemptCount + 1,
  };
}
