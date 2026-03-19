-- Sprint 8: Authentication & User Tracking
-- Migration 004: Create users table with email support

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- Supports both anonymous IDs and Supabase UUIDs
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists (for idempotency)
DROP POLICY IF EXISTS "Allow all operations on users" ON users;
CREATE POLICY "Allow all operations on users" ON users FOR ALL USING (true);

-- Add comment for documentation
COMMENT ON TABLE users IS 'Stores user profiles, mapping anonymous and authenticated IDs to emails.';
