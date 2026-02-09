import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';

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
        payload[field] = value;
    });
    if (payload.scope) payload.scope = String(payload.scope).toUpperCase();
    if (payload.status) payload.status = String(payload.status).toUpperCase();
    return payload;
}

export const GET: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
    }

    if (passwordSession) {
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

    // Get User Profile for Scoping
    const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('church_id, country, city, role')
        .eq('user_id', user.id)
        .single();

    if (!profile) {
        return new Response(JSON.stringify({ ok: false, error: 'Profile not found' }), { status: 403 });
    }

    if (['superadmin', 'admin', 'national_pastor', 'pastor'].includes(profile.role || '')) {
        await ensureCumbreEvent(user.id);
    }

    // Build Query manually for Scoping (since admin bypasses RLS)
    // Logic: 
    // 1. All GLOBAL events
    // 2. NATIONAL events matching profile.country
    // 3. LOCAL events matching profile.church_id
    // 4. (Optional) Created by me (handled if I am admin/pastor)

    // Supabase OR syntax: or=(scope.eq.GLOBAL,and(scope.eq.NATIONAL,country.eq.Colomb...),...)
    // Constructing complex OR filter string

    let orFilter = `scope.eq.GLOBAL`;

    if (profile.country) {
        orFilter += `,and(scope.eq.NATIONAL,country.eq.${profile.country})`;
    }

    if (profile.church_id) {
        orFilter += `,and(scope.eq.LOCAL,church_id.eq.${profile.church_id})`;
    } else {
        // If no church_id, maybe show only global? 
        // If Local events exist without church_id (error state), don't show.
    }

    // Also showing events created by user?
    orFilter += `,created_by.eq.${user.id}`;

    const { data: events, error } = await supabaseAdmin
        .from('events')
        .select('*')
        .or(orFilter)
        .order('start_date', { ascending: true });

    if (error) {
        console.error('Events Fetch Error:', error);
        // Return empty if table doesn't exist yet (graceful degradation)
        if (error.code === '42P01') return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
        return new Response(JSON.stringify({ ok: false, error: 'Error loading events' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, events }), { status: 200 });
};

export const POST: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    const body = await request.json();
    const payload = sanitizeEventPayload(body);

    // Validation
    if (!payload.title || !payload.start_date || !payload.scope) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { status: 400 });
    }

    // Get Profile
    const { data: profile } = user
        ? await supabaseAdmin
            .from('user_profiles')
            .select('church_id, role, country, city')
            .eq('user_id', user.id)
            .single()
        : { data: { role: 'superadmin' } };

    // Scope enforcement
    if (payload.scope === 'LOCAL' && user) {
        if (!profile?.church_id) {
            return new Response(JSON.stringify({ ok: false, error: 'No tienes una iglesia asociada.' }), { status: 403 });
        }
        payload.church_id = profile.church_id;
        // Clear location fields that might conflict or use them as manual
        // body.city = profile.city; 
    } else if (payload.scope === 'NATIONAL' || payload.scope === 'GLOBAL') {
        // Only Admin/Superadmin/Pastor(maybe?) can create National/Global?
        // Assuming Pastors can only create LOCAL events.
        const allowedRoles = ['admin', 'superadmin'];
        if (!allowedRoles.includes(profile?.role || 'user')) {
            return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para crear eventos Globales/Nacionales.' }), { status: 403 });
        }

        if (payload.scope === 'NATIONAL' && !payload.country) {
            payload.country = profile?.country || 'Colombia';
        }
    }

    const { data, error } = await supabaseAdmin
        .from('events')
        .insert({
            ...payload,
            created_by: user?.id ?? null,
            status: 'PUBLISHED' // Defaulting to Published for MVP
        })
        .select()
        .single();

    if (error) {
        console.error('Event Create Error:', error);
        return new Response(JSON.stringify({ ok: false, error: 'No se pudo crear el evento' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, event: data }), { status: 200 });
};

export const PATCH: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) return new Response(JSON.stringify({ ok: false, error: 'Server Config Error' }), { status: 500 });

    const user = await getUserFromRequest(request);
    const passwordSession = user ? null : readPasswordSession(request);
    if (!user && !passwordSession) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });

    const body = await request.json();
    const eventId = body?.id ? String(body.id) : '';
    if (!eventId) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing event id' }), { status: 400 });
    }

    const payload = sanitizeEventPayload(body);
    if (!Object.keys(payload).length) {
        return new Response(JSON.stringify({ ok: false, error: 'No changes provided' }), { status: 400 });
    }

    const { data: eventRow, error: eventError } = await supabaseAdmin
        .from('events')
        .select('id, created_by, scope, church_id, country')
        .eq('id', eventId)
        .single();

    if (eventError || !eventRow) {
        return new Response(JSON.stringify({ ok: false, error: 'Event not found' }), { status: 404 });
    }

    const { data: profile } = user
        ? await supabaseAdmin
            .from('user_profiles')
            .select('church_id, role, country')
            .eq('user_id', user.id)
            .single()
        : { data: { role: 'superadmin' } };

    const role = profile?.role || 'user';
    const isAdmin = ['admin', 'superadmin'].includes(role);
    const canManage = isAdmin || ['national_pastor', 'pastor'].includes(role);

    if (!canManage && !passwordSession) {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para editar eventos.' }), { status: 403 });
    }

    if (!isAdmin && user) {
        const isOwner = eventRow.created_by === user.id;
        const sameChurch = eventRow.scope === 'LOCAL'
            && profile?.church_id
            && eventRow.church_id === profile.church_id;
        if (!isOwner && !sameChurch) {
            return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para editar este evento.' }), { status: 403 });
        }
    }

    if ((payload.scope === 'NATIONAL' || payload.scope === 'GLOBAL') && !isAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para cambiar el alcance.' }), { status: 403 });
    }

    if (payload.scope === 'LOCAL' && user) {
        if (!profile?.church_id) {
            return new Response(JSON.stringify({ ok: false, error: 'No tienes una iglesia asociada.' }), { status: 403 });
        }
        payload.church_id = profile.church_id;
    }

    if (payload.scope === 'NATIONAL' && !payload.country) {
        payload.country = profile?.country || eventRow.country || 'Colombia';
    }

    const { data, error } = await supabaseAdmin
        .from('events')
        .update(payload)
        .eq('id', eventId)
        .select('*')
        .single();

    if (error) {
        console.error('Event Update Error:', error);
        return new Response(JSON.stringify({ ok: false, error: 'No se pudo actualizar el evento' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, event: data }), { status: 200 });
};
