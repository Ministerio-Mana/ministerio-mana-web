import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
// unexpected behavior with relative paths in different execution contexts
const envPath = path.resolve(process.cwd(), '.env.local');
const envPathDefault = path.resolve(process.cwd(), '.env');

console.log('Loading env from:', envPath);
dotenv.config({ path: envPath });
dotenv.config({ path: envPathDefault });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Missing Supabase credentials.');
    console.error('Checked for: PUBLIC_SUPABASE_URL, SUPABASE_URL');
    console.error('Checked for: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedChurches() {
    const jsonPath = path.join(__dirname, '../src/data/churches.json');
    const rawData = fs.readFileSync(jsonPath, 'utf-8');
    const churches = JSON.parse(rawData);

    console.log(`Found ${churches.length} churches in JSON.`);

    for (const church of churches) {
        const payload = {
            name: church.name,
            city: church.city,
            country: 'Colombia', // Default for now, as JSON implies Colombia
            address: church.address,
            lat: church.lat,
            lng: church.lng,
            contact_name: church.contact?.name,
            contact_email: church.contact?.email,
            contact_phone: church.contact?.phone || church.whatsapp,
        };

        // Upsert matching on name
        // Note: We need a unique constraint on 'name' or we use ID. 
        // Since we don't have IDs in JSON, we'll try to match by name if possible, 
        // or we just insert. Upsert works if we specify onConflict. 
        // But 'name' might not be unique in DB schema constraint yet.
        // Let's check first if it exists.

        // Check if exists
        const { data: existing } = await supabase
            .from('churches')
            .select('id')
            .eq('name', church.name)
            .single();

        if (existing) {
            console.log(`Updating ${church.name}...`);
            const { error } = await supabase
                .from('churches')
                .update(payload)
                .eq('id', existing.id);

            if (error) console.error(`Error updating ${church.name}:`, error);
        } else {
            console.log(`Creating ${church.name}...`);
            const { error } = await supabase
                .from('churches')
                .insert(payload);

            if (error) console.error(`Error inserting ${church.name}:`, error);
        }
    }

    console.log('Seed completed.');
}

seedChurches();
