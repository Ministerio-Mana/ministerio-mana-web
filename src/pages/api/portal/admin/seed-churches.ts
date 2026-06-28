export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import churchesData from '../../../../data/churches.json';
import { enforceAdminIp } from '@lib/adminIpAllowlist';
import { getSafeMapsUrl } from '@lib/mapsUrl';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCodePart(value: string): string {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
    const ipCheck = await enforceAdminIp({
        request,
        clientAddress,
        identifier: 'portal.admin.seed-churches',
        allowlistKeys: ['PORTAL_ADMIN_IP_ALLOWLIST', 'ADMIN_IP_ALLOWLIST'],
    });
    if (!ipCheck.ok) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
        });
    }

    if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ error: 'Server misconfiguration: Missing DB keys' }), { status: 500 });
    }

    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Security Check: Verify Auth Token & Role
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Invalid Token' }), { status: 401 });
    }

    // Check Role in user_profiles
    const { data: profile } = await sb
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

    if (profile?.role !== 'superadmin' && profile?.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: Admins only' }), { status: 403 });
    }

    // 2. Perform Seeding
    let created = 0;
    let updated = 0;
    let errors = [];

    for (const church of churchesData as any[]) {
        const country = church.country || 'Colombia';
        const continent = church.continent || null;
        const city = church.city || null;
        const code = normalizeCodePart(`${country}-${city || 'sin-ciudad'}-${church.name}`);
        const payload = {
            code,
            name: church.name,
            city,
            country,
            continent,
            address: church.address,
            maps_url: getSafeMapsUrl(church.maps_url),
            lat: typeof church.lat === 'number' ? church.lat : null,
            lng: typeof church.lng === 'number' ? church.lng : null,
            contact_name: church.contact?.name || null,
            contact_email: church.contact?.email || null,
            contact_phone: church.contact?.phone || church.whatsapp || null,
        };

        // Try to find existing by deterministic code; fallback by name+country+city
        const { data: existingByCode } = await sb
            .from('churches')
            .select('id')
            .eq('code', code)
            .maybeSingle();
        let existing = existingByCode;
        if (!existing) {
            let query = sb
                .from('churches')
                .select('id')
                .eq('name', church.name)
                .eq('country', country);
            query = city ? query.eq('city', city) : query.is('city', null);
            const { data: existingByName } = await query.maybeSingle();
            existing = existingByName;
        }

        if (existing) {
            const { error } = await sb
                .from('churches')
                .update(payload)
                .eq('id', existing.id);
            if (error) errors.push(`${church.name} (Update): ${error.message}`);
            else updated++;
        } else {
            const { error } = await sb
                .from('churches')
                .insert(payload);
            if (error) errors.push(`${church.name} (Insert): ${error.message}`);
            else created++;
        }
    }

    return new Response(JSON.stringify({
        ok: true,
        message: `Seeding Complete. Created: ${created}, Updated: ${updated}`,
        errors
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
