/**
 * Supabase Client for LinkedIn Commenter Extension
 * Handles all database operations for comments, creators, and analytics
 */

// Default Supabase configuration
const DEFAULT_SUPABASE_URL = 'https://vkssikiaxjozkqnqrhqj.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_ycFJC2j_RDuECu0qIdQSQQ_njWdQ8h5';

// Supabase configuration - loaded from chrome.storage or defaults
let supabaseUrl = '';
let supabaseKey = '';
let supabaseClient = null;

/**
 * Initialize Supabase client with stored credentials or defaults
 */
async function initSupabase() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], async (result) => {
            // Use stored credentials or fall back to defaults
            supabaseUrl = result.supabaseUrl || DEFAULT_SUPABASE_URL;
            supabaseKey = result.supabaseKey || DEFAULT_SUPABASE_KEY;

            // Save defaults if not already stored
            if (!result.supabaseUrl || !result.supabaseKey) {
                chrome.storage.local.set({
                    supabaseUrl: supabaseUrl,
                    supabaseKey: supabaseKey
                });
            }

            supabaseClient = createSupabaseClient(supabaseUrl, supabaseKey);
            console.log('Supabase initialized with URL:', supabaseUrl);

            // Ensure user exists in cloud
            try {
                const userId = await getUserId();
                await supabaseClient.from('users').upsert({ id: userId }, { onConflict: 'id' });
            } catch (err) {
                console.error('Error ensuring user exists:', err);
            }

            resolve(true);
        });
    });
}

/**
 * Get or generate a user ID
 * Uses chrome extension ID + installation timestamp as unique identifier
 */
async function getUserId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userId', 'identifiedUser'], (result) => {
            // Priority 1: Identified user ID (stably derived from email)
            if (result.identifiedUser && result.identifiedUser.id) {
                resolve(result.identifiedUser.id);
                return;
            }

            // Priority 2: Anonymous user ID from storage
            if (result.userId) {
                resolve(result.userId);
            } else {
                // Priority 3: Generate new anonymous user ID
                const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                chrome.storage.local.set({ userId }, () => {
                    resolve(userId);
                });
            }
        });
    });
}

/**
 * Create a minimal Supabase client (no npm dependency)
 */
function createSupabaseClient(url, key) {
    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };

    return {
        url,
        headers,

        // Generic fetch wrapper
        async request(path, options = {}) {
            const response = await fetch(`${url}/${path}`, {
                ...options,
                headers: { ...headers, ...options.headers }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Supabase error: ${errorText}`);
            }

            const contentLength = response.headers.get('content-length');
            if (response.status === 204 || contentLength === '0') {
                return null;
            }

            return response.json();
        },

        // Simple Identity operations (No OTP/Verification)
        auth: {
            async identify(email) {
                // 1. Try to find existing user by email to preserve ID (for foreign keys)
                try {
                    const existing = await supabaseClient.from('users').select('id', {
                        filter: `email=eq.${encodeURIComponent(email)}`,
                        limit: 1
                    });

                    if (existing && existing.length > 0) {
                        const user = {
                            id: existing[0].id,
                            email: email,
                            identified_at: new Date().toISOString()
                        };
                        await chrome.storage.local.set({ identifiedUser: user });
                        return user;
                    }
                } catch (e) {
                    console.warn('Lookup failed, falling back to deterministic ID', e);
                }

                // 2. Generate a stable ID from the email (simple base64)
                const stableId = `user_${btoa(email).replace(/=/g, '').substr(0, 16)}`;

                const user = {
                    id: stableId,
                    email: email,
                    identified_at: new Date().toISOString()
                };

                // Store in local storage
                await chrome.storage.local.set({ identifiedUser: user });

                // Upsert into users table for tracking
                await supabaseClient.from('users').upsert({
                    id: user.id,
                    email: user.email,
                    updated_at: user.identified_at
                }, { onConflict: 'id' });

                return user;
            },
            async signOut() {
                await chrome.storage.local.remove('identifiedUser');
            },
            async getSession() {
                const result = await chrome.storage.local.get('identifiedUser');
                if (result.identifiedUser) {
                    return { user: result.identifiedUser };
                }
                return null;
            }
        },

        // Table operations
        from(table) {
            return {
                table,

                async select(columns = '*', options = {}) {
                    let query = `rest/v1/${table}?select=${columns}`;
                    if (options.order) query += `&order=${options.order}`;
                    if (options.limit) query += `&limit=${options.limit}`;
                    if (options.filter) query += `&${options.filter}`;

                    return supabaseClient.request(query);
                },

                async insert(data) {
                    return supabaseClient.request(`rest/v1/${table}`, {
                        method: 'POST',
                        body: JSON.stringify(Array.isArray(data) ? data : [data])
                    });
                },

                async update(data, filter) {
                    return supabaseClient.request(`rest/v1/${table}?${filter}`, {
                        method: 'PATCH',
                        body: JSON.stringify(data)
                    });
                },

                async upsert(data, options = {}) {
                    let endpoint = `rest/v1/${table}`;
                    if (options.onConflict) {
                        endpoint += `?on_conflict=${options.onConflict}`;
                    }

                    return supabaseClient.request(endpoint, {
                        method: 'POST',
                        headers: {
                            'Prefer': 'return=representation,resolution=merge-duplicates'
                        },
                        body: JSON.stringify(Array.isArray(data) ? data : [data])
                    });
                },

                async delete(filter) {
                    return supabaseClient.request(`rest/v1/${table}?${filter}`, {
                        method: 'DELETE'
                    });
                }
            };
        }
    };
}

/**
 * Check if Supabase is configured
 */
function isSupabaseConfigured() {
    return supabaseClient !== null;
}

/**
 * Save comment to Supabase
 */
async function saveCommentToSupabase(commentData) {
    if (!isSupabaseConfigured()) {
        console.log('Supabase not configured, skipping cloud save');
        return null;
    }

    try {
        // First, upsert creator if we have profile URL
        let creatorId = null;
        if (commentData.postAuthorProfileUrl) {
            const creators = await supabaseClient.from('creators').upsert({
                linkedin_profile_url: commentData.postAuthorProfileUrl,
                name: commentData.postAuthor,
                headline: commentData.postAuthorHeadline || '',
                last_scraped: new Date().toISOString()
            }, { onConflict: 'linkedin_profile_url' });
            if (creators && creators[0]) {
                creatorId = creators[0].id;
            }
        }

        // Insert comment
        const userId = await getUserId();
        const result = await supabaseClient.from('comments').insert({
            user_id: userId,
            creator_id: creatorId,
            post_id: commentData.postId,
            post_content: commentData.postContent,
            post_engagement: commentData.postEngagement || {},
            hashtags: commentData.postHashtags || [],
            comment_text: commentData.commentSent,
            comment_length: commentData.commentLength,
            comment_variant: commentData.commentVariant || 'default'
        });

        console.log('Comment saved to Supabase:', result);
        return result;
    } catch (error) {
        console.error('Error saving to Supabase:', error);
        return null;
    }
}

/**
 * Get comment history from Supabase
 */
async function getCommentHistoryFromSupabase(limit = 100) {
    if (!isSupabaseConfigured()) return [];

    try {
        return await supabaseClient.from('comments').select(
            '*,creators(name,headline)',
            { order: 'sent_at.desc', limit }
        );
    } catch (error) {
        console.error('Error fetching from Supabase:', error);
        return [];
    }
}

/**
 * Update comment tracking (impressions)
 */
async function updateCommentTracking(commentId, reactions, replies) {
    if (!isSupabaseConfigured()) return null;

    try {
        return await supabaseClient.from('comment_tracking').insert({
            comment_id: commentId,
            reactions,
            replies
        });
    } catch (error) {
        console.error('Error updating tracking:', error);
        return null;
    }
}

/**
 * Get analytics summary
 */
async function getAnalyticsSummary() {
    if (!isSupabaseConfigured()) return null;

    try {
        const [performance, topCreators] = await Promise.all([
            supabaseClient.request('rest/v1/comment_performance'),
            supabaseClient.request('rest/v1/top_creators?limit=10')
        ]);

        return { performance, topCreators };
    } catch (error) {
        console.error('Error fetching analytics:', error);
        return null;
    }
}

/**
 * Get or create active A/B test
 */
async function getActiveABTest() {
    if (!isSupabaseConfigured()) return null;

    try {
        const tests = await supabaseClient.from('ab_tests').select('*', {
            filter: 'is_active=eq.true',
            limit: 1
        });
        return tests[0] || null;
    } catch (error) {
        console.error('Error fetching A/B test:', error);
        return null;
    }
}

/**
 * Assign variant for A/B test
 */
function assignVariant(postId, variants) {
    // Simple hash-based assignment for consistency
    let hash = 0;
    for (let i = 0; i < postId.length; i++) {
        hash = ((hash << 5) - hash) + postId.charCodeAt(i);
        hash = hash & hash;
    }
    return variants[Math.abs(hash) % variants.length];
}

// ==================== METRICS TRACKING (Sprint 7) ====================

/**
 * Get current week start date (Monday)
 */
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

/**
 * Set weekly goals
 */
async function setWeeklyGoals(goals) {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const weekStart = getWeekStart();

    const payload = {
        user_id: userId,
        week_start_date: weekStart,
        comments_target: goals.commentsTarget || 100,
        watchlist_target: goals.watchlistTarget || 50,
        high_value_target: goals.highValueTarget || 30,
        response_rate_target: goals.responseRateTarget || 0.30
    };

    try {
        const result = await supabaseClient.from('user_goals').upsert(payload, {
            onConflict: 'user_id,week_start_date'
        });
        // Upsert returns null for successful 204 No Content
        return result !== undefined ? result : true; // Return true for success
    } catch (error) {
        console.error('Error setting weekly goals:', error);
        return null;
    }
}

/**
 * Get weekly goals
 */
async function getWeeklyGoals() {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const weekStart = getWeekStart();

    try {
        const result = await supabaseClient.request(
            `rest/v1/user_goals?user_id=eq.${userId}&week_start_date=eq.${weekStart}&limit=1`
        );
        return result && result.length > 0 ? result[0] : null;
    } catch (error) {
        console.error('Error fetching weekly goals:', error);
        return null;
    }
}

/**
 * Log daily metric (increment counters)
 */
async function logDailyMetric(metric) {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const today = new Date().toISOString().split('T')[0];

    try {
        const existing = await supabaseClient.request(
            `rest/v1/daily_metrics?user_id=eq.${userId}&date=eq.${today}&limit=1`
        );

        let payload;
        if (existing && existing.length > 0) {
            const current = existing[0];
            payload = {
                comments_sent: current.comments_sent + (metric.commentsSent || 0),
                watchlist_comments: current.watchlist_comments + (metric.watchlistComments || 0),
                high_value_comments: current.high_value_comments + (metric.highValueComments || 0),
                responses_received: current.responses_received + (metric.responsesReceived || 0),
                updated_at: new Date().toISOString()
            };

            if (payload.comments_sent > 0) {
                payload.response_rate = (payload.responses_received / payload.comments_sent) * 100;
            }

            return await supabaseClient.from('daily_metrics').update(payload, `id=eq.${current.id}`);
        } else {
            payload = {
                user_id: userId,
                date: today,
                comments_sent: metric.commentsSent || 0,
                watchlist_comments: metric.watchlistComments || 0,
                high_value_comments: metric.highValueComments || 0,
                responses_received: metric.responsesReceived || 0,
                response_rate: 0
            };

            return await supabaseClient.from('daily_metrics').insert(payload);
        }
    } catch (error) {
        console.error('Error logging daily metric:', error);
        return null;
    }
}

/**
 * Get daily metrics
 */
async function getDailyMetrics(date = null) {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
        const result = await supabaseClient.request(
            `rest/v1/daily_metrics?user_id=eq.${userId}&date=eq.${targetDate}&limit=1`
        );
        return result && result.length > 0 ? result[0] : {
            comments_sent: 0,
            watchlist_comments: 0,
            high_value_comments: 0,
            responses_received: 0,
            response_rate: 0
        };
    } catch (error) {
        console.error('Error fetching daily metrics:', error);
        return null;
    }
}

/**
 * Get weekly metrics (aggregated)
 */
async function getWeeklyMetrics() {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const weekStart = getWeekStart();

    try {
        const result = await supabaseClient.request(
            `rest/v1/weekly_metrics?user_id=eq.${userId}&week_start_date=eq.${weekStart}&limit=1`
        );
        return result && result.length > 0 ? result[0] : {
            total_comments: 0,
            total_watchlist: 0,
            total_high_value: 0,
            total_responses: 0,
            avg_response_rate: 0
        };
    } catch (error) {
        console.error('Error fetching weekly metrics:', error);
        return null;
    }
}

/**
 * Log watchlist engagement
 */
async function logWatchlistEngagement(creatorName, hasReply = false) {
    if (!isSupabaseConfigured()) return null;

    const userId = await getUserId();
    const weekStart = getWeekStart();

    try {
        const existing = await supabaseClient.request(
            `rest/v1/watchlist_performance?user_id=eq.${userId}&creator_name=eq.${encodeURIComponent(creatorName)}&week_start_date=eq.${weekStart}&limit=1`
        );

        let payload;
        if (existing && existing.length > 0) {
            const current = existing[0];
            payload = {
                comments_sent: current.comments_sent + 1,
                replies_received: current.replies_received + (hasReply ? 1 : 0),
                updated_at: new Date().toISOString()
            };

            const replyRate = payload.replies_received / payload.comments_sent;
            payload.engagement_score = Math.min(5, replyRate * 5);

            return await supabaseClient.from('watchlist_performance').update(payload, `id=eq.${current.id}`);
        } else {
            payload = {
                user_id: userId,
                creator_name: creatorName,
                week_start_date: weekStart,
                comments_sent: 1,
                replies_received: hasReply ? 1 : 0,
                dms_received: 0,
                engagement_score: hasReply ? 1.0 : 0
            };

            return await supabaseClient.from('watchlist_performance').insert(payload);
        }
    } catch (error) {
        console.error('Error logging watchlist engagement:', error);
        return null;
    }
}

/**
 * Get watchlist performance for current week
 */
async function getWatchlistPerformance() {
    if (!isSupabaseConfigured()) return [];

    const userId = await getUserId();
    const weekStart = getWeekStart();

    try {
        const result = await supabaseClient.request(
            `rest/v1/watchlist_performance?user_id=eq.${userId}&week_start_date=eq.${weekStart}&order=engagement_score.desc&limit=10`
        );
        return result || [];
    } catch (error) {
        console.error('Error fetching watchlist performance:', error);
        return [];
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.SupabaseClient = {
        init: initSupabase,
        isConfigured: isSupabaseConfigured,
        saveComment: saveCommentToSupabase,
        getHistory: getCommentHistoryFromSupabase,
        updateTracking: updateCommentTracking,
        getAnalytics: getAnalyticsSummary,
        getActiveTest: getActiveABTest,
        assignVariant,
        // Metrics tracking (Sprint 7)
        setWeeklyGoals,
        getWeeklyGoals,
        logDailyMetric,
        getDailyMetrics,
        getWeeklyMetrics,
        logWatchlistEngagement,
        getWatchlistPerformance,
        // Identification (Sprint 8 - Simplified)
        identify: (email) => {
            if (!supabaseClient) throw new Error('Supabase client not initialized');
            return supabaseClient.auth.identify(email);
        },
        signOut: () => {
            if (!supabaseClient) return Promise.resolve();
            return supabaseClient.auth.signOut();
        },
        getSession: async () => {
            const result = await chrome.storage.local.get('identifiedUser');
            if (result.identifiedUser) {
                return { user: result.identifiedUser };
            }
            return null;
        }
    };
}
