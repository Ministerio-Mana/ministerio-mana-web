type MicrosoftGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string | null;
  eventsDriveId: string | null;
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

export type MicrosoftGraphDriveItem = {
  id: string;
  name: string;
  webUrl: string | null;
  size: number;
  eTag: string | null;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 30_000;

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

export function isMicrosoftEventsWriteEnabled(): boolean {
  return isMicrosoftGraphEnabled() && isEnabledValue(env('MICROSOFT_SHAREPOINT_EVENTS_WRITE_ENABLED'));
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
    eventsDriveId: env('MICROSOFT_SHAREPOINT_EVENTS_DRIVE_ID') || null,
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

async function graphFetch(
  config: MicrosoftGraphConfig,
  path: string,
  init: RequestInit = {},
  retryAuth = true,
): Promise<Response> {
  const token = await requestAccessToken(config);
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    redirect: 'error',
    signal: init.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 && retryAuth) {
    cachedAccessToken = null;
    return graphFetch(config, path, init, false);
  }
  return response;
}

async function graphGet<T>(config: MicrosoftGraphConfig, path: string): Promise<T> {
  const response = await graphFetch(config, path, { method: 'GET' });
  if (!response.ok) throw new Error(await readSafeError(response));
  return response.json() as Promise<T>;
}

async function listSharePointDrives(config: MicrosoftGraphConfig): Promise<MicrosoftGraphDrive[]> {
  const driveResponse = await graphGet<{ value?: MicrosoftGraphDrive[] }>(
    config,
    `/sites/${encodeURIComponent(config.siteId)}/drives?$select=id,name,webUrl,driveType`,
  );
  return Array.isArray(driveResponse.value)
    ? driveResponse.value.map((drive) => ({
        id: String(drive.id),
        name: String(drive.name || 'Documentos'),
        webUrl: drive.webUrl ? String(drive.webUrl) : null,
        driveType: drive.driveType ? String(drive.driveType) : null,
      }))
    : [];
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

  const drives = await listSharePointDrives(config);

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

function normalizeLibraryName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function encodeGraphPath(path: string): string {
  return path.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
}

async function resolveEventsDrive(config: MicrosoftGraphConfig): Promise<MicrosoftGraphDrive> {
  const drives = await listSharePointDrives(config);
  const configured = config.eventsDriveId
    ? drives.find((drive) => drive.id === config.eventsDriveId)
    : null;
  if (config.eventsDriveId && !configured) {
    throw new Error('La biblioteca Eventos configurada no pertenece al sitio autorizado.');
  }
  if (configured) return configured;

  const matches = drives.filter((drive) => normalizeLibraryName(drive.name) === 'eventos');
  if (matches.length !== 1) {
    throw new Error('No se pudo identificar de forma única la biblioteca Eventos.');
  }
  return matches[0];
}

type GraphFolder = { id: string; name?: string; folder?: Record<string, unknown> };

async function getFolderByPath(
  config: MicrosoftGraphConfig,
  driveId: string,
  path: string,
): Promise<GraphFolder | null> {
  const response = await graphFetch(
    config,
    `/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(path)}?$select=id,name,folder`,
    { method: 'GET' },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await readSafeError(response));
  const folder = await response.json() as GraphFolder;
  if (!folder?.id || !folder.folder) throw new Error('Microsoft devolvió una carpeta inválida.');
  return folder;
}

async function createFolder(
  config: MicrosoftGraphConfig,
  driveId: string,
  parentId: string | null,
  name: string,
): Promise<GraphFolder | null> {
  const parentPath = parentId
    ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`
    : `/drives/${encodeURIComponent(driveId)}/root/children`;
  const response = await graphFetch(config, parentPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(await readSafeError(response));
  return response.json() as Promise<GraphFolder>;
}

async function ensureFolderPath(
  config: MicrosoftGraphConfig,
  driveId: string,
  parentPath: string,
  folderName: string,
  parentId: string | null,
): Promise<GraphFolder> {
  const fullPath = [parentPath, folderName].filter(Boolean).join('/');
  const existing = await getFolderByPath(config, driveId, fullPath);
  if (existing) return existing;
  const created = await createFolder(config, driveId, parentId, folderName);
  if (created?.id) return created;
  const raced = await getFolderByPath(config, driveId, fullPath);
  if (!raced) throw new Error('No se pudo preparar la carpeta del evento.');
  return raced;
}

function normalizeDriveItem(item: any): MicrosoftGraphDriveItem {
  return {
    id: String(item?.id || ''),
    name: String(item?.name || ''),
    webUrl: item?.webUrl ? String(item.webUrl) : null,
    size: Number(item?.size || 0),
    eTag: item?.eTag ? String(item.eTag) : null,
    createdDateTime: item?.createdDateTime ? String(item.createdDateTime) : null,
    lastModifiedDateTime: item?.lastModifiedDateTime ? String(item.lastModifiedDateTime) : null,
  };
}

export async function uploadMicrosoftEventDocument(params: {
  eventFolder: string;
  fileName: string;
  contentType: string;
  content: Uint8Array;
}): Promise<{ drive: MicrosoftGraphDrive; item: MicrosoftGraphDriveItem }> {
  const config = getMicrosoftGraphConfig();
  if (!config || !isMicrosoftEventsWriteEnabled()) {
    throw new Error('Las cargas de eventos todavía no están habilitadas.');
  }
  const drive = await resolveEventsDrive(config);
  const rootFolder = await ensureFolderPath(config, drive.id, '', 'Portal Eventos', null);
  const eventFolder = await ensureFolderPath(
    config,
    drive.id,
    'Portal Eventos',
    params.eventFolder,
    rootFolder.id,
  );
  const uploadBody = params.content.buffer.slice(
    params.content.byteOffset,
    params.content.byteOffset + params.content.byteLength,
  ) as ArrayBuffer;
  const response = await graphFetch(
    config,
    `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(eventFolder.id)}:/${encodeURIComponent(params.fileName)}:/content`,
    {
      method: 'PUT',
      headers: { 'content-type': params.contentType },
      body: uploadBody,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(await readSafeError(response));
  const item = normalizeDriveItem(await response.json());
  if (!item.id || !item.name) throw new Error('Microsoft no confirmó el archivo cargado.');
  return { drive, item };
}

export async function deleteMicrosoftEventDocument(driveId: string, itemId: string): Promise<void> {
  const config = getMicrosoftGraphConfig();
  if (!config || !isMicrosoftEventsWriteEnabled()) return;
  const drive = await resolveEventsDrive(config);
  if (drive.id !== driveId) throw new Error('La biblioteca solicitada no está autorizada.');
  const response = await graphFetch(
    config,
    `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) throw new Error(await readSafeError(response));
}

export async function downloadMicrosoftEventDocument(params: {
  driveId: string;
  itemId: string;
}): Promise<Uint8Array> {
  const config = getMicrosoftGraphConfig();
  if (!config || !isMicrosoftGraphEnabled()) {
    throw new Error('La integración de Microsoft todavía no está configurada.');
  }
  const drive = await resolveEventsDrive(config);
  if (drive.id !== params.driveId) throw new Error('La biblioteca solicitada no está autorizada.');

  const itemResponse = await graphFetch(
    config,
    `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(params.itemId)}?$select=id,file,@microsoft.graph.downloadUrl`,
    { method: 'GET' },
  );
  if (!itemResponse.ok) throw new Error(await readSafeError(itemResponse));
  const item = await itemResponse.json() as Record<string, unknown>;
  const downloadUrl = String(item['@microsoft.graph.downloadUrl'] || '');
  if (!downloadUrl.startsWith('https://')) throw new Error('Microsoft no devolvió un enlace de descarga válido.');

  const response = await fetch(downloadUrl, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Microsoft no pudo descargar la imagen (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
