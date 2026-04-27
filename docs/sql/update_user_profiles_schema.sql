-- Add missing columns for user profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS document_type TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS document_number TEXT;

-- Update RLS policies (optional but good practice to ensure they cover new columns)
-- Existing policies likely cover "all columns", so no change needed if using "USING (true)" or similar.
