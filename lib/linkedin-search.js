/**
 * LinkedIn Search Integration
 * Sprint 6: Find trending posts from watchlist creators and auto-comment
 * 
 * Connects outreach plan → feed scanning → comment generation
 */

/**
 * Get the combined watchlist (default + custom)
 */
async function getCombinedWatchlist() {
    return new Promise(resolve => {
        chrome.storage.local.get(['customWatchlist'], (result) => {
            const customWatchlist = result.customWatchlist || [];

            // Get default watchlist from DiscoveryEngine if available
            const defaultWatchlist = (typeof window.DiscoveryEngine !== 'undefined')
                ? window.DiscoveryEngine.CREATOR_WATCHLIST
                : [];

            // Merge: custom first, then default (dedupe by name)
            const seenNames = new Set();
            const combined = [];

            [...customWatchlist, ...defaultWatchlist].forEach(creator => {
                const normalized = creator.name.toLowerCase();
                if (!seenNames.has(normalized)) {
                    seenNames.add(normalized);
                    combined.push(creator);
                }
            });

            resolve(combined);
        });
    });
}

/**
 * Filter scraped posts to only include watchlist creators
 */
async function filterPostsByWatchlist(posts) {
    const watchlist = await getCombinedWatchlist();

    if (watchlist.length === 0) {
        console.log('No watchlist found, returning all posts');
        return { filtered: posts, matched: [], stats: { total: posts.length, matched: 0 } };
    }

    const matched = [];
    const other = [];

    posts.forEach(post => {
        const authorName = (post.author || '').toLowerCase();
        const matchedCreator = watchlist.find(creator => {
            const creatorParts = creator.name.toLowerCase().split(' ');
            return creatorParts.some(part => part.length > 2 && authorName.includes(part));
        });

        if (matchedCreator) {
            matched.push({
                ...post,
                matchedCreator,
                commentAngles: matchedCreator.commentAngles || null
            });
        } else {
            other.push(post);
        }
    });

    return {
        filtered: [...matched, ...other], // Watchlist first
        matched,
        other,
        stats: {
            total: posts.length,
            matched: matched.length,
            other: other.length
        }
    };
}

/**
 * Generate comment for a post using the creator's specific angles
 */
async function generateCommentForWatchlistPost(post, preferredAngle = 'operator') {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['geminiApiKey'], async (result) => {
            const apiKey = result.geminiApiKey;

            if (!apiKey) {
                reject(new Error('Gemini API key not configured'));
                return;
            }

            const prompt = buildWatchlistCommentPrompt(post, preferredAngle);

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                temperature: 0.8,
                                maxOutputTokens: 500
                            }
                        })
                    }
                );

                if (!response.ok) {
                    throw new Error(`Gemini API error: ${response.status}`);
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!text) {
                    throw new Error('Empty response from Gemini');
                }

                // Parse JSON response
                const comments = parseCommentResponse(text);
                resolve(comments);

            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Build prompt for watchlist-targeted comment generation
 */
function buildWatchlistCommentPrompt(post, preferredAngle) {
    const creatorInfo = post.matchedCreator ? `
CREATOR CONTEXT:
- Name: ${post.matchedCreator.name}
- Role: ${post.matchedCreator.role || 'Unknown'}
- Company: ${post.matchedCreator.company || 'Unknown'}
- Themes: ${(post.matchedCreator.themes || []).join(', ')}
- Recommended angles: ${JSON.stringify(post.matchedCreator.commentAngles || {})}
` : '';

    const angleGuide = {
        operator: 'Share practical experience with metrics. Start with "In my experience..." or "When we implemented..."',
        contrarian: 'Respectfully challenge an assumption. Start with "Interesting perspective - what about..." or "I appreciate this, though..."',
        framework: 'Offer a 3-step actionable approach. Use numbered steps or bullet points concisely.',
        story: 'Share a brief personal anecdote. Start with "This reminds me of..." or "A similar situation..."',
        question: 'Ask a thoughtful follow-up question that shows you read carefully.'
    };

    return `You are a LinkedIn engagement specialist creating high-value comments.

POST CONTENT:
"""
${post.text?.substring(0, 1000) || 'No text available'}
"""

POST AUTHOR: ${post.author || 'Unknown'}
POST METRICS: ${post.engagement?.reactions || 0} reactions, ${post.engagement?.comments || 0} comments

${creatorInfo}

PREFERRED ANGLE: ${preferredAngle}
ANGLE GUIDE: ${angleGuide[preferredAngle] || angleGuide.operator}

Generate 3 comment options, each using a different style:
1. ${preferredAngle.toUpperCase()} style (primary)
2. QUESTION style 
3. SHORT (under 50 words, punchy)

Requirements:
- Each comment should add genuine value
- No empty praise or generic responses
- Show you actually read and understood the post
- Be specific and actionable
- Match the professional tone of LinkedIn

Return ONLY valid JSON:
{
  "comments": [
    {
      "text": "The full comment text",
      "style": "operator|contrarian|framework|story|question|short",
      "hook": "Why this angle works"
    }
  ]
}`;
}

/**
 * Parse comment response from Gemini
 */
function parseCommentResponse(text) {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.comments || [];
        }
    } catch (e) {
        console.error('Failed to parse comment response:', e);
    }
    return [];
}

/**
 * One-click workflow: Find watchlist posts and generate comments
 */
async function findAndComment() {
    try {
        // 1. Get current tab and scrape posts
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes('linkedin.com')) {
            throw new Error('Navigate to LinkedIn feed first');
        }

        // 2. Request posts from content script
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });

        if (!response.success || !response.posts.length) {
            throw new Error('No posts found in feed');
        }

        // 3. Filter by watchlist
        const filtered = await filterPostsByWatchlist(response.posts);

        if (filtered.matched.length === 0) {
            return {
                success: true,
                message: 'No watchlist creators found in current feed. Try scrolling to load more posts.',
                posts: filtered.filtered.slice(0, 10),
                stats: filtered.stats
            };
        }

        // 4. Generate comments for top matched posts
        const postsWithComments = [];

        for (const post of filtered.matched.slice(0, 5)) {
            try {
                // Determine best angle based on creator's defined angles
                const preferredAngle = post.commentAngles?.operator ? 'operator' : 'question';
                const comments = await generateCommentForWatchlistPost(post, preferredAngle);

                postsWithComments.push({
                    ...post,
                    generatedComments: comments
                });
            } catch (error) {
                console.error('Error generating comment for post:', error);
                postsWithComments.push({
                    ...post,
                    generatedComments: [],
                    error: error.message
                });
            }
        }

        return {
            success: true,
            message: `Found ${filtered.matched.length} posts from watchlist creators`,
            posts: postsWithComments,
            stats: filtered.stats
        };

    } catch (error) {
        console.error('Find and comment error:', error);
        return {
            success: false,
            message: error.message,
            posts: [],
            stats: {}
        };
    }
}

/**
 * Get trending posts (high engagement) from current feed
 */
async function getTrendingFromFeed(minReactions = 50) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes('linkedin.com')) {
            return { success: false, message: 'Navigate to LinkedIn feed first', posts: [] };
        }

        const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });

        if (!response.success) {
            return { success: false, message: 'Could not scrape feed', posts: [] };
        }

        // Filter by min reactions
        const trending = response.posts.filter(post =>
            (post.engagement?.reactions || 0) >= minReactions
        ).sort((a, b) =>
            (b.engagement?.reactions || 0) - (a.engagement?.reactions || 0)
        );

        // Filter by watchlist
        const filtered = await filterPostsByWatchlist(trending);

        return {
            success: true,
            message: `Found ${trending.length} trending posts (${filtered.matched.length} from watchlist)`,
            posts: filtered.filtered,
            stats: {
                ...filtered.stats,
                minReactions
            }
        };

    } catch (error) {
        return { success: false, message: error.message, posts: [] };
    }
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.LinkedInSearch = {
        getCombinedWatchlist,
        filterPostsByWatchlist,
        generateCommentForWatchlistPost,
        findAndComment,
        getTrendingFromFeed
    };
}
