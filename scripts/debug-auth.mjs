
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load envs
const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });
else if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

console.log('Loaded envs:');
console.log('SUPABASE_URL length:', url?.length);
console.log('SUPABASE_KEY length:', key?.length);
console.log('SUPABASE_SERVICE_ROLE length:', process.env.SUPABASE_SERVICE_ROLE?.length);

if (!url || !key) {
    console.error('Missing env vars.');
    process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
    const email = 'santiquilva@gmail.com';
    console.log(`Checking user: ${email}...`);

    // 1. Check if user exists
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    // Note: listUsers() paginates, but we just want to see if we can find this user.
    // Better: getUserById if we had ID, but we have email.
    // Admin listUsers doesn't filter by email easily in JS client versions sometimes without specific params?
    // Actually, createClient allows listUsers() but filtering by email isn't always direct in old versions.
    // Let's iterate or search.

    // Actually, newer supabase-js allows admin.getUserByEmail? No, usually getUserById.
    // Let's try to generate the link directly and see what happens.

    console.log('Attempting generateLink(magiclink)...');
    const { data, error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
            redirectTo: 'https://ministeriomana.org/portal/activar?next=%2Fportal'
        }
    });

    console.log('GenerateLink Result:');
    console.log('Error:', error);
    console.log('Data:', JSON.stringify(data, null, 2));

    if (!error && !data.action_link) {
        console.log('WARNING: Success reported but no link. This usually means user not found or configuration issue.');
    }
}

main().catch(console.error);
