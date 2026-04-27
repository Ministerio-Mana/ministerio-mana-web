import { supabaseAdmin } from '@lib/supabaseAdmin';

function getPreviewToken(): string {
  return String(import.meta.env.CMS_PREVIEW_TOKEN || process.env.CMS_PREVIEW_TOKEN || '').trim();
}

function normalizeRoutePath(routePath: string | null | undefined): string {
  const raw = String(routePath || '').trim();
  if (!raw) return '/';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.replace(/\/+/g, '/');
}

export function hasValidCmsPreviewToken(candidate: string | null | undefined): boolean {
  const expected = getPreviewToken();
  if (!expected) return false;
  return String(candidate || '').trim() === expected;
}

export async function getCmsPageByRoute(params: {
  routePath: string;
  previewToken?: string | null;
}) {
  if (!supabaseAdmin) return null;

  const routePath = normalizeRoutePath(params.routePath);
  const isPreview = hasValidCmsPreviewToken(params.previewToken);

  let pageQuery = supabaseAdmin
    .from('cms_pages')
    .select('*')
    .eq('route_path', routePath)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (!isPreview) {
    pageQuery = pageQuery.eq('status', 'published');
  }

  const { data: pages, error: pageError } = await pageQuery;
  if (pageError || !pages?.length) return null;

  const page = pages[0] as any;

  let sectionsQuery = supabaseAdmin
    .from('cms_sections')
    .select('*')
    .eq('page_id', page.id)
    .order('position', { ascending: true });

  if (!isPreview) {
    sectionsQuery = sectionsQuery.eq('status', 'published');
  } else {
    sectionsQuery = sectionsQuery.neq('status', 'archived');
  }

  const { data: sections } = await sectionsQuery;

  return {
    page,
    sections: (sections ?? []) as any[],
    isPreview,
  };
}
