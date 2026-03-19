/**
 * Analytics & Tracking Library
 * Sprint 4: Analytics & A/B Testing
 * 
 * Tracks comment performance, impressions, and generates analytics reports
 */

/**
 * Track a newly sent comment
 */
async function trackComment(commentData) {
    return new Promise(resolve => {
        chrome.storage.local.get(['trackedComments'], (result) => {
            const tracked = result.trackedComments || [];

            const trackingEntry = {
                id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                postId: commentData.postId,
                postAuthor: commentData.postAuthor,
                postAuthorProfile: commentData.postAuthorProfile || commentData.authorHeadline,
                postContent: commentData.postContent?.substring(0, 500),
                postEngagement: commentData.postEngagement || {},
                audienceProfile: commentData.audienceProfile || {},
                commentText: commentData.commentText,
                commentLength: commentData.commentText?.length || 0,
                commentVariant: commentData.variant || 'default',
                commentStyle: commentData.style || 'unknown',
                impressions: {
                    reactions: 0,
                    replies: 0,
                    profileViews: 0,
                    lastChecked: null
                },
                status: 'pending' // pending, active, archived
            };

            tracked.push(trackingEntry);

            // Keep only last 500 comments
            const trimmed = tracked.slice(-500);

            chrome.storage.local.set({ trackedComments: trimmed }, () => {
                resolve(trackingEntry);
            });
        });
    });
}

/**
 * Update impressions for a comment
 */
async function updateImpressions(commentId, impressions) {
    return new Promise(resolve => {
        chrome.storage.local.get(['trackedComments'], (result) => {
            const tracked = result.trackedComments || [];
            const idx = tracked.findIndex(c => c.id === commentId);

            if (idx !== -1) {
                tracked[idx].impressions = {
                    ...tracked[idx].impressions,
                    ...impressions,
                    lastChecked: new Date().toISOString()
                };
            }

            chrome.storage.local.set({ trackedComments: tracked }, () => {
                resolve(tracked[idx]);
            });
        });
    });
}

/**
 * Get all tracked comments
 */
async function getTrackedComments(filters = {}) {
    return new Promise(resolve => {
        chrome.storage.local.get(['trackedComments'], (result) => {
            let tracked = result.trackedComments || [];

            // Apply filters
            if (filters.variant) {
                tracked = tracked.filter(c => c.commentVariant === filters.variant);
            }
            if (filters.style) {
                tracked = tracked.filter(c => c.commentStyle === filters.style);
            }
            if (filters.since) {
                const sinceDate = new Date(filters.since);
                tracked = tracked.filter(c => new Date(c.timestamp) >= sinceDate);
            }
            if (filters.minEngagement) {
                tracked = tracked.filter(c =>
                    (c.impressions.reactions + c.impressions.replies) >= filters.minEngagement
                );
            }

            resolve(tracked);
        });
    });
}

/**
 * Calculate engagement metrics
 */
function calculateEngagementMetrics(comments) {
    if (!comments || comments.length === 0) {
        return {
            totalComments: 0,
            totalReactions: 0,
            totalReplies: 0,
            avgReactions: 0,
            avgReplies: 0,
            engagementRate: 0,
            topPerformers: []
        };
    }

    const totalReactions = comments.reduce((sum, c) => sum + (c.impressions?.reactions || 0), 0);
    const totalReplies = comments.reduce((sum, c) => sum + (c.impressions?.replies || 0), 0);

    // Sort by engagement
    const sorted = [...comments].sort((a, b) => {
        const engA = (a.impressions?.reactions || 0) + (a.impressions?.replies || 0) * 2;
        const engB = (b.impressions?.reactions || 0) + (b.impressions?.replies || 0) * 2;
        return engB - engA;
    });

    return {
        totalComments: comments.length,
        totalReactions,
        totalReplies,
        avgReactions: Math.round((totalReactions / comments.length) * 10) / 10,
        avgReplies: Math.round((totalReplies / comments.length) * 10) / 10,
        engagementRate: Math.round(((totalReactions + totalReplies) / comments.length) * 100) / 100,
        topPerformers: sorted.slice(0, 5).map(c => ({
            id: c.id,
            author: c.postAuthor,
            reactions: c.impressions?.reactions || 0,
            replies: c.impressions?.replies || 0,
            style: c.commentStyle
        }))
    };
}

/**
 * Get analytics by comment style
 */
async function getStyleAnalytics() {
    const comments = await getTrackedComments();

    const byStyle = {};
    comments.forEach(c => {
        const style = c.commentStyle || 'unknown';
        if (!byStyle[style]) {
            byStyle[style] = [];
        }
        byStyle[style].push(c);
    });

    const analysis = {};
    Object.entries(byStyle).forEach(([style, styleComments]) => {
        analysis[style] = calculateEngagementMetrics(styleComments);
    });

    return analysis;
}

/**
 * Get analytics by time period
 */
async function getTimeAnalytics(period = 'week') {
    const comments = await getTrackedComments();

    const now = new Date();
    let periodStart;

    switch (period) {
        case 'day':
            periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case 'week':
            periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        default:
            periodStart = new Date(0);
    }

    const periodComments = comments.filter(c => new Date(c.timestamp) >= periodStart);

    return {
        period,
        startDate: periodStart.toISOString(),
        ...calculateEngagementMetrics(periodComments)
    };
}

/**
 * Get dashboard summary data
 */
async function getDashboardSummary() {
    const allComments = await getTrackedComments();
    const weekComments = await getTrackedComments({
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    });
    const todayComments = await getTrackedComments({
        since: new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    });

    const styleAnalytics = await getStyleAnalytics();

    // Find best performing style
    let bestStyle = null;
    let bestEngagement = 0;
    Object.entries(styleAnalytics).forEach(([style, metrics]) => {
        if (metrics.totalComments >= 5 && metrics.engagementRate > bestEngagement) {
            bestEngagement = metrics.engagementRate;
            bestStyle = style;
        }
    });

    return {
        allTime: calculateEngagementMetrics(allComments),
        thisWeek: calculateEngagementMetrics(weekComments),
        today: calculateEngagementMetrics(todayComments),
        byStyle: styleAnalytics,
        recommendations: {
            bestStyle,
            bestEngagement: Math.round(bestEngagement * 100) / 100,
            suggestedActions: generateSuggestions(styleAnalytics, allComments)
        }
    };
}

/**
 * Generate actionable suggestions based on data
 */
function generateSuggestions(styleAnalytics, allComments) {
    const suggestions = [];

    // Not enough data
    if (allComments.length < 10) {
        suggestions.push('Send more comments to generate meaningful analytics');
        return suggestions;
    }

    // Find best and worst styles
    const styles = Object.entries(styleAnalytics)
        .filter(([_, m]) => m.totalComments >= 3)
        .sort((a, b) => b[1].engagementRate - a[1].engagementRate);

    if (styles.length >= 2) {
        const best = styles[0];
        const worst = styles[styles.length - 1];

        suggestions.push(`Focus on "${best[0]}" style (${best[1].engagementRate} avg engagement)`);

        if (worst[1].engagementRate < best[1].engagementRate * 0.5) {
            suggestions.push(`Consider avoiding "${worst[0]}" style (underperforming)`);
        }
    }

    // Check reply rate
    const totalMetrics = calculateEngagementMetrics(allComments);
    if (totalMetrics.avgReplies < 0.5) {
        suggestions.push('Try ending comments with questions to increase replies');
    }

    return suggestions;
}

/**
 * Export analytics as CSV
 */
async function exportAnalyticsCSV() {
    const comments = await getTrackedComments();

    const headers = [
        'ID', 'Timestamp', 'Post Author', 'Post Content',
        'Comment Text', 'Style', 'Variant', 'Length',
        'Reactions', 'Replies', 'Last Checked'
    ];

    const rows = comments.map(c => [
        c.id,
        c.timestamp,
        c.postAuthor,
        `"${(c.postContent || '').replace(/"/g, '""')}"`,
        `"${(c.commentText || '').replace(/"/g, '""')}"`,
        c.commentStyle,
        c.commentVariant,
        c.commentLength,
        c.impressions?.reactions || 0,
        c.impressions?.replies || 0,
        c.impressions?.lastChecked || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    return csv;
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.Analytics = {
        trackComment,
        updateImpressions,
        getTrackedComments,
        calculateEngagementMetrics,
        getStyleAnalytics,
        getTimeAnalytics,
        getDashboardSummary,
        exportAnalyticsCSV
    };
}
