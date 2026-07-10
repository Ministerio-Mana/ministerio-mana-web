import { enforcePortalAdminGuard, type PortalAdminGuardResult } from '@lib/portalAdminGuard';

export type CmsAdminContext = PortalAdminGuardResult;

export async function requireCmsAdmin(params: {
  request: Request;
  clientAddress?: string | null;
  identifier: string;
}): Promise<CmsAdminContext> {
  return enforcePortalAdminGuard({
    request: params.request,
    clientAddress: params.clientAddress ?? undefined,
    identifier: params.identifier,
  });
}

export function jsonResponse(payload: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
