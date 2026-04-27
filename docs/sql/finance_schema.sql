-- Finance Schema Updates
-- Phase 11: Standardization

-- 1. Add Columns to Donations
ALTER TABLE donations ADD COLUMN IF NOT EXISTS church_id UUID REFERENCES churches(id);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS concept_code TEXT; -- TITHE, OFFERING, CAMPUS, REGISTRATION, EVENT, OTHER
ALTER TABLE donations ADD COLUMN IF NOT EXISTS concept_label TEXT;
ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

create index if not exists idx_donations_church on donations(church_id);
create index if not exists idx_donations_concept on donations(concept_code);

-- 2. Enable RLS
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

-- 3. Policies

-- Policy: Superadmins/Admins see EVERYTHING
DROP POLICY IF EXISTS "Admins view all donations" ON donations;
CREATE POLICY "Admins view all donations" ON donations
FOR SELECT TO authenticated
USING (
    exists (
        select 1 from user_profiles 
        where user_id = auth.uid() 
        and role in ('admin', 'superadmin')
    )
);

-- Policy: Pastors see THEIR CHURCH transactions
DROP POLICY IF EXISTS "Pastors view church donations" ON donations;
CREATE POLICY "Pastors view church donations" ON donations
FOR SELECT TO authenticated
USING (
    exists (
        select 1 from user_profiles 
        where user_id = auth.uid() 
        and role in ('pastor', 'leader', 'tester') 
        and church_id = donations.church_id
    )
);

-- Policy: Users see THEIR OWN donations (Mis Aportes)
-- Note: 'donor_email' or 'reference' might be used, but usually we link by user_id if we tracked it.
-- donations table currently uses donor_email. We might rely on that.
-- OR if we added user_id to donations. Ideally we should.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

DROP POLICY IF EXISTS "Users view own donations" ON donations;
CREATE POLICY "Users view own donations" ON donations
FOR SELECT TO authenticated
USING (
    user_id = auth.uid() 
    OR 
    donor_email = (select email from auth.users where id = auth.uid())
);
