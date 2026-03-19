-- Sprint 7: Metrics Tracking & Goals System
-- Migration 003: Add tables for goal tracking and daily/weekly metrics

-- Table: user_goals (Weekly targets set by user)
CREATE TABLE IF NOT EXISTS user_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    comments_target INT DEFAULT 100,
    watchlist_target INT DEFAULT 50,
    high_value_target INT DEFAULT 30,
    response_rate_target NUMERIC(5,2) DEFAULT 0.30,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, week_start_date)
);

-- Table: daily_metrics (Auto-tracked daily progress)
CREATE TABLE IF NOT EXISTS daily_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    date DATE NOT NULL,
    comments_sent INT DEFAULT 0,
    watchlist_comments INT DEFAULT 0,
    high_value_comments INT DEFAULT 0,
    responses_received INT DEFAULT 0,
    response_rate NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Table: watchlist_performance (Track engagement with specific creators)
CREATE TABLE IF NOT EXISTS watchlist_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    week_start_date DATE NOT NULL,
    comments_sent INT DEFAULT 0,
    replies_received INT DEFAULT 0,
    dms_received INT DEFAULT 0,
    engagement_score NUMERIC(3,1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, creator_name, week_start_date)
);

-- Indexes for performance
CREATE INDEX idx_daily_metrics_user_date ON daily_metrics(user_id, date);
CREATE INDEX idx_user_goals_user_week ON user_goals(user_id, week_start_date);
CREATE INDEX idx_watchlist_perf_user_week ON watchlist_performance(user_id, week_start_date);

-- RLS Policies (allow anonymous access for extension)
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_performance ENABLE ROW LEVEL SECURITY;

-- Allow all operations for extension (anonymous access)
CREATE POLICY "Allow all operations on user_goals" ON user_goals FOR ALL USING (true);
CREATE POLICY "Allow all operations on daily_metrics" ON daily_metrics FOR ALL USING (true);
CREATE POLICY "Allow all operations on watchlist_performance" ON watchlist_performance FOR ALL USING (true);

-- View: weekly_metrics (Aggregated weekly data)
CREATE OR REPLACE VIEW weekly_metrics AS
SELECT
    user_id,
    DATE_TRUNC('week', date)::DATE as week_start_date,
    SUM(comments_sent) as total_comments,
    SUM(watchlist_comments) as total_watchlist,
    SUM(high_value_comments) as total_high_value,
    SUM(responses_received) as total_responses,
    CASE 
        WHEN SUM(comments_sent) > 0 
        THEN ROUND((SUM(responses_received)::NUMERIC / SUM(comments_sent)) * 100, 1)
        ELSE 0 
    END as avg_response_rate
FROM daily_metrics
GROUP BY user_id, DATE_TRUNC('week', date);

-- Function: Get current week start (Monday)
CREATE OR REPLACE FUNCTION get_week_start(input_date DATE DEFAULT CURRENT_DATE)
RETURNS DATE AS $$
BEGIN
    RETURN input_date - (EXTRACT(DOW FROM input_date)::INT - 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
