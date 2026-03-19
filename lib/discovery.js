/**
 * Discovery Engine - Finds trending posts and prioritizes watchlist creators
 * Sprint 2: Discovery & Audience Inference
 */

// Top 25 ranked creators from commenting-plan.md
const CREATOR_WATCHLIST = [
    { rank: 1, name: 'Pranay Kapadia', company: 'Notable Health', score: 24 },
    { rank: 2, name: 'Ankit Jain', company: 'Infinitus Systems', score: 23 },
    { rank: 3, name: 'Sam Schwager', company: 'SuperDial', score: 22 },
    { rank: 4, name: 'Israel Krush', company: 'Hyro', score: 22 },
    { rank: 5, name: 'Stead Burwell', company: 'Outbound AI', score: 21 },
    { rank: 6, name: 'Punit Soni', company: 'Suki', score: 21 },
    { rank: 7, name: 'Nikhil Buduma', company: 'Ambience Healthcare', score: 21 },
    { rank: 8, name: 'Shiv Rao', company: 'Abridge', score: 20 },
    { rank: 9, name: 'Alex LeBrun', company: 'Nabla', score: 20 },
    { rank: 10, name: 'John Halamka', company: 'Mayo Clinic Platform', score: 20 },
    { rank: 11, name: 'Eric Topol', company: 'Scripps Research', score: 20 },
    { rank: 12, name: 'Rasu Shrestha', company: 'Atrium Health', score: 19 },
    { rank: 13, name: 'Lisa Suennen', company: 'Manatt Health', score: 19 },
    { rank: 14, name: 'Glen Tullman', company: 'Transcarent', score: 19 },
    { rank: 15, name: 'Julie Yoo', company: 'Andreessen Horowitz', score: 19 },
    { rank: 16, name: 'John Brownstein', company: 'Boston Children\'s Hospital', score: 18 },
    { rank: 17, name: 'Nigam Shah', company: 'Stanford Health Care', score: 18 },
    { rank: 18, name: 'Sara Murray', company: 'UCSF Health', score: 18 },
    { rank: 19, name: 'Rebecca Mishuris', company: 'Mass General Brigham', score: 18 },
    { rank: 20, name: 'Eric Poon', company: 'Duke Health', score: 18 },
    { rank: 21, name: 'Aashima Gupta', company: 'Google Cloud', score: 17 },
    { rank: 22, name: 'Joshua Liu', company: 'SeamlessMD', score: 17 },
    { rank: 23, name: 'Yasir Tarabichi', company: 'MetroHealth System', score: 17 },
    { rank: 24, name: 'Aaron Martin', company: 'Providence Health', score: 17 },
    { rank: 25, name: 'Jane Sarasohn-Kahn', company: 'Health Populi', score: 17 }
];

// Topic spaces from commenting plan
const TOPIC_SPACES = [
    'Healthtech AI',
    'Voice AI',
    'Revenue Cycle',
    'Prior Authorization',
    'Ambient AI',
    'Healthcare Automation',
    'Leadership',
    'Digital Health',
    'Fitness & Performance',
    'Founder/Startup'
];

// Monitoring queries from commenting-plan.md
const MONITORING_QUERIES = [
    '"voice AI" AND healthcare AND revenue cycle',
    '"healthtech founder" AND (RCM OR "revenue cycle")',
    '"ambient AI" AND healthcare AND scribe',
    '"AI prior authorization" AND healthcare',
    '"AI call center" AND patient access',
    '"healthcare automation" AND scheduling',
    '"revenue cycle management" AND AI startup',
    '#healthtech AND #voiceAI',
    '#healthcareautomation AND #patientaccess',
    '#ambientAI AND #clinicianburnout',
    '#priorauthorization AND #AI'
];

/**
 * Calculate engagement score for a post
 * Higher score = more engagement = more visibility potential
 */
function calculateEngagementScore(post) {
    const reactions = post.engagement?.reactions || 0;
    const comments = post.engagement?.comments || 0;

    // Weighted formula: comments are worth more (indicate discussion)
    const baseScore = reactions + (comments * 3);

    // Boost for watchlist creators
    const creatorBoost = getCreatorBoost(post.author);

    // Boost for relevant hashtags
    const hashtagBoost = getHashtagRelevanceBoost(post.hashtags || []);

    return Math.round(baseScore * creatorBoost * hashtagBoost);
}

/**
 * Check if author is on watchlist and return boost multiplier
 */
function getCreatorBoost(authorName) {
    if (!authorName) return 1.0;

    const normalizedName = authorName.toLowerCase().trim();

    for (const creator of CREATOR_WATCHLIST) {
        // Check for name match (first name, last name, or full name)
        const creatorParts = creator.name.toLowerCase().split(' ');
        if (creatorParts.some(part => normalizedName.includes(part))) {
            // Higher boost for higher-ranked creators
            return 1 + (0.5 * (26 - creator.rank) / 25); // 1.5x for #1, 1.02x for #25
        }
    }

    return 1.0;
}

/**
 * Check hashtags for topic relevance
 */
function getHashtagRelevanceBoost(hashtags) {
    if (!hashtags || hashtags.length === 0) return 1.0;

    const relevantKeywords = [
        'healthtech', 'healthcare', 'ai', 'automation', 'voiceai',
        'rcm', 'revenuecycle', 'priorauth', 'ambient', 'leadership',
        'founder', 'startup', 'fitness', 'performance', 'digitalhealth'
    ];

    let matches = 0;
    for (const tag of hashtags) {
        const normalized = tag.toLowerCase().replace('#', '');
        if (relevantKeywords.some(kw => normalized.includes(kw))) {
            matches++;
        }
    }

    // Up to 1.3x boost for 3+ relevant hashtags
    return 1 + (Math.min(matches, 3) * 0.1);
}

/**
 * Score and rank posts by engagement and relevance
 */
function rankPostsByEngagement(posts) {
    return posts
        .map(post => ({
            ...post,
            engagementScore: calculateEngagementScore(post),
            isWatchlist: isWatchlistCreator(post.author)
        }))
        .sort((a, b) => b.engagementScore - a.engagementScore);
}

/**
 * Check if creator is on watchlist
 */
function isWatchlistCreator(authorName) {
    if (!authorName) return false;
    const normalized = authorName.toLowerCase();
    return CREATOR_WATCHLIST.some(c =>
        c.name.toLowerCase().split(' ').some(part => normalized.includes(part))
    );
}

/**
 * Get watchlist creator info if author matches
 */
function getWatchlistInfo(authorName) {
    if (!authorName) return null;
    const normalized = authorName.toLowerCase();

    for (const creator of CREATOR_WATCHLIST) {
        const parts = creator.name.toLowerCase().split(' ');
        if (parts.some(part => normalized.includes(part))) {
            return creator;
        }
    }
    return null;
}

/**
 * Filter posts to prioritize watchlist creators
 * Returns: { watchlistPosts, otherPosts, all }
 */
function prioritizeWatchlistPosts(posts) {
    const ranked = rankPostsByEngagement(posts);

    const watchlistPosts = ranked.filter(p => p.isWatchlist);
    const otherPosts = ranked.filter(p => !p.isWatchlist);

    return {
        watchlistPosts,
        otherPosts,
        all: [...watchlistPosts, ...otherPosts], // Watchlist first, then by engagement
        stats: {
            total: posts.length,
            watchlist: watchlistPosts.length,
            other: otherPosts.length,
            avgEngagement: ranked.reduce((sum, p) => sum + p.engagementScore, 0) / ranked.length
        }
    };
}

/**
 * Get trending posts (high engagement in feed)
 */
function getTrendingPosts(posts, options = {}) {
    const { minEngagement = 10, limit = 20 } = options;

    return rankPostsByEngagement(posts)
        .filter(p => p.engagementScore >= minEngagement)
        .slice(0, limit);
}

/**
 * Match post content to topic spaces
 */
function inferTopicSpaces(post) {
    const text = (post.text || '').toLowerCase();
    const hashtags = (post.hashtags || []).map(h => h.toLowerCase());
    const headline = (post.authorHeadline || '').toLowerCase();

    const matches = [];

    // Topic detection rules
    const topicRules = {
        'Healthtech AI': ['healthtech', 'healthcare ai', 'health ai', 'clinical ai'],
        'Voice AI': ['voice ai', 'voiceai', 'speech', 'call center', 'ivr'],
        'Revenue Cycle': ['revenue cycle', 'rcm', 'billing', 'claims', 'reimbursement'],
        'Prior Authorization': ['prior auth', 'priorauth', 'authorization', 'pre-auth'],
        'Ambient AI': ['ambient', 'scribe', 'documentation', 'clinical notes'],
        'Healthcare Automation': ['automation', 'workflow', 'scheduling', 'patient access'],
        'Leadership': ['leadership', 'leader', 'management', 'ceo', 'executive'],
        'Digital Health': ['digital health', 'telehealth', 'remote care', 'virtual care'],
        'Fitness & Performance': ['fitness', 'workout', 'training', 'performance', 'discipline'],
        'Founder/Startup': ['founder', 'startup', 'entrepreneurship', 'venture', 'building']
    };

    for (const [topic, keywords] of Object.entries(topicRules)) {
        const combined = text + ' ' + hashtags.join(' ') + ' ' + headline;
        if (keywords.some(kw => combined.includes(kw))) {
            matches.push(topic);
        }
    }

    return matches;
}

/**
 * Enrich posts with discovery metadata
 */
function enrichPostsWithDiscoveryData(posts) {
    return posts.map(post => ({
        ...post,
        engagementScore: calculateEngagementScore(post),
        isWatchlist: isWatchlistCreator(post.author),
        watchlistInfo: getWatchlistInfo(post.author),
        topicSpaces: inferTopicSpaces(post),
        priority: calculatePriority(post)
    }));
}

/**
 * Calculate overall priority (1-100)
 */
function calculatePriority(post) {
    let priority = 0;

    // Engagement (up to 40 points)
    const engScore = calculateEngagementScore(post);
    priority += Math.min(engScore / 10, 40);

    // Watchlist creator (up to 30 points)
    const watchlist = getWatchlistInfo(post.author);
    if (watchlist) {
        priority += 30 * (26 - watchlist.rank) / 25;
    }

    // Topic relevance (up to 20 points)
    const topics = inferTopicSpaces(post);
    priority += Math.min(topics.length * 5, 20);

    // Hashtag relevance (up to 10 points)
    const hashtagBoost = getHashtagRelevanceBoost(post.hashtags);
    priority += (hashtagBoost - 1) * 100;

    return Math.min(Math.round(priority), 100);
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.DiscoveryEngine = {
        CREATOR_WATCHLIST,
        TOPIC_SPACES,
        MONITORING_QUERIES,
        calculateEngagementScore,
        rankPostsByEngagement,
        prioritizeWatchlistPosts,
        getTrendingPosts,
        inferTopicSpaces,
        enrichPostsWithDiscoveryData,
        isWatchlistCreator,
        getWatchlistInfo
    };
}
