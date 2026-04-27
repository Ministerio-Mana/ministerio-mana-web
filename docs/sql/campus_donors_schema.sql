-- Campus Donors Module
-- Add missionary_id to donations table to track which campus missionary receives each donation

ALTER TABLE donations ADD COLUMN IF NOT EXISTS missionary_id UUID;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS missionary_name TEXT;

-- Foreign key to user_profiles (campus missionaries)
DO $$ BEGIN
    ALTER TABLE donations 
    ADD CONSTRAINT fk_donations_missionary 
    FOREIGN KEY (missionary_id) 
    REFERENCES auth.users(id) 
    ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_donations_missionary ON donations(missionary_id) WHERE missionary_id IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN donations.missionary_id IS 'Campus missionary who receives this donation (if applicable)';
COMMENT ON COLUMN donations.missionary_name IS 'Name of the campus missionary for display purposes';
