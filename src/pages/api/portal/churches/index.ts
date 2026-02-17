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

    const { data, error } = await sb
        .from('churches')
        .select('id, name, city, country, continent, address, maps_url, lat, lng')
        .order('continent', { ascending: true, nullsFirst: false })
        .order('country', { ascending: true, nullsFirst: false })
        .order('city', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
        },
    });
};
