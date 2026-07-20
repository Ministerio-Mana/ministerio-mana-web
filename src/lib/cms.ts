import { supabaseAdmin } from '@lib/supabaseAdmin';

export const CMS_PAGE_STATUSES = ['draft', 'published', 'archived'] as const;
export const CMS_SECTION_STATUSES = ['draft', 'published', 'archived'] as const;
export const CMS_SECTION_KINDS = ['hero', 'story', 'rich_text', 'gallery', 'cta', 'video', 'cards', 'promotion', 'custom'] as const;

export type CmsPageStatus = (typeof CMS_PAGE_STATUSES)[number];
export type CmsSectionStatus = (typeof CMS_SECTION_STATUSES)[number];
export type CmsSectionKind = (typeof CMS_SECTION_KINDS)[number];

export function parseJsonBody<T = Record<string, any>>(raw: string | null | undefined): T {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function normalizeKey(input: string | null | undefined, maxLength = 80): string {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLength);
  return cleaned;
}

export function normalizeRoutePath(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return '/';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.replace(/\s+/g, '-').replace(/\/+/g, '/').slice(0, 180);
}

export function cleanText(input: string | null | undefined, maxLength = 160): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function clampPosition(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function isPageStatus(value: string | null | undefined): value is CmsPageStatus {
  return CMS_PAGE_STATUSES.includes(String(value || '') as CmsPageStatus);
}

export function isSectionStatus(value: string | null | undefined): value is CmsSectionStatus {
  return CMS_SECTION_STATUSES.includes(String(value || '') as CmsSectionStatus);
}

export function isSectionKind(value: string | null | undefined): value is CmsSectionKind {
  return CMS_SECTION_KINDS.includes(String(value || '') as CmsSectionKind);
}

export function isCmsSchemaMissingError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || (message.includes('cms_') && (
      message.includes('does not exist')
      || message.includes('schema cache')
      || message.includes('could not find')
    ))
  );
}

export async function insertCmsRevision(params: {
  entityType: 'page' | 'section';
  entityId: string;
  pageId?: string | null;
  action: 'create' | 'update' | 'publish' | 'unpublish' | 'delete' | 'reorder';
  snapshot: Record<string, any>;
  actorUserId?: string | null;
}) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('cms_revisions').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    page_id: params.pageId ?? null,
    action: params.action,
    snapshot: params.snapshot,
    created_by: params.actorUserId ?? null,
  });
}

export async function insertCmsAuditLog(params: {
  action: string;
  entityType: 'page' | 'section' | 'system';
  entityId?: string | null;
  pageId?: string | null;
  meta?: Record<string, any>;
  actorUserId?: string | null;
  actorEmail?: string | null;
  requestIp?: string | null;
}) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('cms_audit_logs').insert({
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    page_id: params.pageId ?? null,
    meta: params.meta ?? {},
    actor_user_id: params.actorUserId ?? null,
    actor_email: params.actorEmail ?? null,
    request_ip: params.requestIp ?? null,
  });
}
