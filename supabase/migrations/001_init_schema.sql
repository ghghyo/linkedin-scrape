-- Supabase Migration for LinkedIn Commenter Extension
-- Run this in your Supabase SQL Editor

-- 1. Users table
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  settings jsonb default '{}',
  daily_limit int default 20,
  created_at timestamp with time zone default now()
);

-- 2. Creators table (cached LinkedIn profiles)
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  linkedin_profile_url text unique not null,
  name text,
  headline text,
  industry text,
  audience_profile jsonb default '{}',
  watchlist_rank int,
  last_scraped timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- 3. Comments table
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  creator_id uuid references creators(id),
  post_id text,
  post_content text,
  post_engagement jsonb default '{}',
  hashtags text[] default '{}',
  comment_text text not null,
  comment_length int,
  comment_variant text default 'default',
  ab_test_id uuid,
  sent_at timestamp with time zone default now()
);

-- 4. Comment tracking (impressions over time)
create table if not exists comment_tracking (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid references comments(id) on delete cascade,
  reactions int default 0,
  replies int default 0,
  checked_at timestamp with time zone default now()
);

-- 5. A/B Tests table
create table if not exists ab_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  variants text[] not null,
  config jsonb default '{}',
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

-- Add foreign key for ab_test_id after ab_tests exists
alter table comments 
  add constraint comments_ab_test_fk 
  foreign key (ab_test_id) references ab_tests(id);

-- Indexes for performance
create index if not exists idx_comments_user on comments(user_id);
create index if not exists idx_comments_sent on comments(sent_at);
create index if not exists idx_tracking_comment on comment_tracking(comment_id);
create index if not exists idx_creators_url on creators(linkedin_profile_url);

-- Enable Row Level Security
alter table users enable row level security;
alter table comments enable row level security;
alter table comment_tracking enable row level security;
alter table ab_tests enable row level security;

-- RLS Policies
create policy "Users access own data" on users
  for all using (auth.uid() = id);

create policy "Users access own comments" on comments
  for all using (auth.uid() = user_id);

create policy "Users access own tracking" on comment_tracking
  for all using (
    comment_id in (select id from comments where user_id = auth.uid())
  );

create policy "Anyone can read creators" on creators
  for select using (true);

create policy "Users manage own tests" on ab_tests
  for all using (auth.uid() = user_id);

-- Analytics Views

-- Comment performance by variant
create or replace view comment_performance as
select 
  c.comment_variant,
  count(*) as total_comments,
  coalesce(avg(ct.reactions), 0) as avg_reactions,
  coalesce(avg(ct.replies), 0) as avg_replies,
  coalesce(avg(ct.reactions + ct.replies), 0) as avg_engagement
from comments c
left join (
  select distinct on (comment_id) * 
  from comment_tracking 
  order by comment_id, checked_at desc
) ct on c.id = ct.comment_id
group by c.comment_variant;

-- Top performing creators
create or replace view top_creators as
select 
  cr.name,
  cr.headline,
  count(c.id) as comments_sent,
  coalesce(avg(ct.reactions), 0) as avg_reactions
from creators cr
join comments c on cr.id = c.creator_id
left join (
  select distinct on (comment_id) * 
  from comment_tracking 
  order by comment_id, checked_at desc
) ct on c.id = ct.comment_id
group by cr.id, cr.name, cr.headline
order by avg_reactions desc;

-- Grant access to views
grant select on comment_performance to authenticated;
grant select on top_creators to authenticated;
