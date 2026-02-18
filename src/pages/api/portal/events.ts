import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
  ensureUserProfile,
  listUserMemberships,
  resolveEffectivePortalRole,
  resolveEffectiveChurchId,
} from '@lib/portalAuth';
import {
  canManageEventScope,
  getRoleCapabilities,
  getRoleScope,
  isNationalScopedRole,
  isRegionalScopedRole,
} from '@lib/portalRbac';
import { sanitizePlainText } from '@lib/validation';

const CUMBRE_EVENT_ID = '0b4a8ee9-3e4d-4e16-a2a9-7a62a4a0c202';
const CUMBRE_EVENT = {
  id: CUMBRE_EVENT_ID,
  title: 'Cumbre Mundial 2026',
  description: 'Encuentro global de la familia Maná.',
  scope: 'GLOBAL',
  status: 'PUBLISHED',
  start_date: '2026-06-06T09:00:00-05:00',
  end_date: '2026-06-08T18:00:00-05:00',
  location_name: 'Rionegro, Colombia',
  location_address: 'Rionegro, Antioquia',
  city: 'Rionegro',
  country: 'Colombia',
  banner_url: '/images/cumbre/fishermen-bg-highres.jpg',
};

type EventActorContext = {
  ok: boolean;
  status: number;
  error: string;
  role: string;
  scope: string;
  userId: string | null;
  isAdmin: boolean;
  isPasswordSession: boolean;
  country: string | null;
  churchId: string | null;
  isNational: boolean;
  isRegional: boolean;
  regionIds: string[];
  capabilities: ReturnType<typeof getRoleCapabilities>;
};

async function ensureCumbreEvent(userId?: string | null) {
  if (!supabaseAdmin) return;
  const { data: existing, error } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('id', CUMBRE_EVENT_ID)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') return;
    console.error('Cumbre seed error:', error);
    return;
  }
  if (existing?.id) return;

  const { error: insertError } = await supabaseAdmin
    .from('events')
    .insert({ ...CUMBRE_EVENT, created_by: userId ?? null });
  if (insertError) {
    console.error('Cumbre seed insert error:', insertError);
  }
}

const EVENT_FIELDS = [
  'title',
  'description',
  'start_date',
  'end_date',
  'scope',
  'location_name',
  'location_address',
  'city',
  'country',
  'banner_url',
  'status',
];

function sanitizeEventPayload(body: Record<string, any>) {
  const payload: Record<string, any> = {};
  EVENT_FIELDS.forEach((field) => {
    const value = body?.[field];
    if (value === undefined || value === '') return;
    if (field === 'banner_url') {
      const raw = String(value || '').trim();
      const safeUrl = raw.startsWith('/') || raw.startsWith('https://') || raw.startsWith('http://') ? raw : '';
      if (safeUrl) {
        payload[field] = safeUrl;
      }
      return;
    }
    const maxLength = field === 'description' ? 600 : 160;
    const safeValue = sanitizePlainText(String(value ?? ''), maxLength);
    if (safeValue) payload[field] = safeValue;
  });
  if (payload.scope) payload.scope = String(payload.scope).toUpperCase();
  if (payload.status) payload.status = String(payload.status).toUpperCase();
  return payload;
}

function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function isChurchInCountry(churchId: string, country: string | null): Promise<boolean> {
  if (!supabaseAdmin || !churchId || !country) return false;
  const { data: church } = await supabaseAdmin
    .from('churches')
    .select('id, country')
    .eq('id', churchId)
    .maybeSingle();
  return Boolean(church?.id && church.country === country);
}

async function resolveRegionalScope(userId: string, profileRegionId: string | null | undefined): Promise<string[]> {
  const fromProfile = profileRegionId ? [profileRegionId] : [];
  if (!supabaseAdmin) return fromProfile;

  const { data, error } = await supabaseAdmin
    .from('region_leadership_assignments')
    .select('region_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return fromProfile;
    }
    console.error('[portal.events] regional assignments error', error);
    return fromProfile;
  }

  const fromAssignments = (data || [])
    .map((row: any) => String(row?.region_id || '').trim())
    .filter(Boolean);

  return Array.from(new Set([...fromProfile, ...fromAssignments]));
}

async function isChurchInRegions(churchId: string, regionIds: string[], fallbackCountry?: string | null): Promise<boolean> {
  if (!supabaseAdmin || !churchId || !regionIds.length) return false;

  let { data: church, error } = await supabaseAdmin
    .from('churches')
    .select('id, region_id, country')
    .eq('id', churchId)
    .maybeSingle();

  if (error?.code === '42703') {
    const fallback = await supabaseAdmin
      .from('churches')
      .select('id, country')
      .eq('id', churchId)
      .maybeSingle();
    church = fallback.data;
    error = fallback.error;
  }

  if (error || !church?.id) return false;
  if ((church as any).region_id) {
    return regionIds.includes((church as any).region_id);
  }
  if (fallbackCountry) {
    return church.country === fallbackCountry;
  }
  return false;
}

async function getEventActorContext(request: Request): Promise<EventActorContext> {
  const user = await getUserFromRequest(request);
  if (!user?.email) {
    const passwordSession = readPasswordSession(request);
    if (!passwordSession?.email) {
      return {
        ok: false,
        status: 401,
        error: 'Unauthorized',
        role: 'user',
        scope: 'self',
        userId: null,
        isAdmin: false,
        isPasswordSession: false,
        country: null,
        churchId: null,
        isNational: false,
        isRegional: false,
        regionIds: [],
        capabilities: getRoleCapabilities('user'),
      };
    }

    return {
      ok: true,
      status: 200,
      error: '',
      role: 'superadmin',
      scope: 'global',
      userId: null,
      isAdmin: true,
      isPasswordSession: true,
      country: null,
      churchId: null,
      isNational: false,
      isRegional: false,
      regionIds: [],
      capabilities: getRoleCapabilities('superadmin'),
    };
  }

  const profile = await ensureUserProfile(user);
  if (!profile) {
    return {
      ok: false,
      status: 403,
      error: 'Profile not found',
      role: 'user',
      scope: 'self',
      userId: user.id,
      isAdmin: false,
      isPasswordSession: false,
      country: null,
      churchId: null,
      isNational: false,
      isRegional: false,
      regionIds: [],
      capabilities: getRoleCapabilities('user'),
    };
  }

  const memberships = await listUserMemberships(user.id);
  const effectiveRole = resolveEffectivePortalRole(profile.role, memberships);
  const effectiveChurchId = resolveEffectiveChurchId(
    profile.church_id || profile.portal_church_id || null,
    memberships,
  );
  const isRegional = isRegionalScopedRole(effectiveRole);
  const isNational = isNationalScopedRole(effectiveRole);
  const regionIds = isRegional ? await resolveRegionalScope(user.id, profile.region_id || null) : [];

  if (isRegional && !regionIds.length) {
    return {
      ok: false,
      status: 403,
      error: 'Sin región asignada',
      role: effectiveRole,
      scope: getRoleScope(effectiveRole),
      userId: user.id,
      isAdmin: false,
      isPasswordSession: false,
      country: profile.country || null,
      churchId: effectiveChurchId,
      isNational,
      isRegional,
      regionIds: [],
      capabilities: getRoleCapabilities(effectiveRole),
    };
  }

  return {
    ok: true,
    status: 200,
    error: '',
    role: effectiveRole,
    scope: getRoleScope(effectiveRole),
    userId: user.id,
    isAdmin: effectiveRole === 'admin' || effectiveRole === 'superadmin',
    isPasswordSession: false,
    country: profile.country || null,
    churchId: effectiveChurchId,
    isNational,
    isRegional,
    regionIds,
    capabilities: getRoleCapabilities(effectiveRole),
  };
}

export const GET: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

  const ctx = await getEventActorContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: ctx.error }), { status: ctx.status });
  }

  if (ctx.isPasswordSession) {
    await ensureCumbreEvent(null);
    const { data: events, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .order('start_date', { ascending: true });

    if (error) {
      console.error('Events Fetch Error:', error);
      if (error.code === '42P01') return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: false, error: 'Error loading events' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, events }), { status: 200 });
  }

  if (
    ctx.capabilities.can_manage_local_events
    || ctx.capabilities.can_manage_regional_events
    || ctx.capabilities.can_manage_national_events
    || ctx.capabilities.can_manage_global_events
  ) {
    await ensureCumbreEvent(ctx.userId);
  }

  let eventsQuery = supabaseAdmin
    .from('events')
    .select('*')
    .order('start_date', { ascending: true });

  if (!ctx.isAdmin) {
    const buildOrParts = async (preferRegionalColumn: boolean) => {
      const orParts = ['scope.eq.GLOBAL'];

      if (ctx.country) {
        orParts.push(`and(scope.eq.NATIONAL,country.eq.${ctx.country})`);
        if (ctx.isRegional && preferRegionalColumn && ctx.regionIds.length) {
          orParts.push(`and(scope.eq.REGIONAL,region_id.in.(${ctx.regionIds.join(',')}))`);
        } else {
          orParts.push(`and(scope.eq.REGIONAL,country.eq.${ctx.country})`);
        }
      }

      if (ctx.churchId) {
        orParts.push(`and(scope.eq.LOCAL,church_id.eq.${ctx.churchId})`);
      } else if (ctx.isNational || ctx.isRegional) {
        let churchQuery = supabaseAdmin.from('churches').select('id');
        if (ctx.isRegional && preferRegionalColumn && ctx.regionIds.length) {
          churchQuery = churchQuery.in('region_id', ctx.regionIds);
        } else if (ctx.country) {
          churchQuery = churchQuery.eq('country', ctx.country);
        }
        const { data: scopedChurches, error: churchError } = await churchQuery;
        if (churchError) {
          console.error('Events church scope error:', churchError);
        } else {
          const ids = (scopedChurches || []).map((row) => row.id).filter(Boolean);
          if (ids.length) {
            orParts.push(`and(scope.eq.LOCAL,church_id.in.(${ids.join(',')}))`);
          }
        }
      }

      if (ctx.userId) {
        orParts.push(`created_by.eq.${ctx.userId}`);
      }

      return orParts;
    };

    const primaryOrParts = await buildOrParts(true);
    eventsQuery = eventsQuery.or(primaryOrParts.join(','));
  }

  let { data: events, error } = await eventsQuery;
  if (error && error.code === '42703' && /region_id/i.test(error.message || '') && !ctx.isAdmin) {
    const fallbackOrParts = ['scope.eq.GLOBAL'];
    if (ctx.country) {
      fallbackOrParts.push(`and(scope.eq.NATIONAL,country.eq.${ctx.country})`);
      fallbackOrParts.push(`and(scope.eq.REGIONAL,country.eq.${ctx.country})`);
    }
    if (ctx.churchId) {
      fallbackOrParts.push(`and(scope.eq.LOCAL,church_id.eq.${ctx.churchId})`);
    } else if ((ctx.isNational || ctx.isRegional) && ctx.country) {
      const { data: scopedChurches } = await supabaseAdmin
        .from('churches')
        .select('id')
        .eq('country', ctx.country);
      const ids = (scopedChurches || []).map((row) => row.id).filter(Boolean);
      if (ids.length) {
        fallbackOrParts.push(`and(scope.eq.LOCAL,church_id.in.(${ids.join(',')}))`);
      }
    }
    if (ctx.userId) {
      fallbackOrParts.push(`created_by.eq.${ctx.userId}`);
    }
    const fallback = await supabaseAdmin
      .from('events')
      .select('*')
      .order('start_date', { ascending: true })
      .or(fallbackOrParts.join(','));
    events = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('Events Fetch Error:', error);
    if (error.code === '42P01') return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
    return new Response(JSON.stringify({ ok: false, error: 'Error loading events' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, events }), { status: 200 });
};

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

  const ctx = await getEventActorContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: ctx.error }), { status: ctx.status });
  }

  const body = await request.json();
  const payload = sanitizeEventPayload(body);
  const requestedChurchId = String(body?.church_id || body?.churchId || '').trim() || null;
  const requestedRegionIdRaw = String(body?.region_id || body?.regionId || '').trim() || null;
  const requestedRegionId = isUuid(requestedRegionIdRaw) ? requestedRegionIdRaw : null;

  if (!payload.title || !payload.start_date || !payload.scope) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { status: 400 });
  }

  if (!canManageEventScope(ctx.role, payload.scope)) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear eventos.' }), { status: 403 });
  }

  if (payload.scope === 'LOCAL') {
    if (ctx.isAdmin) {
      if (!requestedChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para el evento local.' }), { status: 400 });
      }
      payload.church_id = requestedChurchId;
    } else if (ctx.churchId) {
      payload.church_id = ctx.churchId;
    } else if (ctx.isRegional) {
      if (!requestedChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para el evento local.' }), { status: 400 });
      }
      if (!(await isChurchInRegions(requestedChurchId, ctx.regionIds, ctx.country))) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
      }
      payload.church_id = requestedChurchId;
    } else if (ctx.isNational) {
      if (!requestedChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para el evento local.' }), { status: 400 });
      }
      if (!(await isChurchInCountry(requestedChurchId, ctx.country))) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
      }
      payload.church_id = requestedChurchId;
    } else {
      return new Response(JSON.stringify({ ok: false, error: 'No tienes una iglesia asociada.' }), { status: 403 });
    }

    if (payload.church_id) {
      const { data: churchScope } = await supabaseAdmin
        .from('churches')
        .select('country, region_id')
        .eq('id', payload.church_id)
        .maybeSingle();
      if (churchScope) {
        payload.country = churchScope.country || payload.country || null;
        payload.region_id = (churchScope as any).region_id || null;
      }
    }
  }

  if (payload.scope === 'NATIONAL' || payload.scope === 'REGIONAL') {
    if (ctx.isRegional) {
      if (payload.scope !== 'REGIONAL') {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear eventos nacionales.' }), { status: 403 });
      }
      if (!ctx.regionIds.length) {
        return new Response(JSON.stringify({ ok: false, error: 'Sin región asignada.' }), { status: 403 });
      }
      if (requestedRegionId && !ctx.regionIds.includes(requestedRegionId)) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta región.' }), { status: 403 });
      }
      payload.region_id = requestedRegionId || ctx.regionIds[0];
      if (ctx.country) payload.country = ctx.country;
    } else if (ctx.isNational) {
      if (!ctx.country) {
        return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado.' }), { status: 403 });
      }
      if (payload.country && payload.country !== ctx.country) {
        return new Response(JSON.stringify({ ok: false, error: 'Solo puedes crear eventos para tu país.' }), { status: 403 });
      }
      payload.country = ctx.country;
      if (payload.scope === 'REGIONAL' && requestedRegionId) {
        const { data: region, error: regionError } = await supabaseAdmin
          .from('regions')
          .select('id, country')
          .eq('id', requestedRegionId)
          .maybeSingle();
        if (!regionError && region?.id && region.country === ctx.country) {
          payload.region_id = region.id;
        } else if (!regionError && !region?.id) {
          return new Response(JSON.stringify({ ok: false, error: 'Región no encontrada.' }), { status: 404 });
        } else if (!regionError) {
          return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta región.' }), { status: 403 });
        }
      }
    } else if (payload.scope === 'REGIONAL' && requestedRegionId) {
      payload.region_id = requestedRegionId;
    } else if (!payload.country) {
      payload.country = 'Colombia';
    }
    payload.church_id = null;
    if (payload.scope === 'NATIONAL') {
      payload.region_id = null;
    }
  }

  if (payload.scope === 'GLOBAL') {
    payload.country = null;
    payload.church_id = null;
    payload.region_id = null;
  }

  let { data, error } = await supabaseAdmin
    .from('events')
    .insert({
      ...payload,
      created_by: ctx.userId,
      status: 'PUBLISHED',
    })
    .select()
    .single();

  if (error && error.code === '42703' && /region_id/i.test(error.message || '')) {
    const { region_id, ...fallbackPayload } = payload as any;
    const fallback = await supabaseAdmin
      .from('events')
      .insert({
        ...fallbackPayload,
        created_by: ctx.userId,
        status: 'PUBLISHED',
      })
      .select()
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('Event Create Error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear el evento' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, event: data }), { status: 200 });
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

  const ctx = await getEventActorContext(request);
  if (!ctx.ok) {
    return new Response(JSON.stringify({ ok: false, error: ctx.error }), { status: ctx.status });
  }

  const body = await request.json();
  const eventId = body?.id ? String(body.id) : '';
  const requestedChurchId = String(body?.church_id || body?.churchId || '').trim() || null;
  const requestedRegionIdRaw = String(body?.region_id || body?.regionId || '').trim() || null;
  const requestedRegionId = isUuid(requestedRegionIdRaw) ? requestedRegionIdRaw : null;

  if (!eventId) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing event id' }), { status: 400 });
  }

  const payload = sanitizeEventPayload(body);
  if (!Object.keys(payload).length && !requestedChurchId && !requestedRegionId) {
    return new Response(JSON.stringify({ ok: false, error: 'No changes provided' }), { status: 400 });
  }

  let { data: eventRow, error: eventError } = await supabaseAdmin
    .from('events')
    .select('id, created_by, scope, church_id, country, region_id')
    .eq('id', eventId)
    .single();

  if (eventError && eventError.code === '42703' && /region_id/i.test(eventError.message || '')) {
    const fallback = await supabaseAdmin
      .from('events')
      .select('id, created_by, scope, church_id, country')
      .eq('id', eventId)
      .single();
    eventRow = fallback.data ? { ...fallback.data, region_id: null } : null;
    eventError = fallback.error;
  }

  if (eventError || !eventRow) {
    return new Response(JSON.stringify({ ok: false, error: 'Event not found' }), { status: 404 });
  }

  const canManageAnyEvents = (
    ctx.capabilities.can_manage_local_events
    || ctx.capabilities.can_manage_regional_events
    || ctx.capabilities.can_manage_national_events
    || ctx.capabilities.can_manage_global_events
  );

  if (!canManageAnyEvents) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para editar eventos.' }), { status: 403 });
  }

  if (!ctx.isAdmin) {
    let scopedAccess = eventRow.created_by === ctx.userId;

    if (!scopedAccess && eventRow.scope === 'LOCAL') {
      if (ctx.churchId && eventRow.church_id === ctx.churchId) scopedAccess = true;
      if (!scopedAccess && ctx.isRegional && eventRow.church_id) {
        scopedAccess = await isChurchInRegions(eventRow.church_id, ctx.regionIds, ctx.country);
      }
      if (!scopedAccess && ctx.isNational && eventRow.church_id) {
        scopedAccess = await isChurchInCountry(eventRow.church_id, ctx.country);
      }
    }

    if (!scopedAccess && (eventRow.scope === 'NATIONAL' || eventRow.scope === 'REGIONAL')) {
      if (ctx.isRegional && eventRow.scope === 'REGIONAL' && ctx.regionIds.length && eventRow.region_id && ctx.regionIds.includes(eventRow.region_id)) {
        scopedAccess = true;
      }
      if (!scopedAccess && ctx.isNational && ctx.country && eventRow.country === ctx.country) {
        scopedAccess = true;
      }
    }

    if (!scopedAccess) {
      return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para editar este evento.' }), { status: 403 });
    }
  }

  if (payload.scope && !canManageEventScope(ctx.role, payload.scope)) {
    return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para cambiar el alcance.' }), { status: 403 });
  }

  if ((ctx.isNational || ctx.isRegional) && payload.country && payload.country !== ctx.country) {
    return new Response(JSON.stringify({ ok: false, error: 'Solo puedes gestionar eventos de tu país.' }), { status: 403 });
  }

  const resultingScope = String(payload.scope || eventRow.scope || '').toUpperCase();

  if (resultingScope === 'GLOBAL') {
    payload.country = null;
    payload.church_id = null;
    payload.region_id = null;
  }

  if (resultingScope === 'NATIONAL' || resultingScope === 'REGIONAL') {
    if (ctx.isRegional) {
      if (resultingScope !== 'REGIONAL') {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para eventos nacionales.' }), { status: 403 });
      }
      if (!ctx.regionIds.length) {
        return new Response(JSON.stringify({ ok: false, error: 'Sin región asignada.' }), { status: 403 });
      }
      if (requestedRegionId && !ctx.regionIds.includes(requestedRegionId)) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta región.' }), { status: 403 });
      }
      payload.region_id = requestedRegionId || payload.region_id || eventRow.region_id || ctx.regionIds[0];
      payload.country = ctx.country || payload.country || eventRow.country || null;
    } else if (ctx.isNational) {
      payload.country = ctx.country;
      if (resultingScope === 'REGIONAL') {
        if (requestedRegionId) {
          const { data: region, error: regionError } = await supabaseAdmin
            .from('regions')
            .select('id, country')
            .eq('id', requestedRegionId)
            .maybeSingle();
          if (!regionError && region?.id && region.country === ctx.country) {
            payload.region_id = region.id;
          } else if (!regionError && !region?.id) {
            return new Response(JSON.stringify({ ok: false, error: 'Región no encontrada.' }), { status: 404 });
          } else if (!regionError) {
            return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta región.' }), { status: 403 });
          }
        } else if (!payload.region_id) {
          payload.region_id = eventRow.region_id || null;
        }
      } else {
        payload.region_id = null;
      }
    } else if (!payload.country) {
      payload.country = eventRow.country || 'Colombia';
      if (resultingScope !== 'REGIONAL') payload.region_id = null;
    } else if (resultingScope === 'NATIONAL') {
      payload.region_id = null;
    }
    payload.church_id = null;
  }

  if (resultingScope === 'LOCAL') {
    if (ctx.isAdmin) {
      payload.church_id = requestedChurchId || payload.church_id || eventRow.church_id;
      if (!payload.church_id) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para el evento local.' }), { status: 400 });
      }
    } else if (ctx.churchId) {
      payload.church_id = ctx.churchId;
    } else if (ctx.isRegional || ctx.isNational) {
      const targetChurchId = requestedChurchId || payload.church_id || eventRow.church_id;
      if (!targetChurchId) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para el evento local.' }), { status: 400 });
      }
      const isAllowed = ctx.isRegional
        ? await isChurchInRegions(targetChurchId, ctx.regionIds, ctx.country)
        : await isChurchInCountry(targetChurchId, ctx.country);
      if (!isAllowed) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado para esta iglesia.' }), { status: 403 });
      }
      payload.church_id = targetChurchId;
    }
    if (payload.church_id) {
      const { data: churchScope } = await supabaseAdmin
        .from('churches')
        .select('country, region_id')
        .eq('id', payload.church_id)
        .maybeSingle();
      if (churchScope) {
        payload.country = churchScope.country || payload.country || null;
        payload.region_id = (churchScope as any).region_id || null;
      }
    }
  }

  let { data, error } = await supabaseAdmin
    .from('events')
    .update(payload)
    .eq('id', eventId)
    .select('*')
    .single();

  if (error && error.code === '42703' && /region_id/i.test(error.message || '')) {
    const { region_id, ...fallbackPayload } = payload as any;
    const fallback = await supabaseAdmin
      .from('events')
      .update(fallbackPayload)
      .eq('id', eventId)
      .select('*')
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('Event Update Error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar el evento' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, event: data }), { status: 200 });
};
