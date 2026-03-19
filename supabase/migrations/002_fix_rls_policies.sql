-- Fix RLS Policies for LinkedIn Commenter Extension
-- This migration allows anonymous insert access for the extension

-- Drop existing restrictive policies
drop policy if exists "Users access own comments" on comments;
drop policy if exists "Users access own data" on users;

-- Create open insert policy for comments (extension doesn't use auth)
create policy "Allow anonymous insert" on comments
  for insert with check (true);

create policy "Allow anonymous select" on comments
  for select using (true);

create policy "Allow anonymous update" on comments
  for update using (true);

-- Allow anonymous access to users table
create policy "Allow anonymous users access" on users
  for all using (true);

-- Allow insert on creators table (for upserting)
drop policy if exists "Anyone can read creators" on creators;
create policy "Allow all on creators" on creators
  for all using (true);

-- Allow anonymous tracking
drop policy if exists "Users access own tracking" on comment_tracking;
create policy "Allow anonymous tracking" on comment_tracking
  for all using (true);

-- Allow anonymous A/B tests
drop policy if exists "Users manage own tests" on ab_tests;
create policy "Allow anonymous ab tests" on ab_tests
  for all using (true);
