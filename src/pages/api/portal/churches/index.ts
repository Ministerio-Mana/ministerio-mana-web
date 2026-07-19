export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { isAssignablePortalChurch } from '@lib/portalGeography';

const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL) as string;
const supabaseKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY) as string;

export const GET: APIRoute = async () => {
    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ error: 'No se pudo cargar el listado de iglesias' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
        });
    }

    const sb = createClient(supabaseUrl, supabaseKey);

    let { data, error } = await sb
        .from('churches')
        .select('id, name, city, country, region_id, continent, address, maps_url, lat, lng, lifecycle_status')
        .order('continent', { ascending: true, nullsFirst: false })
        .order('country', { ascending: true, nullsFirst: false })
        .order('city', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

    // Backward compatibility for environments where "continent" migration is not applied yet.
    if (error?.code === '42703' && /continent/i.test(error?.message || '')) {
        const legacyResult = await sb
            .from('churches')
            .select('id, name, city, country, region_id, address, maps_url, lat, lng')
            .order('country', { ascending: true, nullsFirst: false })
            .order('city', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true });
        data = legacyResult.data;
        error = legacyResult.error;
    }

    // Backward compatibility for environments where "region_id" migration is not applied yet.
    if (error?.code === '42703' && /region_id/i.test(error?.message || '')) {
        const legacyNoRegion = await sb
            .from('churches')
            .select('id, name, city, country, address, maps_url, lat, lng')
            .order('country', { ascending: true, nullsFirst: false })
            .order('city', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true });
        data = legacyNoRegion.data;
        error = legacyNoRegion.error;
    }

    if (error) {
        console.error('[portal.churches] query failed', {
            code: error.code,
            message: error.message,
        });
        return new Response(JSON.stringify({ error: 'No se pudo cargar el listado de iglesias' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
        });
    }

    return new Response(JSON.stringify((data || []).filter(isAssignablePortalChurch)), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store, max-age=0',
        },
    });
};
