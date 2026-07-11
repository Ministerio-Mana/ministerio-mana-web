type MicrosoftGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string | null;
};

type MicrosoftGraphSite = {
  id: string;
  displayName?: string;
  name?: string;
  webUrl?: string;
};

export type MicrosoftGraphDrive = {
  id: string;
  name: string;
  webUrl: string | null;
  driveType: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 10_000;

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function env(key: string): string {
  return String(import.meta.env?.[key] ?? process.env?.[key] ?? '').trim();
}

function isEnabledValue(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function isMicrosoftGraphEnabled(): boolean {
  return isEnabledValue(env('MICROSOFT_GRAPH_ENABLED'));
}

export function getMicrosoftGraphConfigurationStatus(): {
  enabled: boolean;
  configured: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  const tenantId = env('MICROSOFT_GRAPH_TENANT_ID');
  const clientId = env('MICROSOFT_GRAPH_CLIENT_ID');
  if (!tenantId) missing.push('tenant_id');
  else if (!UUID_PATTERN.test(tenantId)) missing.push('tenant_id_invalid');
  if (!clientId) missing.push('client_id');
  else if (!UUID_PATTERN.test(clientId)) missing.push('client_id_invalid');
  if (!env('MICROSOFT_GRAPH_CLIENT_SECRET')) missing.push('client_secret');
  if (!env('MICROSOFT_SHAREPOINT_SITE_ID')) missing.push('sharepoint_site_id');
  return {
    enabled: isMicrosoftGraphEnabled(),
    configured: missing.length === 0,
    missing,
  };
}

function getMicrosoftGraphConfig(): MicrosoftGraphConfig | null {
  const status = getMicrosoftGraphConfigurationStatus();
  if (!status.enabled || !status.configured) return null;

  return {
    tenantId: env('MICROSOFT_GRAPH_TENANT_ID'),
    clientId: env('MICROSOFT_GRAPH_CLIENT_ID'),
    clientSecret: env('MICROSOFT_GRAPH_CLIENT_SECRET'),
    siteId: env('MICROSOFT_SHAREPOINT_SITE_ID'),
    driveId: env('MICROSOFT_SHAREPOINT_DRIVE_ID') || null,
  };
}

async function readSafeError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as any;
  const code = String(payload?.error?.code || '').trim();
  return code ? `Microsoft Graph: ${code}` : `Microsoft Graph respondió ${response.status}`;
}

async function requestAccessToken(config: MicrosoftGraphConfig): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) throw new Error(await readSafeError(response));
  const payload = await response.json().catch(() => null) as any;
  const token = String(payload?.access_token || '');
  const expiresIn = Number(payload?.expires_in || 0);
  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Microsoft no devolvió una sesión válida.');
  }

  cachedAccessToken = {
    value: token,
    expiresAt: Date.now() + Math.min(expiresIn, 3_600) * 1000,
  };
  return token;
}

async function graphGet<T>(config: MicrosoftGraphConfig, path: string, retryAuth = true): Promise<T> {
  const token = await requestAccessToken(config);
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 && retryAuth) {
    cachedAccessToken = null;
    return graphGet<T>(config, path, false);
  }
  if (!response.ok) throw new Error(await readSafeError(response));
  return response.json() as Promise<T>;
}

export async function verifyMicrosoftSharePointConnection(): Promise<{
  site: { id: string; name: string; webUrl: string | null };
  drives: MicrosoftGraphDrive[];
  selectedDriveId: string | null;
}> {
  const config = getMicrosoftGraphConfig();
  if (!config) throw new Error('La integración de Microsoft todavía no está configurada.');

  const site = await graphGet<MicrosoftGraphSite>(
    config,
    `/sites/${encodeURIComponent(config.siteId)}?$select=id,displayName,name,webUrl`,
  );
  if (site.id !== config.siteId) throw new Error('Microsoft devolvió un sitio diferente al configurado.');

  const driveResponse = await graphGet<{ value?: MicrosoftGraphDrive[] }>(
    config,
    `/sites/${encodeURIComponent(config.siteId)}/drives?$select=id,name,webUrl,driveType`,
  );
  const drives = Array.isArray(driveResponse.value)
    ? driveResponse.value.map((drive) => ({
        id: String(drive.id),
        name: String(drive.name || 'Documentos'),
        webUrl: drive.webUrl ? String(drive.webUrl) : null,
        driveType: drive.driveType ? String(drive.driveType) : null,
      }))
    : [];

  if (config.driveId && !drives.some((drive) => drive.id === config.driveId)) {
    throw new Error('La biblioteca configurada no pertenece al sitio autorizado.');
  }

  return {
    site: {
      id: site.id,
      name: String(site.displayName || site.name || 'Portal Maná'),
      webUrl: site.webUrl ? String(site.webUrl) : null,
    },
    drives,
    selectedDriveId: config.driveId,
  };
}
