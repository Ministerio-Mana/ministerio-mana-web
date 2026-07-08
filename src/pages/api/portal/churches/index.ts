export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL) as string;
const supabaseKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY) as string;

export const GET: APIRoute = async () => {
    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ error: 'Missing DB configuration' }), { status: 500 });
    }

    const sb = createClient(supabaseUrl, supabaseKey);

    let { data, error } = await sb
        .from('churches')
        .select('id, name, city, country, region_id, continent, address, maps_url, lat, lng')
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
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        },
    });
};
